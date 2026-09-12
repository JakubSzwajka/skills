import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { describeSpec, discover } from "../discovery.ts";
import specLinkExtension from "../index.ts";
import { appendSpecLog, transitionStatus } from "../progress.ts";

const START = Date.parse("2026-09-12T12:00:00.000Z");
const WORKER = fileURLToPath(new URL("./concurrency-worker.ts", import.meta.url));

type CommandHandler = (args: string, ctx: TestContext) => Promise<void>;
type EventHandler = (event: any, ctx: TestContext) => any;
type ToolDefinition = {
	name: string;
	parameters: { required?: string[] };
	execute: (id: string, params: { text: string }, signal?: AbortSignal, update?: unknown, ctx?: TestContext) => Promise<any>;
};

type BranchEntry = { type: string; customType: string; data: unknown };

type TestContext = {
	cwd: string;
	hasUI: boolean;
	mode: string;
	ui: {
		notify: (message: string, level: string) => void;
		setStatus: (key: string, value?: string) => void;
		select: (title: string, options: string[]) => Promise<string | undefined>;
	};
	sessionManager: { getBranch: () => BranchEntry[] };
};

function writeSpec(root: string, folder: string, metadata: Record<string, unknown>): string {
	const path = join(root, folder);
	mkdirSync(path, { recursive: true });
	writeFileSync(join(path, "spec.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
	return path;
}

function withRole<T>(role: string | undefined, run: () => T): T {
	const previous = process.env.PI_DELEGATE_ROLE;
	if (role === undefined) delete process.env.PI_DELEGATE_ROLE;
	else process.env.PI_DELEGATE_ROLE = role;
	try {
		return run();
	} finally {
		if (previous === undefined) delete process.env.PI_DELEGATE_ROLE;
		else process.env.PI_DELEGATE_ROLE = previous;
	}
}

function harness(root: string, now: () => number = () => START) {
	const commands = new Map<string, CommandHandler>();
	const events = new Map<string, EventHandler>();
	const tools = new Map<string, ToolDefinition>();
	const entries: Array<{ type: string; data: unknown }> = [];
	const notifications: Array<{ message: string; level: string }> = [];
	const statuses: Array<string | undefined> = [];
	let branch: BranchEntry[] = [];
	let selectChoice: (options: string[]) => string | undefined = () => undefined;
	const api = {
		registerCommand: (name: string, definition: { handler: CommandHandler }) => void commands.set(name, definition.handler),
		registerTool: (definition: ToolDefinition) => void tools.set(definition.name, definition),
		on: (event: string, handler: EventHandler) => void events.set(event, handler),
		appendEntry: (type: string, data: unknown) => void entries.push({ type, data }),
	};
	withRole(undefined, () => specLinkExtension(api as never, { root, now }));
	const ctx: TestContext = {
		cwd: "/unrelated/project",
		hasUI: true,
		mode: "tui",
		ui: {
			notify: (message, level) => void notifications.push({ message, level }),
			setStatus: (_key, value) => void statuses.push(value),
			select: async (_title, options) => selectChoice(options),
		},
		sessionManager: { getBranch: () => branch },
	};
	return {
		commands,
		events,
		tools,
		entries,
		notifications,
		statuses,
		ctx,
		setBranch: (next: BranchEntry[]) => void (branch = next),
		choose: (next: (options: string[]) => string | undefined) => void (selectChoice = next),
	};
}

async function mountByTitle(state: ReturnType<typeof harness>, title: string): Promise<void> {
	state.choose((options) => options.find((option) => option.includes(title)));
	await state.commands.get("spec")!("", state.ctx);
}

function runWorker(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [WORKER, ...args], { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
		child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}

function readyCount(barrier: string): number {
	const prefix = `${basename(barrier)}.`;
	return readdirSync(dirname(barrier)).filter((name) => name.startsWith(prefix) && name.endsWith(".ready")).length;
}

async function waitForWorkers(barrier: string, count: number): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (readyCount(barrier) < count) {
		if (Date.now() >= deadline) throw new Error(`Only ${readyCount(barrier)} of ${count} workers became ready`);
		await delay(1);
	}
}

test("operator sessions register commands, context hooks, and the master-only tool while children register nothing", () => {
	const root = mkdtempSync(join(tmpdir(), "spec-link-child-"));
	try {
		const state = harness(root);
		assert.deepEqual([...state.commands.keys()], ["spec", "spec:clear", "spec:status", "spec:log:append"]);
		assert.deepEqual([...state.events.keys()], ["context", "session_start", "session_tree", "session_shutdown"]);
		assert.deepEqual([...state.tools.keys()], ["spec_log_append"]);
		assert.deepEqual(state.tools.get("spec_log_append")!.parameters.required, ["text"]);

		const commands: string[] = [];
		const events: string[] = [];
		const tools: string[] = [];
		withRole("child", () =>
			specLinkExtension(
				{
					registerCommand: (name: string) => void commands.push(name),
					registerTool: (definition: ToolDefinition) => void tools.push(definition.name),
					on: (event: string) => void events.push(event),
				} as never,
				{ root },
			),
		);
		assert.deepEqual(commands, []);
		assert.deepEqual(events, []);
		assert.deepEqual(tools, []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("mount stores only the folder identity, injects pointer context, and clear unmounts", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "spec-link-mount-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const folder = writeSpec(root, "2026-09-12_primary", { schemaVersion: 1, title: "Primary spec", status: "pending" });
	writeFileSync(join(folder, "SPEC.md"), "PRIVATE SPEC BODY", "utf8");
	mkdirSync(join(folder, "assets"));
	writeFileSync(join(folder, "assets", "data.txt"), "PRIVATE ASSET BODY", "utf8");
	const state = harness(root);

	await mountByTitle(state, "Primary spec");
	assert.deepEqual(state.entries.at(-1), { type: "spec-link:link", data: { path: folder } });
	assert.equal(state.statuses.at(-1), "spec: Primary spec [pending]");

	const stale = { role: "custom", customType: "spec-link:note", content: "stale", display: false, timestamp: 1 };
	const messages = [{ role: "user", content: "first" }, { role: "assistant", content: "reply" }, stale, { role: "user", content: "latest" }];
	const result = state.events.get("context")!({ messages }, state.ctx) as { messages: Array<{ role: string; customType?: string; content: string }> };
	assert.equal(result.messages.filter((message) => message.customType === "spec-link:note").length, 1);
	assert.equal(result.messages.at(-2)?.customType, "spec-link:note");
	assert.equal(
		result.messages.at(-2)?.content,
		`[spec-link] Mounted spec: "Primary spec".\nStatus: pending\nFolder: ${folder}\nRead files in this folder when needed. This note contains no file bodies.`,
	);
	assert.equal(result.messages.at(-1)?.content, "latest");
	assert.ok(!JSON.stringify(result).includes("PRIVATE SPEC BODY"));
	assert.ok(!JSON.stringify(result).includes("PRIVATE ASSET BODY"));

	await state.commands.get("spec:clear")!("", state.ctx);
	assert.deepEqual(state.entries.at(-1), { type: "spec-link:link", data: { path: null } });
	assert.equal(state.statuses.at(-1), undefined);
	assert.equal(state.events.get("context")!({ messages: [{ role: "user", content: "latest" }] }, state.ctx), undefined);
});

test("duplicate truncated picker rows still mount the selected spec", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "spec-link-picker-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const prefix = `2026-09-12_${"a".repeat(50)}`;
	writeSpec(root, `${prefix}-one`, { schemaVersion: 1, title: "Same long title", status: "pending" });
	writeSpec(root, `${prefix}-two`, { schemaVersion: 1, title: "Same long title", status: "pending" });
	const records = discover(root, START);
	const state = harness(root);
	let optionsSeen: string[] = [];
	state.choose((options) => {
		optionsSeen = options;
		return options[1];
	});
	await state.commands.get("spec")!("", state.ctx);
	assert.equal(optionsSeen[0].replace(/^\d+\.\s+/, ""), optionsSeen[1].replace(/^\d+\.\s+/, ""));
	assert.equal(new Set(optionsSeen).size, 2);
	assert.deepEqual(state.entries.at(-1), { type: "spec-link:link", data: { path: records[1].path } });
});

test("restore follows the active branch and keeps a mounted old done spec visible", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "spec-link-restore-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const folder = writeSpec(root, "2026-09-01_old-done", {
		schemaVersion: 1,
		title: "Old completion",
		status: "done",
		completedAt: new Date(START - 10 * 24 * 60 * 60 * 1000).toISOString(),
	});
	const state = harness(root);
	state.setBranch([
		{ type: "custom", customType: "spec-link:link", data: { path: "/wrong" } },
		{ type: "custom", customType: "spec-link:link", data: { path: folder } },
	]);
	state.events.get("session_start")!({}, state.ctx);
	assert.equal(state.statuses.at(-1), "spec: Old completion [done]");
	const context = state.events.get("context")!({ messages: [{ role: "user", content: "go" }] }, state.ctx) as { messages: Array<{ content: string }> };
	assert.match(context.messages[0].content, /Status: done/);

	let optionsSeen: string[] = [];
	state.choose((options) => {
		optionsSeen = options;
		return undefined;
	});
	await state.commands.get("spec")!("", state.ctx);
	assert.ok(optionsSeen.some((option) => option.includes("Old completion") && option.includes("done")));

	writeFileSync(join(folder, "spec.json"), "{", "utf8");
	state.events.get("session_tree")!({}, state.ctx);
	assert.equal(state.statuses.at(-1), undefined);
	assert.match(state.notifications.at(-1)!.message, /Cannot restore mounted spec: spec\.json is not valid JSON/);
	assert.equal(state.notifications.at(-1)!.level, "error");
});

test("the latest branch link entry can clear an earlier mount", (t) => {
	const root = mkdtempSync(join(tmpdir(), "spec-link-branch-clear-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const folder = writeSpec(root, "2026-09-12_clear", { schemaVersion: 1, title: "Clear me", status: "pending" });
	const state = harness(root);
	state.setBranch([
		{ type: "custom", customType: "spec-link:link", data: { path: folder } },
		{ type: "custom", customType: "spec-link:link", data: { path: null } },
	]);
	state.events.get("session_start")!({}, state.ctx);
	assert.equal(state.statuses.at(-1), undefined);
	assert.equal(state.events.get("context")!({ messages: [{ role: "user", content: "go" }] }, state.ctx), undefined);
});

test("external metadata changes refresh both provider context and TUI status", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "spec-link-refresh-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const folder = writeSpec(root, "2026-09-12_refresh", { schemaVersion: 1, title: "Before", status: "pending" });
	const state = harness(root);
	await mountByTitle(state, "Before");
	writeFileSync(
		join(folder, "spec.json"),
		`${JSON.stringify({ schemaVersion: 1, title: "After", status: "done", completedAt: new Date(START).toISOString() }, null, 2)}\n`,
		"utf8",
	);
	const result = state.events.get("context")!({ messages: [{ role: "user", content: "go" }] }, state.ctx) as { messages: Array<{ content: string }> };
	assert.match(result.messages[0].content, /Mounted spec: "After"/);
	assert.match(result.messages[0].content, /Status: done/);
	assert.equal(state.statuses.at(-1), "spec: After [done]");
});

test("status transitions set and remove completedAt without refreshing an unchanged completion", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "spec-link-status-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const folder = writeSpec(root, "2026-09-12_status", { schemaVersion: 1, title: "Status spec", status: "pending" });
	let clock = START;
	const state = harness(root, () => clock);
	await mountByTitle(state, "Status spec");

	await state.commands.get("spec:status")!("done", state.ctx);
	const firstDone = readFileSync(join(folder, "spec.json"), "utf8");
	assert.deepEqual(JSON.parse(firstDone), {
		schemaVersion: 1,
		title: "Status spec",
		status: "done",
		completedAt: new Date(START).toISOString(),
	});
	assert.equal(state.statuses.at(-1), "spec: Status spec [done]");
	const doneContext = state.events.get("context")!({ messages: [{ role: "user", content: "go" }] }, state.ctx) as { messages: Array<{ content: string }> };
	assert.match(doneContext.messages[0].content, /Status: done/);

	clock += 60_000;
	await state.commands.get("spec:status")!("done", state.ctx);
	assert.equal(readFileSync(join(folder, "spec.json"), "utf8"), firstDone);
	assert.equal(state.notifications.at(-1)?.message, "Spec is already done.");

	await state.commands.get("spec:status")!("pending", state.ctx);
	assert.deepEqual(JSON.parse(readFileSync(join(folder, "spec.json"), "utf8")), {
		schemaVersion: 1,
		title: "Status spec",
		status: "pending",
	});
	const firstPending = readFileSync(join(folder, "spec.json"), "utf8");
	clock += 60_000;
	await state.commands.get("spec:status")!("pending", state.ctx);
	assert.equal(readFileSync(join(folder, "spec.json"), "utf8"), firstPending);
	assert.equal(state.notifications.at(-1)?.message, "Spec is already pending.");

	await state.commands.get("spec:status")!("other", state.ctx);
	assert.equal(state.notifications.at(-1)?.message, "Usage: /spec:status pending|done");
});

test("a dead status-lock owner is recovered without the old ten-second timeout", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "spec-link-dead-lock-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const folder = writeSpec(root, "2026-09-12_dead-lock", { schemaVersion: 1, title: "Dead lock", status: "pending" });
	const barrier = join(root, "orphan-ready");
	const orphan = await runWorker(["orphan-lock", root, folder, "", barrier]);
	assert.equal(orphan.code, 0, orphan.stderr);
	assert.equal(readyCount(barrier), 1);
	const reusedPidOwner = {
		version: 1,
		token: "00000000-0000-4000-8000-000000000000",
		pid: process.pid,
		startedAt: 1,
		ticket: 1,
	};
	writeFileSync(
		join(root, `.${basename(folder)}.status.lock.${reusedPidOwner.pid}.${reusedPidOwner.startedAt}.${reusedPidOwner.token}`),
		`${JSON.stringify(reusedPidOwner)}\n`,
	);
	assert.equal(readdirSync(root).filter((name) => name.includes(".status.lock.")).length, 2);
	const record = describeSpec(folder, root);
	if (record.kind !== "spec") assert.fail(record.error);
	const started = Date.now();
	assert.equal(transitionStatus(record, "done", root, START).changed, true);
	assert.ok(Date.now() - started < 1_000);
	assert.equal(readdirSync(root).some((name) => name.includes(".status.lock.")), false);
});

test("a live status-lock owner keeps its place until it releases", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "spec-link-live-lock-"));
	try {
		const folder = writeSpec(root, "2026-09-12_live-lock", { schemaVersion: 1, title: "Live lock", status: "pending" });
		const ownerBarrier = join(root, "release-owner");
		const owner = runWorker(["lock", root, folder, "", ownerBarrier]);
		await waitForWorkers(ownerBarrier, 1);
		const statusBarrier = join(root, "release-status");
		let statusFinished = false;
		const status = runWorker(["status", root, folder, String(START), statusBarrier]).then((result) => {
			statusFinished = true;
			return result;
		});
		await waitForWorkers(statusBarrier, 1);
		writeFileSync(statusBarrier, "");
		while (readdirSync(root).filter((name) => name.includes(".status.lock.")).length < 2) await delay(1);
		await delay(50);
		assert.equal(statusFinished, false);
		assert.equal(JSON.parse(readFileSync(join(folder, "spec.json"), "utf8")).status, "pending");
		writeFileSync(ownerBarrier, "");
		const [ownerResult, statusResult] = await Promise.all([owner, status]);
		assert.equal(ownerResult.code, 0, ownerResult.stderr);
		assert.equal(statusResult.code, 0, statusResult.stderr);
		assert.equal(JSON.parse(statusResult.stdout).changed, true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("concurrent same-spec status calls change completedAt once", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "spec-link-status-race-"));
	try {
		const folder = writeSpec(root, "2026-09-12_status-race", { schemaVersion: 1, title: "Status race", status: "pending" });
		const barrier = join(root, "start-status");
		const workers = Array.from({ length: 8 }, (_, index) => runWorker(["status", root, folder, String(START + index), barrier]));
		await waitForWorkers(barrier, workers.length);
		writeFileSync(barrier, "");
		const results = await Promise.all(workers);
		for (const result of results) assert.equal(result.code, 0, result.stderr);
		const outputs = results.map((result) => JSON.parse(result.stdout) as { changed: boolean; completedAt: string });
		assert.equal(outputs.filter((output) => output.changed).length, 1);
		assert.equal(new Set(outputs.map((output) => output.completedAt)).size, 1);
		assert.equal(JSON.parse(readFileSync(join(folder, "spec.json"), "utf8")).completedAt, outputs[0].completedAt);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("command and tool share collision-safe immutable logging", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "spec-link-log-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const folder = writeSpec(root, "2026-09-12_logging", { schemaVersion: 1, title: "Logging spec", status: "pending" });
	const state = harness(root);
	await mountByTitle(state, "Logging spec");

	await state.commands.get("spec:log:append")!("   ", state.ctx);
	assert.equal(state.notifications.at(-1)?.message, "Could not append spec log: Log text is required");
	await state.commands.get("spec:log:append")!("Command entry", state.ctx);
	const toolResult = await state.tools.get("spec_log_append")!.execute("call-1", { text: "# Tool entry\n\nDetails" });
	assert.match(toolResult.content[0].text, /Added spec log:/);
	const files = readdirSync(join(folder, "log")).sort();
	assert.deepEqual(files, ["2026-09-12T12-00-00-000Z-01.md", "2026-09-12T12-00-00-000Z.md"]);
	assert.equal(readFileSync(join(folder, "log", "2026-09-12T12-00-00-000Z.md"), "utf8"), "Command entry\n");
	assert.equal(readFileSync(join(folder, "log", "2026-09-12T12-00-00-000Z-01.md"), "utf8"), "# Tool entry\n\nDetails\n");
	assert.equal(readFileSync(join(folder, "log", "2026-09-12T12-00-00-000Z.md"), "utf8"), "Command entry\n");

	await state.commands.get("spec:clear")!("", state.ctx);
	const failed = await state.tools.get("spec_log_append")!.execute("call-2", { text: "No target" });
	assert.equal(failed.content[0].text, "spec_log_append failed: No spec is mounted");
	await state.commands.get("spec:log:append")!("", state.ctx);
	assert.equal(state.notifications.at(-1)?.level, "error");
});

test("concurrent same-millisecond log appenders keep every entry", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "spec-link-log-race-"));
	try {
		const folder = writeSpec(root, "2026-09-12_log-race", { schemaVersion: 1, title: "Log race", status: "pending" });
		const barrier = join(root, "start-log");
		const bodies = Array.from({ length: 8 }, (_, index) => `entry-${index}`);
		const workers = bodies.map((body) => runWorker(["log", root, folder, body, barrier]));
		await waitForWorkers(barrier, workers.length);
		writeFileSync(barrier, "");
		const results = await Promise.all(workers);
		for (const result of results) assert.equal(result.code, 0, result.stderr);
		const files = readdirSync(join(folder, "log"));
		assert.equal(files.length, bodies.length);
		assert.deepEqual(
			files.map((file) => readFileSync(join(folder, "log", file), "utf8").trim()).sort(),
			bodies.sort(),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("static symlinks and a folder replacement abort writes", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "spec-link-symlink-"));
	const outside = mkdtempSync(join(tmpdir(), "spec-link-outside-"));
	t.after(() => {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	});

	const metadataFolder = writeSpec(root, "2026-09-12_metadata-link", { schemaVersion: 1, title: "Metadata", status: "pending" });
	const metadataRecord = describeSpec(metadataFolder, root);
	if (metadataRecord.kind !== "spec") assert.fail(metadataRecord.error);
	const outsideMetadata = join(outside, "outside-spec.json");
	writeFileSync(outsideMetadata, "OUTSIDE", "utf8");
	unlinkSync(join(metadataFolder, "spec.json"));
	symlinkSync(outsideMetadata, join(metadataFolder, "spec.json"));
	assert.throws(() => transitionStatus(metadataRecord, "done", root, START), /metadata|invalid/i);
	assert.equal(readFileSync(outsideMetadata, "utf8"), "OUTSIDE");

	const logFolder = writeSpec(root, "2026-09-12_log-link", { schemaVersion: 1, title: "Log", status: "pending" });
	const logRecord = describeSpec(logFolder, root);
	if (logRecord.kind !== "spec") assert.fail(logRecord.error);
	const outsideLog = join(outside, "log");
	mkdirSync(outsideLog);
	symlinkSync(outsideLog, join(logFolder, "log"));
	assert.throws(() => appendSpecLog(logRecord, "must not escape", root, START), /log folder.*regular directory/i);
	assert.deepEqual(readdirSync(outsideLog), []);

	const raceFolder = writeSpec(root, "2026-09-12_replaced", { schemaVersion: 1, title: "Replace", status: "pending" });
	const outsideSpec = writeSpec(outside, "2026-09-12_target", { schemaVersion: 1, title: "Outside", status: "pending" });
	const ownerBarrier = join(root, "release-replacement-owner");
	const owner = runWorker(["lock", root, raceFolder, "", ownerBarrier]);
	await waitForWorkers(ownerBarrier, 1);
	const statusBarrier = join(root, "start-replacement");
	const worker = runWorker(["status", root, raceFolder, String(START), statusBarrier]);
	await waitForWorkers(statusBarrier, 1);
	writeFileSync(statusBarrier, "");
	while (readdirSync(root).filter((name) => name.includes(".status.lock.")).length < 2) await delay(1);
	const displaced = `${raceFolder}-old`;
	renameSync(raceFolder, displaced);
	symlinkSync(outsideSpec, raceFolder);
	writeFileSync(ownerBarrier, "");
	const [ownerResult, result] = await Promise.all([owner, worker]);
	assert.equal(ownerResult.code, 0, ownerResult.stderr);
	assert.notEqual(result.code, 0);
	assert.match(result.stderr, /ENOENT|Mounted spec folder must be a regular directory|changed during the write/);
	assert.equal(readdirSync(root).filter((name) => name.includes(".status.lock.")).length, 1);
	assert.deepEqual(JSON.parse(readFileSync(join(outsideSpec, "spec.json"), "utf8")), {
		schemaVersion: 1,
		title: "Outside",
		status: "pending",
	});
});

test("interactive picker is never called when UI is unavailable", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "spec-link-non-ui-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeSpec(root, "2026-09-12_headless", { schemaVersion: 1, title: "Headless", status: "pending" });
	const state = harness(root);
	state.ctx.hasUI = false;
	state.choose(() => assert.fail("select must not run without a UI"));
	await state.commands.get("spec")!("", state.ctx);
	assert.deepEqual(state.notifications.at(-1), { message: "/spec needs the interactive TUI.", level: "error" });
});
