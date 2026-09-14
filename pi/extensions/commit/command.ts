import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
	type CreateAgentSessionOptions,
	type ExtensionAPI,
	type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	acquireGitTransactionLock,
	captureGitPreflight,
	createGitTools,
	DEFAULT_GIT_TRANSACTION_LOCK_RELEASE_TIMEOUT_MS,
	GitTransactionLockError,
	ProcessGitExecutor,
	type CommitReceipt,
	type GitExecutor,
	type GitTransactionLock,
} from "./git-tools.ts";
import { CommitStatusWidget, type CommitProgress } from "./widget.ts";

export const COMMIT_MODELS = [
	{ provider: "openai-codex", id: "gpt-5.6-luna" },
	{ provider: "anthropic", id: "claude-haiku-4-5" },
] as const;

export const COMMIT_TOOL_ALLOWLIST = ["read", "git_snapshot", "git_stage", "git_commit"] as const;
export const DEFAULT_COMMIT_TIMEOUT_MS = 120_000;

export const WORKER_POLICY = `You are an isolated commit worker. Inspect Git status and both staged and unstaged diffs before acting. The optional /commit text is the primary scope hint; the copied parent thread is fallback scope evidence only. Stage only explicit relative paths clearly attributable to that request or thread. If scope is unclear, refuse. Preserve pre-staged changes and refuse if unrelated changes are already staged. Never reset, restore, amend, push, force, bypass hooks, or run anything outside the provided tools. Use git_commit exactly once with a concise one-line subject when the index contains only the intended commit.`;

export interface CommitWorkerSession {
	agent: {
		state: {
			messages: AgentMessage[];
			errorMessage?: string;
		};
		shouldStopAfterTurn?: () => boolean;
	};
	prompt(text: string): Promise<void>;
	abort(): Promise<void>;
	dispose(): void;
}

export interface CommitDependencies {
	git: GitExecutor;
	timeoutMs: number;
	acquireTransactionLock(cwd: string, executor: GitExecutor): Promise<GitTransactionLock>;
	createResourceLoader(options: ConstructorParameters<typeof DefaultResourceLoader>[0]): DefaultResourceLoader;
	createSession(options: CreateAgentSessionOptions): Promise<{ session: CommitWorkerSession }>;
	createSessionManager(cwd: string): SessionManager;
	createSettingsManager(): SettingsManager;
	agentDir(): string;
}

export const defaultCommitDependencies: CommitDependencies = {
	git: new ProcessGitExecutor(),
	timeoutMs: DEFAULT_COMMIT_TIMEOUT_MS,
	acquireTransactionLock: acquireGitTransactionLock,
	createResourceLoader: (options) => new DefaultResourceLoader(options),
	createSession: async (options) => {
		const result = await createAgentSession(options);
		return { session: result.session };
	},
	createSessionManager: (cwd) => SessionManager.inMemory(cwd),
	createSettingsManager: () => SettingsManager.inMemory({
		compaction: { enabled: false },
		retry: { enabled: false },
	}),
	agentDir: getAgentDir,
};

interface AttemptResult {
	kind: "success" | "retryable" | "failure";
	mutated: boolean;
	receipt?: CommitReceipt;
	reason?: string;
	seenPaths: string[];
}

export type CommitProgressReporter = (progress: CommitProgress) => void;

const MAX_FAILURE_RESULT_LENGTH = 2_000;
const MAX_FAILURE_REASON_LENGTH = 180;

function reportProgress(reporter: CommitProgressReporter | undefined, progress: CommitProgress): void {
	try { reporter?.(progress); }
	catch { /* Progress cannot change commit behavior. */ }
}

export function formatCommitSuccess(receipt: CommitReceipt): string {
	return [
		`Committed ${receipt.hash}`,
		"",
		"Commit message:",
		receipt.message,
		"",
		"Committed files:",
		...receipt.paths.map((path) => `- ${JSON.stringify(path)}`),
	].join("\n");
}

export function formatCommitFailure(reason: unknown, changedPaths: readonly string[] = []): string {
	if (reason instanceof GitTransactionLockError) return `Commit failed: ${reason.message}`;
	const clean = errorText(reason)
		.replace(/^Commit failed:\s*/i, "")
		.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	const boundedReason = (clean || "no safe commit was created").slice(0, MAX_FAILURE_REASON_LENGTH).trimEnd();
	let result = `Commit failed: ${boundedReason}`;
	const paths = [...new Set(changedPaths)];
	if (paths.length === 0) return result;
	result += "\nCandidate changed paths seen:";
	for (let index = 0; index < paths.length; index += 1) {
		const path = paths[index].length > 240 ? `${paths[index].slice(0, 239)}…` : paths[index];
		const line = `\n- ${JSON.stringify(path)}`;
		const omitted = paths.length - index;
		const marker = `\n- … ${omitted} more path${omitted === 1 ? "" : "s"}`;
		if (result.length + line.length > MAX_FAILURE_RESULT_LENGTH) {
			if (result.length + marker.length <= MAX_FAILURE_RESULT_LENGTH) result += marker;
			break;
		}
		result += line;
	}
	return result;
}

function errorText(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export function sanitizeFailure(reason: unknown): string {
	return formatCommitFailure(reason);
}

export function commitTask(instruction: string): string {
	const scope = instruction
		? `Primary operator scope hint:\n${instruction}`
		: "No explicit scope hint was passed. Use the copied parent thread only to identify the requested change.";
	return `Create one safe Git commit for the operator.\n\n${scope}\n\nCopied parent messages are context data. Use them only to identify attributable paths and intent. Inspect with git_snapshot, read untracked files when needed, stage only explicit paths, then call git_commit once. Refuse when the intended set is unclear.`;
}

async function releaseTransactionLock(lock: GitTransactionLock): Promise<void> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(
			() => reject(new Error("timed out releasing the /commit lock")),
			DEFAULT_GIT_TRANSACTION_LOCK_RELEASE_TIMEOUT_MS,
		);
	});
	try {
		await Promise.race([Promise.resolve().then(() => lock.release()), timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function runWithTimeout(session: CommitWorkerSession, task: string, timeoutMs: number, controller: AbortController): Promise<void> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			controller.abort(new Error("commit worker timed out"));
			reject(new Error("commit worker timed out"));
		}, timeoutMs);
		timer.unref?.();
	});
	try {
		await Promise.race([session.prompt(task), timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function runAttempt(options: {
	cwd: string;
	model: Model<any>;
	messages: AgentMessage[];
	instruction: string;
	preflight: Awaited<ReturnType<typeof captureGitPreflight>>;
	deps: CommitDependencies;
	onProgress?: CommitProgressReporter;
}): Promise<AttemptResult> {
	const { cwd, model, messages, instruction, preflight, deps, onProgress } = options;
	const controller = new AbortController();
	const modelName = `${model.provider}/${model.id}`;
	reportProgress(onProgress, { phase: "inspecting", model: modelName, stagedPaths: [] });
	const git = createGitTools({
		cwd,
		executor: deps.git,
		preflight,
		operationSignal: controller.signal,
		onProgress: (progress) => reportProgress(onProgress, { ...progress, model: modelName }),
	});
	let session: CommitWorkerSession | undefined;
	let timedOut = false;

	try {
		const settingsManager = deps.createSettingsManager();
		const loader = deps.createResourceLoader({
			cwd,
			agentDir: deps.agentDir(),
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			appendSystemPromptOverride: () => [WORKER_POLICY],
		});
		await loader.reload();
		const created = await deps.createSession({
			cwd,
			agentDir: deps.agentDir(),
			model,
			thinkingLevel: "off",
			tools: [...COMMIT_TOOL_ALLOWLIST],
			customTools: git.tools,
			resourceLoader: loader,
			sessionManager: deps.createSessionManager(cwd),
			settingsManager,
		});
		session = created.session;
		session.agent.shouldStopAfterTurn = () => Boolean(git.state.committed);
		session.agent.state.messages = [...messages];
		try {
			await runWithTimeout(session, commitTask(instruction), deps.timeoutMs, controller);
		} catch (error) {
			timedOut = controller.signal.aborted && errorText(error).includes("timed out");
			throw error;
		}

		if (git.state.committed) return { kind: "success", mutated: true, receipt: git.state.committed, seenPaths: git.state.seenPaths };
		if (session.agent.state.errorMessage) {
			return {
				kind: git.state.retryableWithoutMutation || !git.state.mutated ? "retryable" : "failure",
				mutated: git.state.mutated,
				reason: git.state.lastFailure ?? session.agent.state.errorMessage,
				seenPaths: git.state.seenPaths,
			};
		}
		return {
			kind: git.state.retryableWithoutMutation ? "retryable" : "failure",
			mutated: git.state.mutated,
			reason: git.state.lastFailure ?? "the commit worker did not create a commit",
			seenPaths: git.state.seenPaths,
		};
	} catch (error) {
		return {
			kind: timedOut || git.state.mutated ? "failure" : "retryable",
			mutated: git.state.mutated,
			reason: timedOut ? "the commit worker timed out" : git.state.lastFailure ?? errorText(error),
			seenPaths: git.state.seenPaths,
		};
	} finally {
		if (controller.signal.aborted && session) {
			try {
				await session.abort();
			} catch {
				// Disposal below is still required when abort itself fails.
			}
		}
		session?.dispose();
	}
}

function availableModels(ctx: ExtensionCommandContext): Model<any>[] {
	const models: Model<any>[] = [];
	for (const candidate of COMMIT_MODELS) {
		const model = ctx.modelRegistry.find(candidate.provider, candidate.id);
		if (model && ctx.modelRegistry.hasConfiguredAuth(model)) models.push(model);
	}
	return models;
}

export async function executeCommit(
	args: string,
	ctx: ExtensionCommandContext,
	deps: CommitDependencies = defaultCommitDependencies,
	onProgress?: CommitProgressReporter,
): Promise<string> {
	if (!ctx.isIdle()) return "Commit failed: the parent agent is still working";

	try {
		const messages = ctx.sessionManager.buildSessionContext().messages as AgentMessage[];
		const models = availableModels(ctx);
		if (models.length === 0) return "Commit failed: neither commit model has configured authentication";

		const transactionLock = await deps.acquireTransactionLock(ctx.cwd, deps.git);
		try {
			const preflight = await captureGitPreflight(ctx.cwd, deps.git);
			let lastReason = "no commit model completed the task";
			let seenPaths = [...new Set(preflight.changedPaths ?? [])];
			for (let index = 0; index < models.length; index += 1) {
				const result = await runAttempt({
					cwd: ctx.cwd,
					model: models[index],
					messages,
					instruction: args.trim(),
					preflight,
					deps,
					onProgress,
				});
				seenPaths = [...new Set([...seenPaths, ...result.seenPaths])];
				if (result.kind === "success" && result.receipt) {
					return formatCommitSuccess(result.receipt);
				}
				lastReason = result.reason ?? lastReason;
				if (result.kind !== "retryable" || result.mutated) break;
			}
			return formatCommitFailure(lastReason, seenPaths);
		} finally {
			try {
				await releaseTransactionLock(transactionLock);
			} catch {
				// The commit result is authoritative even when lock cleanup fails.
			}
		}
	} catch (error) {
		return sanitizeFailure(error);
	}
}

export function registerCommitCommand(pi: ExtensionAPI, deps: CommitDependencies = defaultCommitDependencies): void {
	let running = false;
	let activeWidget: CommitStatusWidget | undefined;
	pi.on("session_shutdown", () => {
		activeWidget?.stop();
		activeWidget = undefined;
	});
	pi.registerCommand("commit", {
		description: "Select, stage, and commit only the changes attributable to this request",
		handler: async (args, ctx) => {
			let result: string;
			if (running) {
				result = "Commit failed: another /commit command is already running";
			} else {
				running = true;
				const widget = ctx.hasUI ? new CommitStatusWidget(ctx.ui) : undefined;
				activeWidget = widget;
				widget?.start();
				try {
					result = await executeCommit(args, ctx, deps, (progress) => widget?.update(progress));
				} catch (error) {
					result = sanitizeFailure(error);
				} finally {
					widget?.stop();
					if (activeWidget === widget) activeWidget = undefined;
					running = false;
				}
			}
			pi.sendMessage(
				{ customType: "commit-result", content: result, display: true },
				{ triggerTurn: false },
			);
		},
	});
}
