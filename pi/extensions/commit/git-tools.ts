import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { link, lstat, open, readlink, realpath, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const PROCESS_MAX_BUFFER = 4 * 1024 * 1024;
const SNAPSHOT_MAX_BYTES = 48 * 1024;
const SNAPSHOT_SECTION_BUDGETS = {
	status: 6 * 1024,
	stat: 4 * 1024,
	"unstaged diff": 16 * 1024,
	"staged diff": 20 * 1024,
} as const;
const MAX_PATHS = 100;
const MAX_PATH_BYTES = 1024;
export const MAX_COMMIT_MESSAGE_LENGTH = 200;
export const DEFAULT_GIT_TRANSACTION_LOCK_RELEASE_TIMEOUT_MS = 100;

export interface GitResult {
	stdout: string;
	stderr: string;
	code: number;
}

export interface GitExecutor {
	run(cwd: string, args: readonly string[], signal?: AbortSignal): Promise<GitResult>;
}

export interface CommitReceipt {
	hash: string;
	subject: string;
}

export interface GitMutationState {
	mutated: boolean;
	commitAttempts: number;
	committed?: CommitReceipt;
	lastFailure?: string;
	retryableWithoutMutation?: boolean;
}

export interface GitPreflight {
	head: string;
	status: string;
	cachedNames: string;
}

export interface GitTransactionLock {
	readonly indexPath: string;
	readonly lockPath: string;
	release(): Promise<void>;
}

export class ProcessGitExecutor implements GitExecutor {
	async run(cwd: string, args: readonly string[], signal?: AbortSignal): Promise<GitResult> {
		return new Promise((done) => {
			execFile(
				"git",
				[...args],
				{ cwd, encoding: "utf8", maxBuffer: PROCESS_MAX_BUFFER, signal },
				(error, stdout, stderr) => {
					const code = typeof (error as NodeJS.ErrnoException | null)?.code === "number"
						? (error as NodeJS.ErrnoException & { code: number }).code
						: error
							? -1
							: 0;
					done({ stdout: String(stdout ?? ""), stderr: String(stderr ?? error?.message ?? ""), code });
				},
			);
		});
	}
}

function oneLine(value: string): string {
	return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
}

function commandError(result: GitResult, fallback: string): Error {
	return new Error(oneLine(result.stderr || result.stdout || fallback));
}

async function checked(
	executor: GitExecutor,
	cwd: string,
	args: readonly string[],
	signal?: AbortSignal,
): Promise<GitResult> {
	const result = await executor.run(cwd, args, signal);
	if (result.code !== 0) throw commandError(result, `git ${args[0] ?? "command"} failed`);
	return result;
}

export async function readHead(cwd: string, executor: GitExecutor, signal?: AbortSignal): Promise<string> {
	const result = await executor.run(cwd, ["rev-parse", "--verify", "HEAD"], signal);
	if (result.code === 0) return result.stdout.trim();
	const inside = await executor.run(cwd, ["rev-parse", "--is-inside-work-tree"], signal);
	if (inside.code === 0 && inside.stdout.trim() === "true") return "(unborn)";
	throw commandError(result, "not a Git repository");
}

export async function captureGitPreflight(
	cwd: string,
	executor: GitExecutor,
	signal?: AbortSignal,
): Promise<GitPreflight> {
	const head = await readHead(cwd, executor, signal);
	const status = await checked(executor, cwd, ["status", "--short", "--untracked-files=all"], signal);
	const cached = await checked(executor, cwd, ["diff", "--cached", "--name-status", "--"], signal);
	return { head, status: status.stdout, cachedNames: cached.stdout };
}

async function canonicalIndexPath(indexPath: string): Promise<string> {
	let candidate = resolve(indexPath);
	const followedLinks = new Set<string>();

	while (true) {
		try {
			return await realpath(candidate);
		} catch (error) {
			if (errorCode(error) !== "ENOENT" && errorCode(error) !== "ELOOP") throw error;
		}

		try {
			const entry = await lstat(candidate);
			if (!entry.isSymbolicLink()) throw new Error(`could not resolve Git index path ${candidate}`);
			if (followedLinks.has(candidate)) throw new Error(`Git index symlink loop at ${candidate}`);
			followedLinks.add(candidate);
			const target = await readlink(candidate);
			candidate = isAbsolute(target) ? resolve(target) : resolve(dirname(candidate), target);
		} catch (error) {
			if (errorCode(error) !== "ENOENT") throw error;
			// An unborn or custom index may not exist yet. Canonicalize its existing parent instead.
			const canonicalDirectory = await realpath(dirname(candidate));
			return join(canonicalDirectory, basename(candidate));
		}
	}
}

async function gitIndexIdentity(cwd: string, executor: GitExecutor, signal?: AbortSignal): Promise<string> {
	const result = await checked(executor, cwd, ["rev-parse", "--git-path", "index"], signal);
	const reportedPath = result.stdout.trim();
	if (!reportedPath) throw new Error("Git did not report an index path");
	const indexPath = isAbsolute(reportedPath) ? reportedPath : resolve(cwd, reportedPath);
	return canonicalIndexPath(indexPath);
}

function errorCode(error: unknown): string | undefined {
	return (error as NodeJS.ErrnoException | null)?.code;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export class GitTransactionLockError extends Error {}

function contentionError(lockPath: string): GitTransactionLockError {
	return new GitTransactionLockError(`the /commit lock exists at ${lockPath}; clear it with: rm -- ${shellQuote(lockPath)}`);
}

async function releaseWithin(operation: Promise<void>, timeoutMs: number): Promise<void> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error("timed out releasing the /commit lock")), timeoutMs);
	});
	try {
		await Promise.race([operation, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export async function acquireGitTransactionLock(
	cwd: string,
	executor: GitExecutor,
	signal?: AbortSignal,
): Promise<GitTransactionLock> {
	const indexPath = await gitIndexIdentity(cwd, executor, signal);
	const lockPath = `${indexPath}.pi-commit.lock`;
	const tempPath = `${lockPath}.${process.pid}.${randomUUID()}.tmp`;
	const holderContents = `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`;
	let holderFile: Awaited<ReturnType<typeof open>> | undefined;
	let published = false;

	try {
		if (signal?.aborted) throw signal.reason ?? new Error("Git transaction lock acquisition aborted");
		try {
			await lstat(lockPath);
			throw contentionError(lockPath);
		} catch (error) {
			if (error instanceof GitTransactionLockError) throw error;
			if (errorCode(error) !== "ENOENT") {
				throw new GitTransactionLockError(`could not inspect the /commit lock at ${lockPath}: ${oneLine(errorMessage(error))}`);
			}
		}
		holderFile = await open(tempPath, "wx", 0o600);
		await holderFile.writeFile(holderContents, "utf8");
		await holderFile.sync();
		if (signal?.aborted) throw signal.reason ?? new Error("Git transaction lock acquisition aborted");
		try {
			await link(tempPath, lockPath);
		} catch (error) {
			if (errorCode(error) === "EEXIST") throw contentionError(lockPath);
			throw new GitTransactionLockError(`could not atomically publish the /commit lock at ${lockPath}: ${oneLine(errorMessage(error))}`);
		}
		published = true;
		await unlink(tempPath);
		const owned = await holderFile.stat({ bigint: true });
		let releasePromise: Promise<void> | undefined;

		return {
			indexPath,
			lockPath,
			release() {
				releasePromise ??= releaseWithin((async () => {
					try {
						let current: Awaited<ReturnType<typeof stat>>;
						try {
							current = await stat(lockPath, { bigint: true });
						} catch (error) {
							if (errorCode(error) === "ENOENT") return;
							throw error;
						}
						if (current.dev !== owned.dev || current.ino !== owned.ino) {
							throw new Error("the /commit lock changed owners before release");
						}
						await unlink(lockPath);
					} finally {
						await holderFile?.close();
					}
				})(), DEFAULT_GIT_TRANSACTION_LOCK_RELEASE_TIMEOUT_MS);
				return releasePromise;
			},
		};
	} catch (error) {
		if (published) {
			try {
				await unlink(lockPath);
			} catch {
				// Preserve the acquisition error. A published claim is still visible to the operator.
			}
		}
		try {
			await unlink(tempPath);
		} catch (cleanupError) {
			if (errorCode(cleanupError) !== "ENOENT") {
				await holderFile?.close().catch(() => {});
				throw new GitTransactionLockError(`could not remove the temporary /commit lock at ${tempPath}: ${oneLine(errorMessage(cleanupError))}`);
			}
		}
		await holderFile?.close().catch(() => {});
		if (error instanceof GitTransactionLockError) throw error;
		throw new GitTransactionLockError(`could not create the /commit lock at ${lockPath}: ${oneLine(errorMessage(error))}`);
	}
}

export function validateStagePaths(input: readonly string[], cwd: string): string[] {
	if (input.length === 0) throw new Error("git_stage needs at least one path");
	if (input.length > MAX_PATHS) throw new Error(`git_stage accepts at most ${MAX_PATHS} paths`);

	return input.map((raw) => {
		const path = raw.startsWith("@") ? raw.slice(1) : raw;
		if (!path || path === ".") throw new Error("stage paths must name a file or directory");
		if (Buffer.byteLength(path, "utf8") > MAX_PATH_BYTES) throw new Error("a stage path is too long");
		if (/^[\-:]/.test(path)) throw new Error("stage paths cannot look like options or Git pathspec magic");
		if (/[\u0000-\u001f\u007f\u2028\u2029*?[\]]/.test(path)) throw new Error("stage paths cannot contain controls or pathspec wildcards");
		if (isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path)) throw new Error("stage paths must be relative");
		const parts = path.replaceAll("\\", "/").split("/");
		if (parts.some((part) => part === "..")) throw new Error("stage paths cannot traverse outside the repository");
		const absolute = resolve(cwd, path);
		const root = resolve(cwd);
		if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
			throw new Error("stage paths must stay inside the repository");
		}
		return path;
	});
}

export function validateCommitMessage(message: string): string {
	if (message !== message.trim() || message.length === 0) throw new Error("commit message must be non-empty and trimmed");
	if (message.length > MAX_COMMIT_MESSAGE_LENGTH) {
		throw new Error(`commit message must be at most ${MAX_COMMIT_MESSAGE_LENGTH} characters`);
	}
	if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(message)) throw new Error("commit message must be one line without control characters");
	return message;
}

function clipToBytes(value: string, maxBytes: number): string {
	if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
	let clipped = value.slice(0, maxBytes);
	while (Buffer.byteLength(clipped, "utf8") > maxBytes) clipped = clipped.slice(0, -1);
	return clipped;
}

function snapshotSection(label: keyof typeof SNAPSHOT_SECTION_BUDGETS, body: string): string {
	const prefix = `## ${label}\n`;
	const budget = SNAPSHOT_SECTION_BUDGETS[label];
	const value = body || "(empty)";
	const full = `${prefix}${value}`;
	if (Buffer.byteLength(full, "utf8") <= budget) return full;
	const marker = `\n[${label} truncated.]`;
	const bodyBudget = budget - Buffer.byteLength(prefix + marker, "utf8");
	return `${prefix}${clipToBytes(value, bodyBudget)}${marker}`;
}

function formatSnapshot(parts: Array<[keyof typeof SNAPSHOT_SECTION_BUDGETS, string]>): string {
	const snapshot = parts.map(([label, body]) => snapshotSection(label, body)).join("\n\n");
	if (Buffer.byteLength(snapshot, "utf8") > SNAPSHOT_MAX_BYTES) {
		throw new Error("snapshot section budgets exceed the total snapshot budget");
	}
	return snapshot;
}

async function assertHeadUnchanged(
	cwd: string,
	executor: GitExecutor,
	initialHead: string,
	signal?: AbortSignal,
): Promise<void> {
	const currentHead = await readHead(cwd, executor, signal);
	if (currentHead !== initialHead) throw new Error("HEAD moved while /commit was running");
}

export function createGitTools(options: {
	cwd: string;
	executor: GitExecutor;
	preflight: GitPreflight;
	operationSignal: AbortSignal;
}): { tools: ToolDefinition[]; state: GitMutationState } {
	const { cwd, executor, preflight, operationSignal } = options;
	const state: GitMutationState = { mutated: false, commitAttempts: 0 };
	const signalFor = (toolSignal?: AbortSignal) => toolSignal
		? AbortSignal.any([operationSignal, toolSignal])
		: operationSignal;
	const recordFailure = (error: unknown): never => {
		state.lastFailure ??= oneLine(error instanceof Error ? error.message : String(error));
		throw error;
	};

	const snapshot = defineTool({
		name: "git_snapshot",
		label: "Git snapshot",
		description: "Show bounded status, stat, unstaged diff, and staged diff for the current repository. Use read for untracked file contents.",
		parameters: Type.Object({}),
		async execute(_id, _params, toolSignal) {
			try {
				const signal = signalFor(toolSignal);
				const commands: Array<[keyof typeof SNAPSHOT_SECTION_BUDGETS, string[]]> = [
					["status", ["status", "--short", "--untracked-files=all"]],
					["stat", ["diff", "--stat", "--"]],
					["unstaged diff", ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--"]],
					["staged diff", ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--no-color", "--"]],
				];
				const parts: Array<[keyof typeof SNAPSHOT_SECTION_BUDGETS, string]> = [];
				for (const [label, args] of commands) {
					const result = await checked(executor, cwd, args, signal);
					parts.push([label, result.stdout]);
				}
				return { content: [{ type: "text", text: formatSnapshot(parts) }], details: {} };
			} catch (error) {
				return recordFailure(error);
			}
		},
	});

	const stage = defineTool({
		name: "git_stage",
		label: "Stage Git paths",
		executionMode: "sequential",
		description: "Stage only the explicit relative repository paths attributable to the operator's request. Never pass a repository-wide path.",
		parameters: Type.Object({
			paths: Type.Array(Type.String(), { minItems: 1, maxItems: MAX_PATHS }),
		}),
		async execute(_id, params, toolSignal) {
			try {
				if (state.commitAttempts > 0) throw new Error("staging is closed after git_commit starts");
				const signal = signalFor(toolSignal);
				const paths = validateStagePaths(params.paths, cwd);
				await assertHeadUnchanged(cwd, executor, preflight.head, signal);
				state.mutated = true;
				await checked(executor, cwd, ["add", "--", ...paths], signal);
				return {
					content: [{ type: "text", text: `Staged ${paths.length} explicit path${paths.length === 1 ? "" : "s"}.` }],
					details: { paths },
				};
			} catch (error) {
				return recordFailure(error);
			}
		},
	});

	const commit = defineTool({
		name: "git_commit",
		label: "Create Git commit",
		executionMode: "sequential",
		description: "Create one verified commit with a single-line subject. Hooks run normally. This is the final action.",
		parameters: Type.Object({ message: Type.String({ minLength: 1, maxLength: MAX_COMMIT_MESSAGE_LENGTH }) }),
		async execute(_id, params, toolSignal) {
			try {
				state.commitAttempts += 1;
				if (state.commitAttempts > 1) throw new Error("git_commit may be called only once");
				const signal = signalFor(toolSignal);
				let message: string;
				try {
					message = validateCommitMessage(params.message);
				} catch (error) {
					if (!state.mutated) state.retryableWithoutMutation = true;
					throw error;
				}
				await assertHeadUnchanged(cwd, executor, preflight.head, signal);

				const index = await executor.run(cwd, ["diff", "--cached", "--quiet", "--exit-code", "--"], signal);
				if (index.code === 0) throw new Error("there are no staged changes to commit");
				if (index.code !== 1) throw commandError(index, "could not inspect the staged changes");

				state.mutated = true;
				await checked(executor, cwd, ["commit", "-m", message], signal);
				const hashResult = await checked(executor, cwd, ["rev-parse", "--short=12", "HEAD"], signal);
				const subjectResult = await checked(executor, cwd, ["log", "-1", "--format=%s"], signal);
				const hash = hashResult.stdout.trim();
				const subject = oneLine(subjectResult.stdout).slice(0, MAX_COMMIT_MESSAGE_LENGTH);
				if (!/^[0-9a-f]{7,64}$/i.test(hash) || !subject) throw new Error("commit succeeded but its receipt was invalid");
				state.committed = { hash, subject };
				return {
					content: [{ type: "text", text: `Commit created: ${hash}` }],
					details: state.committed,
					terminate: true,
				};
			} catch (error) {
				return recordFailure(error);
			}
		},
	});

	return { tools: [snapshot, stage, commit], state };
}
