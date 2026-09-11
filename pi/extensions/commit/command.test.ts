import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type Model } from "@earendil-works/pi-ai";
import { createAgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
	COMMIT_MODELS,
	COMMIT_TOOL_ALLOWLIST,
	commitTask,
	defaultCommitDependencies,
	executeCommit,
	formatCommitFailure,
	registerCommitCommand,
	sanitizeFailure,
	type CommitDependencies,
	type CommitWorkerSession,
} from "./command.ts";
import { acquireGitTransactionLock, ProcessGitExecutor, type GitExecutor, type GitResult } from "./git-tools.ts";

class FakeGit implements GitExecutor {
	readonly calls: string[][] = [];
	head = "1111111111111111111111111111111111111111";
	message = "test: selected change";
	paths = ["file.ts"];

	async run(_cwd: string, args: readonly string[]): Promise<GitResult> {
		this.calls.push([...args]);
		if (args[0] === "rev-parse" && args[1] === "--verify") return ok(this.head);
		if (args[0] === "rev-parse" && String(args[1]).startsWith("--short")) return ok(this.head.slice(0, 12));
		if (args[0] === "status" && args.includes("-z")) return ok(" M file.ts\0");
		if (args[0] === "status") return ok(" M file.ts\n");
		if (args[0] === "diff" && args.includes("--quiet")) return { stdout: "", stderr: "", code: 1 };
		if (args[0] === "diff") return ok("");
		if (args[0] === "add") return ok("");
		if (args[0] === "commit") {
			this.head = "abcdef1234567890abcdef1234567890abcdef12";
			return ok("committed");
		}
		if (args[0] === "log") return ok(`${this.message}\n`);
		if (args[0] === "diff-tree") return ok(`${this.paths.join("\0")}\0`);
		throw new Error(`unexpected git call: ${args.join(" ")}`);
	}
}

function ok(stdout: string): GitResult {
	return { stdout, stderr: "", code: 0 };
}

function success(hash = "abcdef123456", message = "test: selected change", paths = ["file.ts"]): string {
	return [
		`Committed ${hash}`,
		"",
		"Commit message:",
		message,
		"",
		"Committed files:",
		...paths.map((path) => `- ${JSON.stringify(path)}`),
	].join("\n");
}

function model(provider: string, id: string): any {
	return {
		provider,
		id,
		name: id,
		api: "openai-completions",
		baseUrl: "http://127.0.0.1.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8_192,
		maxTokens: 1_024,
	};
}

function context(options: {
	cwd?: string;
	idle?: boolean;
	models?: any[];
	messages?: AgentMessage[];
	setWidget?: (key: string, lines: string[] | undefined) => void;
} = {}): any {
	const models = options.models ?? COMMIT_MODELS.map((entry) => model(entry.provider, entry.id));
	return {
		cwd: options.cwd ?? "/repo",
		isIdle: () => options.idle ?? true,
		hasUI: Boolean(options.setWidget),
		ui: { setWidget: options.setWidget ?? (() => {}) },
		sessionManager: { buildSessionContext: () => ({ messages: options.messages ?? [] }) },
		modelRegistry: {
			find: (provider: string, id: string) => models.find((entry) => entry.provider === provider && entry.id === id),
			hasConfiguredAuth: () => true,
		},
	};
}

interface FakeDepsOptions {
	git?: FakeGit;
	timeoutMs?: number;
	onCreate?: (options: any, index: number) => Promise<CommitWorkerSession> | CommitWorkerSession;
}

function fakeDependencies(options: FakeDepsOptions = {}): {
	deps: CommitDependencies;
	git: FakeGit;
	created: any[];
	loaders: any[];
	locks: Array<{ released: boolean }>;
	sessions: CommitWorkerSession[];
} {
	const git = options.git ?? new FakeGit();
	const created: any[] = [];
	const loaders: any[] = [];
	const locks: Array<{ released: boolean }> = [];
	const sessions: CommitWorkerSession[] = [];
	const deps: CommitDependencies = {
		git,
		timeoutMs: options.timeoutMs ?? 100,
		async acquireTransactionLock() {
			const lock = { released: false };
			locks.push(lock);
			return {
				indexPath: "/repo/.git/index",
				lockPath: "/repo/.git/index.pi-commit.lock",
				async release() { lock.released = true; },
			};
		},
		createResourceLoader(loaderOptions: any) {
			loaders.push(loaderOptions);
			return { reload: async () => {} } as any;
		},
		async createSession(sessionOptions: any) {
			const index = created.length;
			created.push(sessionOptions);
			const session = options.onCreate
				? await options.onCreate(sessionOptions, index)
				: committingSession(sessionOptions);
			sessions.push(session);
			return { session };
		},
		createSessionManager: () => ({}) as any,
		createSettingsManager: () => ({}) as any,
		agentDir: () => "/agent",
	};
	return { deps, git, created, loaders, locks, sessions };
}

function toolCallStream(modelValue: Model<any>, calls: Array<{ id: string; name: string; arguments: unknown }>) {
	const stream = createAssistantMessageEventStream();
	queueMicrotask(() => {
		const message: AssistantMessage = {
			role: "assistant",
			content: [],
			api: modelValue.api,
			provider: modelValue.provider,
			model: modelValue.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "pending",
			timestamp: Date.now(),
		};
		stream.push({ type: "start", partial: message });
		for (const call of calls) {
			const toolCall = { type: "toolCall" as const, ...call };
			message.content.push(toolCall);
			const contentIndex = message.content.length - 1;
			stream.push({ type: "toolcall_start", contentIndex, partial: message });
			stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: message });
		}
		message.stopReason = "toolUse";
		stream.push({ type: "done", reason: "toolUse", message });
		stream.end();
	});
	return stream;
}

function committingSession(options: any, onPrompt?: (task: string, session: CommitWorkerSession) => void): CommitWorkerSession {
	const state: { messages: AgentMessage[]; errorMessage?: string } = { messages: [] };
	const session: CommitWorkerSession = {
		agent: { state },
		async prompt(task) {
			onPrompt?.(task, session);
			state.messages.push({ role: "assistant", content: [{ type: "text", text: "Committed wronghash: wrong prose" }] } as any);
			const stage = options.customTools.find((tool: any) => tool.name === "git_stage");
			const commit = options.customTools.find((tool: any) => tool.name === "git_commit");
			await stage.execute("stage", { paths: ["file.ts"] }, undefined, undefined, {});
			await commit.execute("commit", { message: "test: selected change" }, undefined, undefined, {});
		},
		async abort() {},
		dispose() {},
	};
	return session;
}

test("success widget shows live phases and clears before one non-triggering result", async () => {
	const sent: any[] = [];
	const timeline: string[] = [];
	const widgetUpdates: Array<string[] | undefined> = [];
	let command: any;
	const { deps, git, locks } = fakeDependencies();
	git.message = "test: selected change\n\nExplain why this commit exists.";
	git.paths = ["file.ts", "README.md"];
	registerCommitCommand({
		on() {},
		registerCommand(name: string, spec: any) {
			assert.equal(name, "commit");
			command = spec;
		},
		sendMessage(message: any, options: any) { timeline.push("result"); sent.push({ message, options }); },
	} as any, deps);

	assert.ok(command);
	await command.handler("file.ts", context({
		setWidget(_key, lines) {
			timeline.push(lines ? "widget" : "clear");
			widgetUpdates.push(lines);
		},
	}));
	assert.deepEqual(sent, [{
		message: { customType: "commit-result", content: success("abcdef123456", git.message, git.paths), display: true },
		options: { triggerTurn: false },
	}]);
	assert.equal(locks.length, 1);
	assert.equal(locks[0].released, true);
	assert.ok(widgetUpdates.some((lines) => lines?.[0]?.includes("/commit  luna")));
	assert.ok(widgetUpdates.some((lines) => lines?.[1] === "staging  1 file" && lines.includes("  file.ts")));
	assert.ok(widgetUpdates.some((lines) => lines?.[1] === "committing  1 file"));
	assert.deepEqual(timeline.slice(-2), ["clear", "result"]);
});

test("failure widget clears before the missing-auth result", async () => {
	const timeline: string[] = [];
	let command: any;
	const { deps } = fakeDependencies();
	registerCommitCommand({
		on() {},
		registerCommand(_name: string, spec: any) { command = spec; },
		sendMessage() { timeline.push("result"); },
	} as any, deps);

	await command.handler("file.ts", context({
		models: [],
		setWidget(_key, lines) { timeline.push(lines ? "widget" : "clear"); },
	}));
	assert.equal(timeline[0], "widget");
	assert.deepEqual(timeline.slice(-2), ["clear", "result"]);
});

test("timeout abort clears the widget before its failure result", async () => {
	const timeline: string[] = [];
	let command: any;
	let aborted = 0;
	const { deps } = fakeDependencies({
		timeoutMs: 5,
		onCreate() {
			return {
				agent: { state: { messages: [] } },
				prompt: async () => new Promise<void>(() => {}),
				async abort() { aborted += 1; },
				dispose() {},
			};
		},
	});
	registerCommitCommand({
		on() {},
		registerCommand(_name: string, spec: any) { command = spec; },
		sendMessage() { timeline.push("result"); },
	} as any, deps);

	await command.handler("file.ts", context({
		setWidget(_key, lines) { timeline.push(lines ? "widget" : "clear"); },
	}));
	assert.equal(aborted, 1);
	assert.ok(timeline.includes("widget"));
	assert.deepEqual(timeline.slice(-2), ["clear", "result"]);
});

test("session shutdown tears down a live widget and prevents later repaint", async () => {
	const widgetUpdates: Array<string[] | undefined> = [];
	let command: any;
	let shutdown: any;
	let release!: () => void;
	const blocked = new Promise<void>((resolve) => { release = resolve; });
	const { deps } = fakeDependencies({
		onCreate(options) {
			const session = committingSession(options);
			session.prompt = async () => { await blocked; };
			return session;
		},
	});
	registerCommitCommand({
		on(name: string, handler: any) { if (name === "session_shutdown") shutdown = handler; },
		registerCommand(_name: string, spec: any) { command = spec; },
		sendMessage() {},
	} as any, deps);
	const ctx = context({ setWidget(_key, lines) { widgetUpdates.push(lines); } });

	const pending = command.handler("file.ts", ctx);
	await new Promise((resolve) => setImmediate(resolve));
	await shutdown({}, ctx);
	const updatesAfterShutdown = widgetUpdates.length;
	assert.equal(widgetUpdates.at(-1), undefined);
	release();
	await pending;
	assert.equal(widgetUpdates.length, updatesAfterShutdown);
});

test("copies active context, treats instruction as primary, and disables project resources", async () => {
	const messages = [{ role: "user", content: "Change file.ts", timestamp: 1 }] as AgentMessage[];
	let task = "";
	let copiedBeforePrompt: AgentMessage[] = [];
	const { deps, created, loaders } = fakeDependencies({
		onCreate(options) {
			return committingSession(options, (value, session) => {
				task = value;
				copiedBeforePrompt = [...session.agent.state.messages];
			});
		},
	});
	const result = await executeCommit("  only file.ts  ", context({ messages }), deps);
	assert.match(result, /^Committed /);
	assert.deepEqual(copiedBeforePrompt, messages);
	assert.match(task, /Primary operator scope hint:\nonly file\.ts/);
	assert.match(commitTask(""), /copied parent thread/);
	assert.deepEqual(created[0].tools, [...COMMIT_TOOL_ALLOWLIST]);
	assert.equal(created[0].thinkingLevel, "off");
	assert.deepEqual(created[0].customTools.map((tool: any) => tool.name), ["git_snapshot", "git_stage", "git_commit"]);
	for (const key of ["noExtensions", "noSkills", "noPromptTemplates", "noThemes", "noContextFiles"]) {
		assert.equal(loaders[0][key], true, `${key} is enabled`);
	}
	assert.equal(loaders[0].appendSystemPromptOverride([]).length, 1);
	assert.ok(!created[0].tools.includes("bash"));
	assert.ok(!created[0].tools.includes("edit"));
	assert.ok(!created[0].tools.includes("write"));
	assert.ok(!created[0].tools.includes("delegate"));
});

test("a real AgentSession preserves copied tool history, allowlists tools, serializes a multi-tool turn, and stops after commit", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-commit-agent-session-"));
	const git = new FakeGit();
	let stageFinished = false;
	const scheduling: string[] = [];
	git.run = async (_cwd: string, args: readonly string[]): Promise<GitResult> => {
		git.calls.push([...args]);
		if (args[0] === "rev-parse" && args[1] === "--verify") return ok(git.head);
		if (args[0] === "rev-parse" && String(args[1]).startsWith("--short")) return ok(git.head.slice(0, 12));
		if (args[0] === "status" && args.includes("-z")) return ok(" M file.ts\0");
		if (args[0] === "status") return ok(" M file.ts\n");
		if (args[0] === "diff" && args.includes("--quiet")) {
			scheduling.push("index-check");
			return stageFinished ? { stdout: "", stderr: "", code: 1 } : ok("");
		}
		if (args[0] === "diff") return ok("");
		if (args[0] === "add") {
			scheduling.push("stage-start");
			await new Promise((resolve) => setTimeout(resolve, 20));
			stageFinished = true;
			scheduling.push("stage-end");
			return ok("");
		}
		if (args[0] === "commit") {
			scheduling.push("commit");
			git.head = "abcdef1234567890abcdef1234567890abcdef12";
			return ok("committed");
		}
		if (args[0] === "log") return ok("test: real agent session\n\nBody from the commit hook.\n");
		if (args[0] === "diff-tree") return ok("file.ts\0");
		throw new Error(`unexpected git call: ${args.join(" ")}`);
	};

	const copiedMessages = [
		{ role: "user", content: [{ type: "text", text: "Inspect file.ts" }], timestamp: 1 },
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "old-read", name: "read", arguments: { path: "file.ts" } }],
			api: "openai-completions",
			provider: "openai-codex",
			model: "gpt-5.6-luna",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "toolUse",
			timestamp: 2,
		},
		{ role: "toolResult", toolCallId: "old-read", toolName: "read", content: [{ type: "text", text: "old content" }], isError: false, timestamp: 3 },
	] as AgentMessage[];
	let providerCalls = 0;
	let seenContext: Context | undefined;
	const modelRuntime = await ModelRuntime.create();
	await modelRuntime.setRuntimeApiKey("openai-codex", "local-test-key");
	const deps: CommitDependencies = {
		...defaultCommitDependencies,
		git,
		timeoutMs: 1_000,
		agentDir: () => mkdtempSync(join(tmpdir(), "pi-commit-agent-dir-")),
		async acquireTransactionLock() {
			return {
				indexPath: join(cwd, ".git", "index"),
				lockPath: join(cwd, ".git", "index.pi-commit.lock"),
				async release() {},
			};
		},
		async createSession(options) {
			const created = await createAgentSession({ ...options, modelRuntime });
			created.session.agent.streamFunction = (modelValue, streamContext) => {
				providerCalls += 1;
				seenContext = streamContext;
				return toolCallStream(modelValue, [
					{ id: "stage", name: "git_stage", arguments: { paths: ["file.ts"] } },
					{ id: "commit", name: "git_commit", arguments: { message: "test: real agent session" } },
				]);
			};
			return { session: created.session };
		},
	};

	const result = await executeCommit("file.ts", context({ cwd, messages: copiedMessages }), deps);
	assert.equal(result, success("abcdef123456", "test: real agent session\n\nBody from the commit hook."));
	assert.equal(providerCalls, 1, "successful git_commit must stop before a second provider turn");
	assert.deepEqual(scheduling, ["stage-start", "stage-end", "index-check", "commit"]);
	assert.deepEqual(seenContext?.tools?.map((entry) => entry.name), [...COMMIT_TOOL_ALLOWLIST]);
	assert.deepEqual(seenContext?.messages.slice(0, 3).map((entry) => entry.role), ["user", "assistant", "toolResult"]);
	assert.equal((seenContext?.messages[1] as any).content[0].name, "read");
});

test("a rejected pre-mutation commit message falls back to Haiku", async () => {
	const { deps, git, created } = fakeDependencies({
		onCreate(options, index) {
			if (index !== 0) return committingSession(options);
			return {
				agent: { state: { messages: [] } },
				async prompt() {
					const commit = options.customTools.find((entry: any) => entry.name === "git_commit");
					await commit.execute("commit", { message: " padded " }, undefined, undefined, {});
				},
				async abort() {},
				dispose() {},
			};
		},
	});

	const result = await executeCommit("file.ts", context(), deps);
	assert.match(result, /^Committed /);
	assert.deepEqual(created.map((entry) => entry.model.id), ["gpt-5.6-luna", "anthropic/claude-haiku-4.5"]);
	assert.equal(git.calls.filter((args) => args[0] === "commit").length, 1);
});

test("tries Luna first, reports the model in use, and falls back only before mutation", async () => {
	const progressModels: string[] = [];
	const { deps, created } = fakeDependencies({
		onCreate(options, index) {
			if (index === 0) throw new Error("Luna provider unavailable");
			return committingSession(options);
		},
	});
	const result = await executeCommit("file.ts", context(), deps, (progress) => {
		if (progress.model) progressModels.push(progress.model);
	});
	assert.match(result, /^Committed /);
	assert.deepEqual(created.map((entry) => `${entry.model.provider}/${entry.model.id}`), [
		"openai-codex/gpt-5.6-luna",
		"openrouter/anthropic/claude-haiku-4.5",
	]);
	assert.ok(progressModels.includes("openai-codex/gpt-5.6-luna"));
	assert.ok(progressModels.includes("openrouter/anthropic/claude-haiku-4.5"));
});

test("falls back after a pre-mutation provider response error", async () => {
	const { deps, created } = fakeDependencies({
		onCreate(options, index) {
			if (index !== 0) return committingSession(options);
			return {
				agent: { state: { messages: [] } },
				async prompt() { this.agent.state.errorMessage = "Luna request failed"; },
				async abort() {},
				dispose() {},
			};
		},
	});
	const result = await executeCommit("file.ts", context(), deps);
	assert.match(result, /^Committed /);
	assert.deepEqual(created.map((entry) => entry.model.id), ["gpt-5.6-luna", "anthropic/claude-haiku-4.5"]);
});

test("uses Haiku directly when Luna lacks authentication", async () => {
	const haiku = model("openrouter", "anthropic/claude-haiku-4.5");
	const { deps, created } = fakeDependencies();
	const result = await executeCommit("file.ts", context({ models: [haiku] }), deps);
	assert.match(result, /^Committed /);
	assert.equal(`${created[0].model.provider}/${created[0].model.id}`, "openrouter/anthropic/claude-haiku-4.5");
});

test("reports missing model authentication without starting a worker", async () => {
	const { deps, created } = fakeDependencies();
	const result = await executeCommit("file.ts", context({ models: [] }), deps);
	assert.equal(result, "Commit failed: neither commit model has configured authentication");
	assert.equal(created.length, 0);
});

test("preserves the full lock path and cleanup command through the parent result", async () => {
	let cwd = mkdtempSync(join(tmpdir(), "pi-commit-long-parent-result-"));
	for (let index = 0; index < 6; index += 1) {
		cwd = join(cwd, `long-repository-segment-${index}-${"x".repeat(32)}`);
		mkdirSync(cwd);
	}
	execFileSync("git", ["init", "-q"], { cwd });
	const executor = new ProcessGitExecutor();
	const held = await acquireGitTransactionLock(cwd, executor);
	const { deps, created } = fakeDependencies();
	deps.git = executor;
	deps.acquireTransactionLock = acquireGitTransactionLock;

	try {
		const result = await executeCommit("file.ts", context({ cwd }), deps);
		assert.ok(result.length > "Commit failed: ".length + 180);
		assert.equal(
			result,
			`Commit failed: the /commit lock exists at ${held.lockPath}; clear it with: rm -- '${held.lockPath}'`,
		);
		assert.equal(created.length, 0);
	} finally {
		await held.release();
	}
});

test("never falls back after staging starts", async () => {
	const { deps, created } = fakeDependencies({
		onCreate(options) {
			const session = committingSession(options);
			session.prompt = async () => {
				const stage = options.customTools.find((tool: any) => tool.name === "git_stage");
				await stage.execute("stage", { paths: ["file.ts"] }, undefined, undefined, {});
				throw new Error("provider failed after staging");
			};
			return session;
		},
	});
	const result = await executeCommit("file.ts", context(), deps);
	assert.equal(created.length, 1);
	assert.equal(result, formatCommitFailure("provider failed after staging", ["file.ts"]));
});

test("worker refusal lists candidate changed paths, does not fall back, and ignores assistant prose", async () => {
	const { deps, created } = fakeDependencies({
		onCreate() {
			return {
				agent: { state: { messages: [] } },
				async prompt() {
					this.agent.state.messages.push({ role: "assistant", content: [{ type: "text", text: "Committed fake: fake" }] } as any);
				},
				async abort() {},
				dispose() {},
			};
		},
	});
	const result = await executeCommit("unclear", context(), deps);
	assert.equal(created.length, 1);
	assert.equal(result, formatCommitFailure("the commit worker did not create a commit", ["file.ts"]));
	assert.match(result, /Candidate changed paths seen:\n- "file\.ts"/);
});

test("timeout aborts and disposes one worker without fallback", async () => {
	let aborted = 0;
	let disposed = 0;
	const { deps, created, locks } = fakeDependencies({
		timeoutMs: 5,
		onCreate() {
			return {
				agent: { state: { messages: [] } },
				prompt: async () => new Promise<void>(() => {}),
				async abort() { aborted += 1; },
				dispose() { disposed += 1; },
			};
		},
	});
	const result = await executeCommit("file.ts", context(), deps);
	assert.equal(result, formatCommitFailure("the commit worker timed out", ["file.ts"]));
	assert.equal(created.length, 1);
	assert.equal(aborted, 1);
	assert.equal(disposed, 1);
	assert.equal(locks[0].released, true);
});

test("non-idle parent and concurrent invocation each get one short failure", async () => {
	const sent: any[] = [];
	let command: any;
	let release!: () => void;
	const blocked = new Promise<void>((resolve) => { release = resolve; });
	const { deps } = fakeDependencies({
		onCreate(options) {
			const session = committingSession(options);
			session.prompt = async () => { await blocked; };
			return session;
		},
	});
	registerCommitCommand({
		on() {},
		registerCommand(_name: string, spec: any) { command = spec; },
		sendMessage(message: any, options: any) { sent.push({ message, options }); },
	} as any, deps);

	await command.handler("x", context({ idle: false }));
	const first = command.handler("x", context());
	await new Promise((resolve) => setImmediate(resolve));
	await command.handler("x", context());
	release();
	await first;
	assert.equal(sent.length, 3);
	assert.equal(sent[0].message.content, "Commit failed: the parent agent is still working");
	assert.equal(sent[1].message.content, "Commit failed: another /commit command is already running");
	assert.equal(sent[2].message.content, formatCommitFailure("the commit worker did not create a commit", ["file.ts"]));
	assert.ok(sent.every((entry) => entry.options.triggerTurn === false));
});

test("release failure cannot change a successful commit result", async () => {
	const { deps } = fakeDependencies();
	deps.acquireTransactionLock = async () => ({
		indexPath: "/repo/.git/index",
		lockPath: "/repo/.git/index.pi-commit.lock",
		async release() { throw new Error("release failed"); },
	});

	const result = await executeCommit("file.ts", context(), deps);
	assert.equal(result, success());
});

test("a release that never settles cannot hang a successful command", async () => {
	const { deps } = fakeDependencies();
	deps.acquireTransactionLock = async () => ({
		indexPath: "/repo/.git/index",
		lockPath: "/repo/.git/index.pi-commit.lock",
		release: async () => new Promise<void>(() => {}),
	});

	const started = Date.now();
	const result = await executeCommit("file.ts", context(), deps);
	assert.equal(result, success());
	assert.ok(Date.now() - started < 1_000, "lock release must have a bounded wait");
});

test("bounds and sanitizes failures", () => {
	const result = sanitizeFailure(`Commit failed: bad\n${"x".repeat(500)}`);
	assert.match(result, /^Commit failed: bad x+/);
	assert.ok(result.length <= "Commit failed: ".length + 180);
	assert.ok(!result.includes("\n"));

	const withPaths = formatCommitFailure("bad", Array.from({ length: 100 }, (_, index) => `${index}-${"p".repeat(500)}`));
	assert.ok(withPaths.length <= 2_000);
	assert.match(withPaths, /Candidate changed paths seen:/);
	assert.match(withPaths, /0-ppp/);
});
