import assert from "node:assert/strict";
import { appendFileSync, chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DelegateService, intercomRings, resolveTransport, returnContract, statusRank, toolPolicy } from "./delegate.ts";
import { HerdrLaneRunner } from "./runners/herdr.ts";
import { SubprocessLaneRunner, childEnvironment, launchArguments, psTable, sameProcessStart, uuidV7 } from "./runners/subprocess.ts";
import type { LaunchRequest } from "./runners/subprocess.ts";
import { mutateRegistry, readRegistry } from "./registry.ts";
import { SessionStatsWatcher, ClosedLaneMemory, clip, laneRows, laneSignature, laneWidgetFactory, renderWidget, sampleLaneViews, separatorLine, shortModel, sortLaneViews } from "./widget.ts";
import type { LaneView } from "./widget.ts";
import delegateExtension from "./index.ts";
import type { CommandResult, LaneRecord, LaneRegistry } from "./types.ts";

interface Call { args: string[] }

/**
 * Stands in for herdr. The equality check is the standing guarantee that the pane transport
 * shells out to herdr and to nothing else; block 26 holds the other half, that a headless lane
 * never reaches this runner at all.
 */
class FakeRunner {
	readonly calls: Call[] = [];
	readonly panes: Array<Record<string, unknown>> = [];
	readonly agents: Array<Record<string, unknown>> = [];
	startBusyTimes = 0;
	promptTransitionConfirmed = true;
	onCall?: (operation: string) => void;
	private paneCounter = 0;

	async exec(command: string, args: string[]): Promise<CommandResult> {
		assert.equal(command, "herdr", "the service only ever shells out to herdr");
		this.calls.push({ args: [...args] });
		const operation = `${args[0]} ${args[1]}`;
		this.onCall?.(operation);
		switch (operation) {
			case "agent list": return ok({ result: { agents: this.agents } });
			case "pane list": return ok({ result: { panes: this.panes } });
			case "pane split": {
				this.paneCounter += 1;
				const pane = `w0:p${this.paneCounter}`;
				this.panes.push({ pane_id: pane });
				return ok({ result: { type: "pane_info", pane: { pane_id: pane } } });
			}
			case "agent start": {
				if (this.startBusyTimes > 0) {
					this.startBusyTimes -= 1;
					return { stdout: JSON.stringify({ error: { code: "agent_pane_busy", message: "agent target pane is not an available shell" } }), stderr: "", code: 1 };
				}
				const name = args[2]!;
				const pane = args[args.indexOf("--pane") + 1]!;
				const agent = {
					agent: "pi", pane_id: pane, name, agent_status: "idle",
					agent_session: { kind: "path", value: `/sessions/2026-09-10T00-00-00-000Z_session-${name}.jsonl` },
				};
				this.agents.push(agent);
				return ok({ result: { type: "agent_started", agent } });
			}
			case "agent prompt": return this.promptTransitionConfirmed
				? ok({ result: { type: "agent_prompted", agent: { agent: "pi", pane_id: "w0:p1" } } })
				: { stdout: JSON.stringify({ error: { code: "timeout", message: "transition was not observed" } }), stderr: "", code: 1 };
			case "pane process-info": return ok({ result: { process_info: { pane_id: args[args.indexOf("--pane") + 1], shell_pid: 100, foreground_process_group_id: 100 } } });
			case "pane close": {
				const pane = args[2];
				this.panes.splice(0, this.panes.length, ...this.panes.filter((candidate) => candidate.pane_id !== pane));
				this.agents.splice(0, this.agents.length, ...this.agents.filter((candidate) => candidate.pane_id !== pane));
				return ok({ result: { ok: true } });
			}
			default: throw new Error(`unexpected herdr operation ${operation}`);
		}
	}

	argsFor(operation: string): string[] | undefined {
		return this.calls.find((call) => `${call.args[0]} ${call.args[1]}` === operation)?.args;
	}
}

function ok(payload: unknown): CommandResult { return { stdout: JSON.stringify(payload), stderr: "", code: 0 }; }
function home(): string { return mkdtempSync(join(tmpdir(), "delegate-home-")); }
function context(cwd: string, parentId = "parent-1") { return { parentId, cwd }; }
function registryPath(root: string, parentId = "parent-1"): string { return join(root, ".pi", "agent", "delegate", parentId, "lanes.json"); }

/**
 * Writes a profiles file, because a lane's transport is a profile field and nothing else can set it.
 * The models match the built-in profiles, so a transport test does not also move the model.
 */
function writeProfiles(root: string, profiles: Record<string, Record<string, unknown>>): void {
	mkdirSync(join(root, ".agents", "pi", "delegate"), { recursive: true });
	writeFileSync(join(root, ".agents", "pi", "delegate", "profiles.json"), JSON.stringify(profiles), "utf8");
}

/** A profile pair for the headless tests: `worker` runs subprocess, `pane` keeps the default. */
function headlessProfiles(root: string): void {
	writeProfiles(root, {
		worker: { model: "openai-codex/gpt-5.6-sol:high", excludeTools: ["ask_user_question"], transport: "subprocess" },
		pane: { model: "openai-codex/gpt-5.6-sol:high", excludeTools: ["ask_user_question"] },
	});
}

// 1. Empty sessions leave no registry file, and pruning the final lane removes its directory.
{
	const root = home();
	const path = registryPath(root);
	const service = new DelegateService(new FakeRunner(), root);
	const listed = await service.execute({ action: "list" }, context(root));
	assert.deepEqual(listed.lanes, []);
	assert.equal(existsSync(path), false, "listing a session with no lanes writes no registry file");
	assert.equal(existsSync(join(root, ".pi", "agent", "delegate", "parent-1")), false, "the empty session registry directory is removed");

	mkdirSync(join(root, ".pi", "agent", "delegate", "parent-1"), { recursive: true });
	writeFileSync(path, JSON.stringify({ lanes: [{
		lane: "expired", profile: "worker", pane: "", session: "", cwd: root, handoff: "/tmp/expired.md",
		started: "2020-01-01T00:00:00.000Z", read: false, closed: true, closedAt: "2020-01-01T00:00:00.000Z",
	}] }), "utf8");
	await service.execute({ action: "list" }, context(root));
	assert.equal(existsSync(path), false, "pruning the final lane removes the empty registry file");
	assert.equal(existsSync(join(root, ".pi", "agent", "delegate", "parent-1")), false, "pruning the final lane removes its empty directory");
}

// 2. The registry entry exists before the pane is created.
{
	const root = home();
	const runner = new FakeRunner();
	const service = new DelegateService(runner, root);
	let snapshotAtSplit: LaneRegistry | undefined;
	runner.onCall = (operation) => {
		if (operation !== "pane split") return;
		snapshotAtSplit = JSON.parse(readFileSync(registryPath(root), "utf8")) as LaneRegistry;
	};
	const result = await service.execute({ action: "start", profile: "worker", brief: "Write READY", name: "lane-a" }, context(root));
	assert.equal(snapshotAtSplit?.lanes.length, 1, "the registry is written before herdr splits a pane");
	assert.equal(snapshotAtSplit?.lanes[0]?.lane, "lane-a");
	assert.equal(snapshotAtSplit?.lanes[0]?.pane, "", "the pre-spawn entry has no pane yet");
	assert.equal(snapshotAtSplit?.lanes[0]?.status, "pending");
	assert.equal(result.lane, "lane-a");
	assert.equal(result.handoff, join(root, ".pi", "agent", "delegate", "parent-1", "lane-a.md"));
	assert.match(String(result.warning), /using built-in delegate profiles/, "a missing profiles file falls back and says so");

	const split = runner.argsFor("pane split")!;
	assert.ok(split.includes("PI_DELEGATE_ROLE=child"), "the child marker is set on the pane");
	assert.ok(split.includes("PI_DELEGATE_PARENT=parent-1"));
	const prompt = runner.argsFor("agent prompt")!;
	assert.ok(prompt[3]!.includes("You are a worker. Implement the work yourself. Do not delegate."));
	assert.ok(prompt[3]!.includes("use the intercom tool to ask\nsession parent-1 and wait for the reply"), "the appended contract routes decisions to the parent through intercom");
	assert.ok(prompt[3]!.includes("Never try to open a question dialog"), "the appended contract forbids invisible dialogs");
	assert.ok(prompt[3]!.includes("offer the options you see"));
	assert.ok(prompt[3]!.includes("name your own recommendation"));
	assert.ok(prompt[3]!.includes("write\nthe handoff describing the block rather than waiting again"));
	assert.ok(prompt[3]!.includes("session parent-1 and wait for the reply"), "the decisions clause contains the parent session id");
	assert.ok(prompt[3]!.includes("use the intercom tool to message session parent-1"), "the doorbell line contains the same parent session id");
	assert.equal(prompt[3], returnContract("Write READY", String(result.handoff), "parent-1"));
}

// 3. Two concurrent starts do not corrupt the registry.
{
	const root = home();
	const runner = new FakeRunner();
	const service = new DelegateService(runner, root);
	await Promise.all([
		service.execute({ action: "start", brief: "one", name: "lane-one" }, context(root)),
		service.execute({ action: "start", brief: "two", name: "lane-two" }, context(root)),
	]);
	const registry = await readRegistry(registryPath(root));
	assert.deepEqual(registry.lanes.map((lane) => lane.lane).sort(), ["lane-one", "lane-two"]);
	assert.equal(new Set(registry.lanes.map((lane) => lane.pane)).size, 2, "each lane keeps its own pane");
	JSON.parse(readFileSync(registryPath(root), "utf8"));
}

// 4. A duplicate live lane name and a colliding Herdr agent name are both refused.
{
	const root = home();
	const runner = new FakeRunner();
	runner.agents.push({ agent: "pi", pane_id: "w0:pX", name: "taken", agent_status: "idle" });
	const service = new DelegateService(runner, root);
	await assert.rejects(service.execute({ action: "start", brief: "x", name: "taken" }, context(root)), /already named/);
	await service.execute({ action: "start", brief: "x", name: "lane-a" }, context(root));
	await assert.rejects(service.execute({ action: "start", brief: "x", name: "lane-a" }, context(root)), /already named/, "a live pane wins the name check first");
	runner.agents.splice(0, runner.agents.length, { agent: "pi", pane_id: "w0:pX", name: "taken", agent_status: "idle" });
	await assert.rejects(service.execute({ action: "start", brief: "x", name: "lane-a" }, context(root)), /already exists/, "the registry still owns the lane name after its agent vanished");
	await assert.rejects(service.execute({ action: "start", brief: "x", name: "Bad Name" }, context(root)), /Lane names must match/);
	await assert.rejects(service.execute({ action: "start", brief: "  " }, context(root)), /non-empty brief/);
	await assert.rejects(service.execute({ action: "start", brief: "x", profile: "ghost" }, context(root)), /Unknown delegate profile/);
}

// 5. readOnly means exclude-tools edit, and write survives.
{
	assert.deepEqual(toolPolicy({ model: "m", readOnly: true }), { excludeTools: ["edit"] });
	assert.deepEqual(toolPolicy({ model: "m", readOnly: true, excludeTools: ["bash"] }).excludeTools.sort(), ["bash", "edit"]);
	assert.deepEqual(toolPolicy({ model: "m" }), { excludeTools: [] });

	const root = home();
	mkdirSync(join(root, ".agents", "pi", "delegate"), { recursive: true });
	writeFileSync(join(root, ".agents", "pi", "delegate", "profiles.json"), JSON.stringify({ scout: { model: "openai-codex/gpt-5.6-luna:low", readOnly: true } }), "utf8");
	const runner = new FakeRunner();
	const service = new DelegateService(runner, root);
	const started = await service.execute({ action: "start", profile: "scout", brief: "look", name: "lane-ro" }, context(root));
	assert.equal(started.warning, undefined, "a valid profiles file produces no warning");
	const start = runner.argsFor("agent start")!;
	assert.equal(start[start.indexOf("--exclude-tools") + 1], "edit");
	assert.ok(!start.includes("--tools"), "readOnly never narrows the allowlist, so write stays available");
	assert.ok(!start.join(" ").includes("write"), "write is never excluded");
	assert.equal(start[start.indexOf("--model") + 1], "openai-codex/gpt-5.6-luna", "the thinking suffix is split off the model id");
	assert.equal(start[start.indexOf("--thinking") + 1], "low");
}

// 6. A malformed profiles file falls back to the built-in set and says so.
{
	const root = home();
	mkdirSync(join(root, ".agents", "pi", "delegate"), { recursive: true });
	writeFileSync(join(root, ".agents", "pi", "delegate", "profiles.json"), "{ not json", "utf8");
	const service = new DelegateService(new FakeRunner(), root);
	const result = await service.execute({ action: "start", profile: "reviewer", brief: "review", name: "lane-fb" }, context(root));
	assert.match(String(result.warning), /malformed/);
	assert.equal(result.lane, "lane-fb");
}

// 7. Every built-in profile excludes invisible question dialogs and keeps its intended model.
{
	const expectedModels = {
		worker: "openai-codex/gpt-5.6-sol",
		scout: "openai-codex/gpt-5.6-luna",
		reviewer: "anthropic/claude-opus-5",
		oracle: "anthropic/claude-opus-5",
	};
	for (const [profile, model] of Object.entries(expectedModels)) {
		const root = home();
		const runner = new FakeRunner();
		const service = new DelegateService(runner, root);
		await service.execute({ action: "start", profile, brief: "check defaults", name: `lane-${profile}` }, context(root));
		const start = runner.argsFor("agent start")!;
		const excluded = start[start.indexOf("--exclude-tools") + 1]!.split(",");
		assert.ok(excluded.includes("ask_user_question"), `${profile} excludes ask_user_question`);
		assert.equal(start[start.indexOf("--model") + 1], model, `${profile} uses the intended fallback model`);
	}
}

// 9. A doorbell ring marks its lane; a stranger's message is left alone.
{
	// The real inbound entry shape, copied from a live orchestrator session log.
	const live = [
		{ type: "custom_message", customType: "intercom_message", id: "e1", timestamp: "2026-09-10T12:38:50.000Z", details: { from: { id: "01a08b53-c579-736c-84eb-1a817d671cf7", name: "lane-ready" }, message: { id: "d2e81a3f" } } },
		{ type: "message", message: { role: "custom", customType: "intercom_message", details: { from: { id: "legacy-sender" }, message: { id: "legacy-1" } } } },
		{ type: "message", message: { role: "assistant", content: [] } },
		{ type: "custom_message", customType: "task-log:context", details: { from: { id: "not-a-ring" } } },
		{ type: "custom_message", customType: "intercom_message", details: {} },
	];
	assert.deepEqual(intercomRings(live), [
		{ sender: "01a08b53-c579-736c-84eb-1a817d671cf7", messageId: "d2e81a3f", expectsReply: false },
		{ sender: "legacy-sender", messageId: "legacy-1", expectsReply: false },
	], "only intercom entries with a sender count as rings");
	// An ask carries expectsReply, which is the only blocking event a paneless lane can report.
	assert.deepEqual(intercomRings([{ type: "custom_message", customType: "intercom_message", details: { from: { id: "asker" }, message: { id: "m1", expectsReply: true } } }]),
		[{ sender: "asker", messageId: "m1", expectsReply: true }]);

	const root = home();
	const runner = new FakeRunner();
	const service = new DelegateService(runner, root);
	await service.execute({ action: "start", brief: "x", name: "lane-a" }, context(root));
	assert.equal(await service.markRang("nobody-here", context(root)), undefined, "an unmatched intercom sender is ignored");
	assert.equal((await readRegistry(registryPath(root))).lanes[0]?.rang, undefined);
	const session = (await readRegistry(registryPath(root))).lanes[0]!.session;
	assert.equal(session, "session-lane-a", "the lane records the worker session id from its herdr session path");
	assert.equal(await service.markRang(session, context(root)), "lane-a");
	assert.ok((await readRegistry(registryPath(root))).lanes[0]?.rang, "a matched ring is recorded");
}

// 10. read returns the handoff body and marks the lane read; stop closes the pane and deregisters.
{
	const root = home();
	const runner = new FakeRunner();
	const service = new DelegateService(runner, root);
	const started = await service.execute({ action: "start", brief: "x", name: "lane-a" }, context(root));
	const missing = await service.execute({ action: "read", lane: "lane-a" }, context(root));
	assert.equal(missing.handoffPresent, false, "a lane that rang without a file has failed");
	writeFileSync(String(started.handoff), "READY\n", "utf8");
	const read = await service.execute({ action: "read", lane: "lane-a" }, context(root));
	assert.equal(read.body, "READY\n");
	assert.equal(read.handoffPresent, true);
	assert.equal((await readRegistry(registryPath(root))).lanes[0]?.read, true);

	const listed = (await service.execute({ action: "list" }, context(root))).lanes as Array<Record<string, unknown>>;
	assert.equal(listed.length, 1);
	assert.equal(listed[0]?.handoffPresent, true);
	assert.equal(listed[0]?.unread, false);

	const stopped = await service.execute({ action: "stop", lane: "lane-a" }, context(root));
	assert.equal(stopped.gone, true);
	assert.equal(stopped.alreadyGone, false);
	assert.equal(runner.argsFor("pane close")?.[2], started.pane);
	assert.equal((await readRegistry(registryPath(root))).lanes[0]?.closed, true);
	const secondStop = await service.execute({ action: "stop", lane: "lane-a" }, context(root));
	assert.equal(secondStop.alreadyGone, true, "stop is idempotent");
	await assert.rejects(service.execute({ action: "read", lane: "ghost" }, context(root)), /Unknown delegate lane/);
}

// 11. A malformed registry file degrades to an empty lane list instead of throwing.
{
	const root = home();
	const path = registryPath(root);
	mkdirSync(join(root, ".pi", "agent", "delegate", "parent-1"), { recursive: true });
	writeFileSync(path, "{{{ not json", "utf8");
	assert.deepEqual((await readRegistry(path)).lanes, []);
	await mutateRegistry(path, (registry) => { registry.lanes.push({ lane: "lane-a", profile: "worker", pane: "", session: "", cwd: root, handoff: "/tmp/h.md", started: new Date().toISOString(), read: false, closed: false }); });
	assert.equal((await readRegistry(path)).lanes.length, 1, "a corrupt registry is replaced, not compounded");
}

// 12. PI_DELEGATE_ROLE=child suppresses tool registration; factory failures propagate.
{
	const registered = (role?: string): string[] => {
		const previous = process.env.PI_DELEGATE_ROLE;
		if (role === undefined) delete process.env.PI_DELEGATE_ROLE;
		else process.env.PI_DELEGATE_ROLE = role;
		const tools: string[] = [];
		const events: string[] = [];
		try {
			delegateExtension({
				registerTool: (spec: { name: string }) => { tools.push(spec.name); },
				on: (event: string) => { events.push(event); },
				exec: async () => ({ stdout: "", stderr: "", code: 0 }),
			} as never);
		} finally {
			if (previous === undefined) delete process.env.PI_DELEGATE_ROLE;
			else process.env.PI_DELEGATE_ROLE = previous;
		}
		if (role === undefined) assert.ok(events.includes("session_start") && events.includes("turn_end"), "the parent subscribes to session_start and turn_end");
		return tools;
	};
	assert.deepEqual(registered(undefined), ["delegate"], "a parent session gets the delegate tool");
	assert.deepEqual(registered("child"), [], "a worker cannot delegate");

	let shutdown: ((event: unknown, ctx: unknown) => Promise<void>) | undefined;
	let tool: { description: string; promptGuidelines?: string[]; parameters: { properties?: Record<string, unknown> }; execute: (...args: unknown[]) => Promise<{ details: Record<string, unknown> }> } | undefined;
	const previousRole = process.env.PI_DELEGATE_ROLE;
	delete process.env.PI_DELEGATE_ROLE;
	try {
		assert.throws(() => delegateExtension({
			registerTool: () => { throw new Error("host exploded"); },
			on: () => { throw new Error("host exploded"); },
		} as never), /host exploded/, "a factory failure reaches Pi's extension loader");
		delegateExtension({
			registerTool: (spec: unknown) => { tool = spec as typeof tool; },
			on: (event: string, handler: unknown) => { if (event === "session_shutdown") shutdown = handler as typeof shutdown; },
			exec: async () => { throw new Error("runtime exploded"); },
		} as never);
	} finally {
		if (previousRole === undefined) delete process.env.PI_DELEGATE_ROLE;
		else process.env.PI_DELEGATE_ROLE = previousRole;
	}
	assert.ok(shutdown);
	await assert.doesNotReject(shutdown({}, { hasUI: true, ui: { setWidget: () => { throw new Error("widget exploded"); } } }), "an event handler failure is contained");

	const bin = join(home(), "bin");
	mkdirSync(bin, { recursive: true });
	const herdr = join(bin, "herdr");
	writeFileSync(herdr, "#!/bin/sh\nexit 0\n", "utf8");
	chmodSync(herdr, 0o755);
	const previousHerdrEnv = process.env.HERDR_ENV;
	const previousPath = process.env.PATH;
	process.env.HERDR_ENV = "1";
	process.env.PATH = `${bin}:${previousPath ?? ""}`;
	try {
		assert.ok(tool);
		assert.match(tool.description, /asks the orchestrator through intercom/, "the tool description prepares the orchestrator for worker questions");
		assert.match(tool.description, /Intercom rings are the only completion wake/, "the tool description names the completion wake");
		assert.doesNotMatch(tool.description, /\bwait \(lanes|action.?=.?wait/i, "the public description does not advertise a wait action");
		assert.doesNotMatch(JSON.stringify(tool.parameters), /"const":"wait"/, "the action schema excludes wait");
		assert.equal(tool.parameters.properties?.lanes, undefined, "the wait-only lanes parameter is gone");
		assert.equal(tool.parameters.properties?.timeoutMs, undefined, "the wait-only timeout parameter is gone");
		assert.ok(tool.promptGuidelines?.some((line) => line.includes("answer it directly")), "the calling model is told to answer worker questions directly");
		const result = await tool.execute("call", { action: "start", brief: "" }, undefined, undefined, {
			hasUI: false, cwd: home(), sessionManager: { getSessionId: () => "parent" },
		});
		assert.equal(result.details.error, "runtime", "a tool action failure is returned instead of thrown");
	} finally {
		if (previousHerdrEnv === undefined) delete process.env.HERDR_ENV;
		else process.env.HERDR_ENV = previousHerdrEnv;
		if (previousPath === undefined) delete process.env.PATH;
		else process.env.PATH = previousPath;
	}
}

// 13. A live parent outside Herdr keeps ownership of its lanes.
{
	const root = home();
	const runner = new FakeRunner();
	const original = new DelegateService(runner, root);
	await original.execute({ action: "start", brief: "x", name: "foreign-lane" }, context(root, "outside-herdr"));

	const newcomer = new DelegateService(runner, root);
	await newcomer.adopt(context(root, "new-parent"));
	const listed = (await newcomer.execute({ action: "list" }, context(root, "new-parent"))).lanes as Array<Record<string, unknown>>;
	assert.equal(listed.length, 1);
	assert.equal(listed[0]?.lane, "foreign-lane");
	assert.equal(listed[0]?.ownership, "other-parent", "the live non-Herdr parent is reported instead of displaced");
	assert.equal(listed[0]?.owner, "outside-herdr");
	await assert.rejects(newcomer.execute({ action: "stop", lane: "foreign-lane" }, context(root, "new-parent")), /Unknown delegate lane/, "a foreign lane is visible but not controllable");
	assert.equal((await readRegistry(registryPath(root, "outside-herdr"))).lanes[0]?.ownerSession, "outside-herdr");
}

// 14. A prompt transition timeout returns success and leaves the lane addressable.
{
	const root = home();
	const runner = new FakeRunner();
	runner.promptTransitionConfirmed = false;
	const service = new DelegateService(runner, root);
	const started = await service.execute({ action: "start", brief: "x", name: "lane-slow" }, context(root));
	assert.equal(started.lane, "lane-slow");
	assert.equal(started.transitionConfirmed, false, "the result says the working transition was not confirmed");
	assert.ok(started.pane, "start still returns its live pane");
	const registry = await readRegistry(registryPath(root));
	assert.equal(registry.lanes[0]?.closed, false, "the timed-out lane remains registered as live");
	const listed = (await service.execute({ action: "list" }, context(root))).lanes as Array<Record<string, unknown>>;
	assert.equal(listed[0]?.lane, "lane-slow", "the lane remains addressable after the timeout");
}

// 15. A pane that is not yet an available shell is waited for and retried.
{
	const root = home();
	const runner = new FakeRunner();
	runner.startBusyTimes = 2;
	const service = new DelegateService(runner, root);
	const started = await service.execute({ action: "start", brief: "x", name: "lane-busy" }, context(root));
	assert.equal(started.lane, "lane-busy");
	assert.ok(runner.calls.some((call) => call.args[1] === "process-info"), "start waits for the split pane to reach its shell prompt");
	assert.equal(runner.calls.filter((call) => `${call.args[0]} ${call.args[1]}` === "agent start").length, 3, "agent_pane_busy is retried instead of losing the lane");

	const hostile = new FakeRunner();
	hostile.startBusyTimes = 99;
	const brittleRoot = home();
	const brittle = new DelegateService(hostile, brittleRoot);
	const retained = await brittle.execute({ action: "start", brief: "x", name: "lane-dead" }, context(brittleRoot));
	assert.equal(retained.transitionConfirmed, false, "start never throws after a pane exists");
	assert.match(String(retained.error), /agent_pane_busy/);
	assert.equal((await readRegistry(registryPath(brittleRoot))).lanes[0]?.closed, false, "a post-pane failure stays addressable");
}

// 16. The widget sizes every column to its data, so no lane name can run into the next column.
{
	const plain = (text: string) => text;
	const view = (over: Partial<LaneView> & { lane: string }): LaneView => ({ profile: "worker", status: "working", model: "openai-codex/gpt-5.6-sol:high", contextPct: 12.5, spendUsd: 0.4, rang: false, unread: false, ...over });
	const longest = "a".repeat(32);
	const lines = renderWidget([view({ lane: longest }), view({ lane: "b", profile: "scout", status: "done" })], 200, plain);
	const [rule, header, first, second] = lines as [string, string, string, string];
	assert.match(rule, /^\u2500{200}$/, "a rule tops the widget");
	assert.match(header, /^delegate {2}2 live · \$0\.80$/, "one label heads the group instead of blanks padding every later row");
	assert.equal(first.indexOf("worker"), second.indexOf("scout"), "the profile column starts at the same place for a 32 character name and a 1 character name");
	assert.ok(first.includes(`${clip(longest, 24)}  worker`), "the two space gap survives the longest allowed lane name");
	assert.ok(first.indexOf("worker") > first.indexOf(clip(longest, 24)), "the name never overlaps the profile");
	assert.equal(lines.length, 4, "one rule, one header, one row per lane");

	for (let length = 1; length <= 32; length += 1) {
		const name = "x".repeat(length);
		const rows = renderWidget([view({ lane: name }), view({ lane: "zzz", profile: "scout" })], 200, plain);
		assert.equal(rows[2]!.indexOf("worker"), rows[3]!.indexOf("scout"), `a ${length} character name keeps the columns aligned`);
	}
}

// 17. A single lane, missing numbers, and narrow terminals all still render.
{
	const plain = (text: string) => text;
	const bare: LaneView = { lane: "solo", profile: "worker", status: "pending", model: "openai-codex/gpt-5.6-luna", contextPct: null, spendUsd: null, rang: false, unread: false };
	const solo = renderWidget([bare], 120, plain);
	assert.equal(solo.length, 3);
	assert.match(solo[1]!, /^delegate {2}1 live$/, "one live lane and no numbers leaves the header with nothing else to say");
	const cells = laneRows([bare])[1]!.cells;
	assert.equal(cells[5]!.text, "— ctx", "a missing context reading shows a dash");
	assert.equal(cells[6]!.text, "—", "a missing spend shows its own dash, not the context one");
	assert.equal(solo[2]!.match(/—/g)?.length, 2, "context and spend each show a dash of their own");
	assert.ok(!solo[2]!.includes("NaN") && !solo[2]!.includes("null"), "nulls never leak into the row");
	assert.ok(solo[2]!.endsWith("—"), "an empty note leaves no trailing padding");

	const narrow = renderWidget([{ lane: "a-very-long-lane-name-here", profile: "worker", status: "blocked", model: "anthropic/claude-opus-5", contextPct: 99.9, spendUsd: 12.5, rang: true, unread: true }], 24, plain);
	for (const line of narrow) assert.ok(line.length <= 24, `every line fits the width: ${JSON.stringify(line)}`);
	assert.ok(narrow[2]!.trimStart().startsWith("!"), "the attention marker sits leftmost so truncation cannot hide it");
}

// 18. Blocked and unread carry weight the other rows do not.
{
	const mark = (text: string, tone: string, bold: boolean) => `<${tone}${bold ? ":bold" : ""}>${text}</>`;
	const lanes: LaneView[] = [
		{ lane: "calm", profile: "worker", status: "working", model: "openai-codex/gpt-5.6-sol:high", contextPct: 5, spendUsd: 0.1, rang: false, unread: false },
		{ lane: "stuck", profile: "worker", status: "blocked", model: "openai-codex/gpt-5.6-sol:high", contextPct: 5, spendUsd: 0.1, rang: true, unread: false },
		{ lane: "waiting", profile: "scout", status: "done", model: "openai-codex/gpt-5.6-luna", contextPct: 5, spendUsd: 0.1, rang: true, unread: true },
	];
	const lines = renderWidget(lanes, 200, mark);
	assert.match(lines[1]!, /2 need you/, "the header counts both states that need the operator");
	assert.ok(lines[2]!.includes("<attention:bold>BLOCKED"), "blocked is painted with the attention tone and bold");
	assert.ok(lines[2]!.includes("<attention:bold>needs you"), "the blocked note carries the same weight");
	assert.ok(lines[4]!.includes("<notice>unread handoff"), "an unread handoff is painted with the notice tone");
	assert.ok(!lines[3]!.includes("attention") && !lines[3]!.includes("notice"), "a calm lane borrows neither attention tone");
	assert.ok(lines[3]!.includes("<text>working"), "a working lane stays quiet");

	assert.deepEqual(sortLaneViews(lanes).map((lane) => lane.lane), ["stuck", "calm", "waiting"], "blocked sorts to the top, then working");
	const rows = laneRows(lanes);
	assert.equal(rows.length, 4);
	assert.equal(rows[1]!.cells[0]!.text, "!", "the blocked lane gets the loud gutter mark");
	assert.equal(rows[3]!.cells[0]!.text, "•", "the unread lane gets the quieter gutter mark");

	// The component asks the theme for every color, so a theme switch repaints instead of freezing an escape.
	const asked: string[] = [];
	const theme = { fg: (color: string, text: string) => { asked.push(color); return `[${color}]${text}`; }, bold: (text: string) => `*${text}*` };
	const component = laneWidgetFactory(lanes)(undefined, theme);
	const painted = component.render(200);
	assert.ok(asked.includes("error"), "the blocked row asks the theme for its error color");
	assert.ok(asked.includes("warning"), "the unread row asks the theme for its warning color");
	assert.ok(painted.every((line) => !line.includes("\u001b")), "the widget writes no escape of its own; every color comes from the theme");
	assert.ok(painted[2]!.includes("[error]*BLOCKED*"), "bold is applied inside the color so the color reset cannot drop it");
	assert.equal(component.render(200), painted, "an unchanged width reuses the cached paint");
	component.invalidate();
	assert.notEqual(component.render(200), painted, "invalidate drops the cache so a theme change takes effect");
}

// 19. The signature only changes when something the operator can see changes.
{
	const base: LaneView = { lane: "a", profile: "worker", status: "working", model: "openai-codex/gpt-5.6-sol:high", contextPct: 10, spendUsd: 1, rang: false, unread: false };
	assert.equal(laneSignature([base]), laneSignature([{ ...base }]), "identical data produces one signature");
	assert.notEqual(laneSignature([base]), laneSignature([{ ...base, contextPct: 11 }]), "a moved context reading repaints");
	assert.notEqual(laneSignature([base]), laneSignature([{ ...base, status: "blocked" }]), "a status change repaints");
	assert.notEqual(laneSignature([base]), laneSignature([{ ...base, unread: true }]), "an arriving handoff repaints");
	assert.notEqual(laneSignature([base]), laneSignature([{ ...base, model: "anthropic/claude-opus-5" }]), "a different model repaints");
	assert.notEqual(laneSignature([base]), laneSignature([{ ...base, finished: true, finishedAt: "2026-09-11T00:00:00.000Z" }]), "a lane that finished repaints");
	assert.equal(laneSignature([base, { ...base, lane: "b" }]), laneSignature([{ ...base, lane: "b" }, base]), "row order is not part of the signature");
	assert.equal(clip("abcdef", 4), "abc…");
	assert.equal(clip("abc", 4), "abc");
}

// 20. The stats watcher reads only the bytes a transcript grew by.
{
	const dir = mkdtempSync(join(tmpdir(), "delegate-stats-"));
	const file = join(dir, "session.jsonl");
	// The real assistant entry shape, keys copied from a live transcript. There is no contextWindow
	// on it, which is why the window can only come from the model registry.
	const turn = (tokens: number, cost: number) => `${JSON.stringify({ message: { role: "assistant", api: "responses", provider: "openai-codex", model: "gpt-5.6-sol", stopReason: "stop", usage: { input: tokens - 2, output: 2, totalTokens: tokens, cost: { total: cost } } } })}\n`;
	writeFileSync(file, turn(1_000, 0.01), "utf8");
	const watcher = new SessionStatsWatcher();
	assert.deepEqual(await watcher.sample(file, 200_000), { contextPct: 0.5, spendUsd: 0.01 });

	appendFileSync(file, turn(4_000, 0.02), "utf8");
	assert.deepEqual(await watcher.sample(file, 200_000), { contextPct: 2, spendUsd: 0.03 }, "the second sample adds the appended turn to the first");

	const half = turn(9_000, 0.04);
	appendFileSync(file, half.slice(0, 20), "utf8");
	assert.deepEqual(await watcher.sample(file, 200_000), { contextPct: 2, spendUsd: 0.03 }, "a half written line is held back, not parsed as garbage");
	appendFileSync(file, half.slice(20), "utf8");
	assert.deepEqual(await watcher.sample(file, 200_000), { contextPct: 4.5, spendUsd: 0.07 }, "the line lands once it is complete");

	assert.deepEqual(await watcher.sample(file, 100_000), { contextPct: 9, spendUsd: 0.07 }, "the configured context window drives the reading");
	assert.deepEqual(await watcher.sample(file, null), { contextPct: null, spendUsd: 0.07 }, "a model registry miss leaves no window, so the context reading is dropped and spend is kept");
	assert.deepEqual(await watcher.sample(join(dir, "missing.jsonl"), null), { contextPct: null, spendUsd: null }, "a missing transcript is not an error");

	writeFileSync(file, turn(500, 0.005), "utf8");
	assert.deepEqual(await watcher.sample(file, 200_000), { contextPct: 0.3, spendUsd: 0.005 }, "a rewritten shorter file restarts from zero");

	// A different file at the same path is not an appended one, even when it is longer.
	const replacement = join(dir, "replacement.jsonl");
	writeFileSync(replacement, turn(700, 0.001) + turn(800, 0.002) + turn(900, 0.003), "utf8");
	assert.ok(statSync(replacement).size > statSync(file).size, "the replacement is longer than the file it takes over from");
	renameSync(replacement, file);
	assert.deepEqual(await watcher.sample(file, 200_000), { contextPct: 0.5, spendUsd: 0.006 }, "a swapped in transcript restarts the tally instead of keeping a stale offset");

	// A long lane's transcript outgrows one read buffer. One sample must still consume all of it,
	// or the widget shows numbers that crawl toward the truth over several ticks.
	const big = join(dir, "big.jsonl");
	const filler = `${JSON.stringify({ message: { role: "user", text: "x".repeat(900) } })}\n`;
	writeFileSync(big, filler.repeat(5_000) + turn(80_000, 2), "utf8");
	assert.ok(statSync(big).size > 4 * 1024 * 1024, "the fixture is larger than one read buffer");
	assert.deepEqual(await new SessionStatsWatcher().sample(big, 200_000), { contextPct: 40, spendUsd: 2 }, "one sample reads past the buffer to the last turn");
}

// 21. The widget samples lanes from the registry without shelling out, and keeps this session's
// finished lanes while leaving another parent's alone.
{
	const root = home();
	const delegateRoot = join(root, ".pi", "agent", "delegate");
	const handoff = join(delegateRoot, "parent-1", "live.md");
	mkdirSync(join(delegateRoot, "parent-1"), { recursive: true });
	writeFileSync(handoff, "done", "utf8");
	const lane = (over: Record<string, unknown>) => ({
		lane: "live", profile: "worker", pane: "w0:p1", session: "s", cwd: root, handoff,
		started: "2026-01-01T00:00:00.000Z", read: false, closed: false, status: "working", ownerSession: "parent-1", ...over,
	});
	writeFileSync(join(delegateRoot, "parent-1", "lanes.json"), JSON.stringify({ lanes: [
		lane({}),
		lane({ lane: "gone", closed: true, closedAt: "2026-01-02T00:00:00.000Z", status: "closed", read: true }),
		lane({ lane: "elsewhere", cwd: "/other/checkout", ownerSession: "parent-9", handoff: join(delegateRoot, "parent-1", "elsewhere.md") }),
		lane({ lane: "adopted", cwd: "/other/checkout", handoff: join(delegateRoot, "parent-1", "adopted.md"), read: true, status: "blocked" }),
		// Another parent's finished lane, in this very checkout. A dimmed row for it would be history
		// this session never made.
		lane({ lane: "strangers", closed: true, closedAt: "2026-01-02T00:00:00.000Z", status: "closed", ownerSession: "parent-9", handoff: join(delegateRoot, "parent-1", "strangers.md") }),
	] }), "utf8");

	const views = await sampleLaneViews({ root: delegateRoot, cwd: root, parentId: "parent-1", watcher: new SessionStatsWatcher(), finished: new ClosedLaneMemory() });
	assert.deepEqual(views.map((view) => view.lane), ["adopted", "live", "gone"], "live lanes first, this session's finished lane below them, another parent's lanes out entirely");
	assert.equal(views[2]!.finished, true, "the closed lane is marked finished so it paints dim");
	assert.equal(views[0]!.finished, undefined, "a live lane is not finished");
	assert.equal(views[1]!.unread, true, "a present handoff on an unread lane is flagged");
	assert.equal(views[1]!.contextPct, null, "a lane with no transcript reports no context");
	assert.equal(views[0]!.unread, false, "a missing handoff file is not unread");

	assert.deepEqual(await sampleLaneViews({ root: join(root, "nope"), cwd: root, parentId: "parent-1", watcher: new SessionStatsWatcher() }), [], "a missing delegate root is empty, not an error");
}

// 22. A rule tops the widget so it does not read as the tail of the todo list above it.
{
	const plain = (text: string) => text;
	const lanes: LaneView[] = [{ lane: "solo", profile: "worker", status: "working", model: "openai-codex/gpt-5.6-sol:high", contextPct: 1, spendUsd: 0.1, rang: false, unread: false }];
	const lines = renderWidget(lanes, 40, plain);
	assert.equal(lines.length, 3, "the rule costs exactly one line");
	assert.match(lines[0]!, /^\u2500{40}$/, "one rule spans the width, above the header");
	assert.ok(!lines[1]!.includes("\u2500") && !lines[2]!.includes("\u2500"), "no bottom rule and no side borders");
	assert.equal(separatorLine(1, plain), "\u2500", "a one column terminal still gets a rule");
	assert.equal(separatorLine(0, plain), undefined, "no width means no rule");
	for (const width of [1, 2, 5, 24]) assert.equal(renderWidget(lanes, width, plain)[0]!.length, width, `a ${width} column terminal gets a rule that fits it exactly`);
	assert.deepEqual(renderWidget([], 40, plain), [], "a hidden widget adds no rule");

	const asked: string[] = [];
	const theme = { fg: (color: string, text: string) => { asked.push(color); return `[${color}]${text}`; }, bold: (text: string) => `*${text}*` };
	const painted = laneWidgetFactory(lanes)(undefined, theme).render(30);
	assert.equal(asked[0], "dim", "the rule asks the theme for a muted color instead of writing an escape");
	assert.match(painted[0]!, /^ \[dim\]\u2500{29}$/, "the rule shares the body's inset and reaches the right edge");
	assert.ok(painted.every((line) => !line.includes("\u001b")), "the rule writes no escape of its own");

	const hostile = { fg: () => { throw new Error("Unknown theme color: nope"); }, bold: (text: string) => text };
	const survived = laneWidgetFactory(lanes)(undefined, hostile).render(30);
	assert.ok(survived[1]!.includes("delegate") && survived[2]!.includes("solo"), "a theme that rejects a color costs the color, not the widget");
}

// 23. A herdr that is present but failing still only syncs every fourth tick.
{
	const root = home();
	const delegateRoot = join(root, ".pi", "agent", "delegate", "parent-1");
	mkdirSync(delegateRoot, { recursive: true });
	writeFileSync(join(delegateRoot, "lanes.json"), JSON.stringify({ lanes: [{
		lane: "live", profile: "worker", pane: "w0:p1", session: "s", cwd: root, handoff: join(delegateRoot, "live.md"),
		started: "2026-01-01T00:00:00.000Z", read: false, closed: false, status: "working", ownerSession: "parent-1",
	}] }), "utf8");
	const bin = join(root, "bin");
	mkdirSync(bin, { recursive: true });
	writeFileSync(join(bin, "herdr"), "#!/bin/sh\nexit 1\n", "utf8");
	chmodSync(join(bin, "herdr"), 0o755);

	const previous = { home: process.env.HOME, herdrEnv: process.env.HERDR_ENV, path: process.env.PATH, role: process.env.PI_DELEGATE_ROLE };
	const realInterval = globalThis.setInterval;
	let beat: (() => void) | undefined;
	const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
	const syncTicks: number[] = [];
	const widgetCalls: string[] = [];
	let currentTick = 0;
	delete process.env.PI_DELEGATE_ROLE;
	process.env.HOME = root;
	process.env.HERDR_ENV = "1";
	process.env.PATH = `${bin}:${previous.path ?? ""}`;
	globalThis.setInterval = ((callback: () => void) => { beat = callback; return { unref() {} }; }) as never;
	try {
		delegateExtension({
			registerTool: () => {},
			on: (event: string, handler: unknown) => { handlers.set(event, handler as (event: unknown, ctx: unknown) => Promise<void>); },
			exec: async () => { if (currentTick) syncTicks.push(currentTick); throw new Error("herdr is down"); },
		} as never);
		const ctx = { hasUI: true, cwd: root, sessionManager: { getSessionId: () => "parent-1", getEntries: () => [] }, ui: { setWidget: (_key: string, value: unknown) => { widgetCalls.push(value === undefined ? "clear" : "paint"); }, notify: () => {} } };
		await handlers.get("session_start")!({}, ctx);
		assert.ok(beat, "the timer starts even though the startup herdr calls failed");
		for (currentTick = 1; currentTick <= 12; currentTick += 1) {
			beat();
			// Long enough for one tick's file reads to land, so ticks rarely overlap.
			await new Promise((resolve) => setTimeout(resolve, 40));
		}
		currentTick = 0;
		const synced = [...new Set(syncTicks)];
		// Which tick numbers they land on moves with machine load, because a tick that is still running
		// swallows the next beat, and a swallowed beat costs a sync. The guarantee is a ceiling, one
		// sync per four ticks, so twelve ticks allow at most three and an exact count would flake.
		const gaps = synced.map((tick, index) => (index ? tick - synced[index - 1]! : tick));
		assert.ok(synced.length >= 1, "a failing herdr is still asked, so the widget can recover");
		assert.ok(synced.length <= 3, `twelve ticks with a failing herdr sync at most three times, not on every tick: ${JSON.stringify(synced)}`);
		assert.ok(gaps.every((gap) => gap >= 4), `each sync is at least four ticks after the last: ${JSON.stringify(synced)}`);

		// A tick that is already awaiting when the session shuts down must not put the cleared widget
		// back on screen.
		beat();
		await new Promise((resolve) => setTimeout(resolve, 30));
		const lanes = join(root, ".pi", "agent", "delegate", "parent-1", "lanes.json");
		writeFileSync(lanes, readFileSync(lanes, "utf8").replace("\"working\"", "\"idle\""), "utf8");
		const before = widgetCalls.length;
		beat();
		await handlers.get("session_shutdown")!({}, ctx);
		for (let drain = 0; drain < 5; drain += 1) await new Promise((resolve) => setTimeout(resolve, 30));
		assert.deepEqual(widgetCalls.slice(before), ["clear"], "a tick in flight during shutdown drops its repaint instead of restoring a cleared widget");
	} finally {
		globalThis.setInterval = realInterval;
		for (const [key, value] of Object.entries({ HOME: previous.home, HERDR_ENV: previous.herdrEnv, PATH: previous.path, PI_DELEGATE_ROLE: previous.role })) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

/** A launcher that records what would have been spawned instead of spawning it. */
class FakeLauncher {
	readonly requests: LaunchRequest[] = [];
	pid = 4242;
	readonly launch = async (request: LaunchRequest): Promise<{ pid: number }> => {
		this.requests.push(request);
		return { pid: this.pid };
	};
}

/**
 * pid → start-time witness, as `ps` would report it. Tests mutate it to kill or recycle a pid.
 * `readable` false is the `ps` that failed or timed out: it answers for nobody, which is a different
 * thing from answering that every pid is free.
 */
function fakeTable(entries: Record<number, string>) {
	const table = new Map(Object.entries(entries).map(([pid, start]) => [Number(pid), start]));
	const state = { readable: true };
	return {
		table,
		state,
		probe: async (pids: readonly number[]) => state.readable
			? { starts: new Map([...table].filter(([pid]) => pids.includes(pid))), answered: new Set(pids) }
			: { starts: new Map<number, string>(), answered: new Set<number>() },
	};
}

interface SubprocessOptions {
	launcher?: FakeLauncher;
	table?: ReturnType<typeof fakeTable>;
	runner?: FakeRunner;
	kill?: (target: number, signal: NodeJS.Signals) => void;
	/** Mutable, so a test can start a pane lane and then take herdr away from the same service. */
	herdr?: { blocked?: string };
}

function subprocessService(root: string, options: SubprocessOptions = {}) {
	// A lane's transport is a profile field now, so a headless test needs a profiles file. Written only
	// when the test has not written one of its own.
	if (!existsSync(join(root, ".agents", "pi", "delegate", "profiles.json"))) headlessProfiles(root);
	const launcher = options.launcher ?? new FakeLauncher();
	const table = options.table ?? fakeTable({ 4242: "Wed Sep 10 09:00:00 2026" });
	const runner = options.runner ?? new FakeRunner();
	const herdr = options.herdr ?? {};
	const subprocess = new SubprocessLaneRunner({
		command: "pi", launch: launcher.launch, processTable: table.probe,
		sessionId: () => "01a08c19-0000-7000-8000-00000000beef",
		...(options.kill ? { kill: options.kill } : {}),
	});
	const pane = new HerdrLaneRunner(runner, async () => herdr.blocked);
	return { launcher, table, runner, herdr, service: new DelegateService(runner, root, [pane, subprocess]) };
}

// 24. A subprocess lane is launched detached, with the brief as an argument and the child marker set.
{
	const root = home();
	const { launcher, service } = subprocessService(root);
	const started = await service.execute({ action: "start", brief: "Write READY", name: "lane-head" }, context(root));
	assert.equal(started.transport, "subprocess");
	assert.equal(started.pid, 4242);
	assert.equal(started.pane, undefined, "a headless lane has no pane");
	assert.equal(started.transitionConfirmed, undefined, "there is no pane transition to confirm");

	const request = launcher.requests[0]!;
	assert.equal(request.command, "pi");
	assert.equal(request.cwd, root);
	assert.equal(request.env.PI_DELEGATE_ROLE, "child", "depth one still holds through the environment");
	assert.equal(request.env.PI_DELEGATE_PARENT, "parent-1");
	const args = request.args;
	assert.ok(args.includes("--print"), "the worker runs non-interactively");
	assert.equal(args[args.indexOf("--model") + 1], "openai-codex/gpt-5.6-sol");
	assert.equal(args[args.indexOf("--thinking") + 1], "high", "the thinking suffix is split off the model id");
	assert.equal(args[args.indexOf("--exclude-tools") + 1], "ask_user_question");
	assert.equal(args[args.indexOf("--session-id") + 1], "01a08c19-0000-7000-8000-00000000beef", "the session id is assigned before the worker starts");
	assert.equal(args[args.indexOf("--session-dir") + 1], join(root, ".pi", "agent", "delegate", "parent-1", "lanes", "lane-head"));
	assert.equal(args[args.length - 2], "--", "the brief is the terminal argument, so a brief starting with a dash is safe");
	assert.equal(args[args.length - 1], returnContract("Write READY", String(started.handoff), "parent-1"), "the brief and its contract arrive whole, as one argument");

	const record = (await readRegistry(registryPath(root))).lanes[0]!;
	assert.equal(record.transport, "subprocess");
	assert.equal(record.pid, 4242);
	assert.equal(record.pidStart, "Wed Sep 10 09:00:00 2026", "the start time is recorded as a second witness for the pid");
	assert.equal(record.logFile, join(root, ".pi", "agent", "delegate", "parent-1", "lanes", "lane-head", "worker.log"));
	assert.equal(record.session, "01a08c19-0000-7000-8000-00000000beef");
	assert.equal(record.status, "working");
	assert.equal(existsSync(record.logFile!), true, "the log file exists before anyone needs to read it");

	assert.deepEqual(launchArguments({
		lane: "l", cwd: "/tmp", parentId: "p", model: "anthropic/claude-opus-5", policy: { tools: ["read"], excludeTools: [] },
		prompt: "go", handoff: "/tmp/h.md", stateDir: "/tmp/state",
	}, "sid"), ["--print", "--name", "l", "--model", "anthropic/claude-opus-5", "--tools", "read", "--session-dir", "/tmp/state", "--session-id", "sid", "--", "go"]);
	assert.equal(childEnvironment("p").PI_SESSION_ID, undefined, "the parent's session variables never leak into the worker");
	assert.equal(childEnvironment("p").HERDR_PANE_ID, undefined, "a paneless worker never inherits a pane id");
	assert.match(uuidV7(), /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, "the assigned id has the shape pi assigns itself");
}

// 25. Liveness needs both witnesses: a recycled pid is not the lane that recorded it.
{
	const root = home();
	const { table, service } = subprocessService(root);
	await service.execute({ action: "start", brief: "x", name: "lane-live" }, context(root));

	const working = (await service.execute({ action: "list" }, context(root))).lanes as Array<Record<string, unknown>>;
	assert.equal(working[0]?.status, "working", "a live pid with its recorded start time is the lane still running");
	assert.equal(working[0]?.transport, "subprocess");

	// Same pid, different process: the witness no longer matches, so the lane is not alive.
	table.table.set(4242, "Wed Sep 10 11:30:00 2026");
	const recycled = (await service.execute({ action: "list" }, context(root))).lanes as Array<Record<string, unknown>>;
	assert.equal(recycled[0]?.status, "done", "a reused pid does not pass as a live lane");
	assert.equal((await readRegistry(registryPath(root))).lanes[0]?.closed, false, "an exited worker stays addressable so its handoff can still be read");

	table.table.delete(4242);
	const exited = (await service.execute({ action: "list" }, context(root))).lanes as Array<Record<string, unknown>>;
	assert.equal(exited[0]?.status, "done", "a pid that is gone reads as done, not as unknown");
}

// 26. A headless lane never shells out; stop signals the process group.
{
	const root = home();
	const signalled: Array<{ target: number; signal: string }> = [];
	const table = fakeTable({ 4242: "Wed Sep 10 09:00:00 2026" });
	const { runner, service } = subprocessService(root, { table, kill: (target, signal) => { signalled.push({ target, signal }); table.table.delete(4242); } });
	const started = await service.execute({ action: "start", brief: "x", name: "lane-stop" }, context(root));
	await service.execute({ action: "list" }, context(root));

	table.table.set(4242, "Wed Sep 10 09:00:00 2026");
	const stopped = await service.execute({ action: "stop", lane: "lane-stop" }, context(root));
	assert.equal(stopped.gone, true);
	assert.equal(stopped.alreadyGone, false);
	assert.equal(stopped.pid, 4242);
	assert.equal(signalled[0]?.target, -4242, "stop signals the whole process group, not just the leader");
	assert.equal(signalled[0]?.signal, "SIGTERM");
	assert.equal((await readRegistry(registryPath(root))).lanes[0]?.closed, true);
	const again = await service.execute({ action: "stop", lane: "lane-stop" }, context(root));
	assert.equal(again.alreadyGone, true, "stop is idempotent for a process that is already gone");

	assert.deepEqual(runner.calls, [], "a headless lane starts, lists and stops without ever running herdr");
	assert.ok(started.logFile, "the operator is handed the one place a paneless worker can be watched");
}

// 27. The one blocked state a paneless lane can report is an intercom ask, and it clears itself.
{
	const root = home();
	const { service } = subprocessService(root);
	await service.execute({ action: "start", brief: "x", name: "lane-ask" }, context(root));
	const record = (await readRegistry(registryPath(root))).lanes[0]!;
	const transcript = join(record.logFile!, "..", `2026-09-10T00-00-00-000Z_${record.session}.jsonl`);
	writeFileSync(transcript, "", "utf8");

	assert.equal(await service.markRang(record.session, context(root), { expectsReply: false }), "lane-ask");
	assert.equal((await readRegistry(registryPath(root))).lanes[0]?.status, "working", "a plain doorbell ring is not a block");

	assert.equal(await service.markRang(record.session, context(root), { expectsReply: true }), "lane-ask");
	const blocked = (await service.execute({ action: "list" }, context(root))).lanes as Array<Record<string, unknown>>;
	assert.equal(blocked[0]?.status, "blocked", "an ask that expects a reply is the lane waiting on the operator");
	assert.equal(blocked[0]?.sessionFile, transcript, "the transcript is found from the session id, so context and spend still read");

	// The worker resumes when its reply lands, and the only evidence of that is its transcript moving.
	const later = Date.now() + 10_000;
	utimesSync(transcript, new Date(later), new Date(later));
	const resumed = (await service.execute({ action: "list" }, context(root))).lanes as Array<Record<string, unknown>>;
	assert.equal(resumed[0]?.status, "working", "a transcript that moved after the ask means the reply arrived");
	assert.equal((await readRegistry(registryPath(root))).lanes[0]?.blockedAt, undefined, "the blocked marker is dropped with the state");
}

// 28. Transport comes from the profile and nowhere else; a caller that names one is refused.
{
	const root = home();
	writeProfiles(root, {
		worker: { model: "openai-codex/gpt-5.6-sol" },
		scout: { model: "openai-codex/gpt-5.6-luna", transport: "subprocess" },
	});
	const { launcher, runner, service } = subprocessService(root);

	const headless = await service.execute({ action: "start", profile: "scout", brief: "look", name: "lane-p" }, context(root));
	assert.equal(headless.warning, undefined, "a transport field is a valid profile, not a malformed one");
	assert.equal(headless.transport, "subprocess", "the profile picks the transport");

	const pane = await service.execute({ action: "start", profile: "worker", brief: "build", name: "lane-q" }, context(root));
	assert.equal(pane.transport, "herdr", "a profile with no transport still gets a pane");
	assert.ok(pane.pane, "the default transport is unchanged");

	// The operator owns the choice of whether they can watch a lane, so the tool refuses to take it
	// from a caller rather than quietly obeying a parameter that no longer exists.
	await assert.rejects(service.execute({ action: "start", profile: "worker", brief: "look", name: "lane-r", transport: "subprocess" } as never, context(root)),
		/transport is not a per-call choice/, "a call cannot move a pane lane out of sight");
	await assert.rejects(service.execute({ action: "start", profile: "scout", brief: "look", name: "lane-r", transport: "herdr" } as never, context(root)),
		/transport is not a per-call choice/, "and it cannot move a headless lane into a pane either");
	await assert.rejects(service.execute({ action: "start", brief: "x", name: "lane-s", transport: "telepathy" } as never, context(root)), /transport is not a per-call choice/);
	assert.equal(launcher.requests.length, 1, "only the lane whose profile asks for it was launched as a process");
	assert.equal((await readRegistry(registryPath(root))).lanes.length, 2, "a refused start leaves no lane behind");
	assert.ok(runner.calls.length, "the pane lane still went through herdr");

	// The model is still the caller's to choose, because matching a model to a lane's difficulty is
	// the orchestrator's job. That asymmetry is deliberate.
	const harder = await service.execute({ action: "start", profile: "worker", brief: "hard", name: "lane-u", model: "anthropic/claude-opus-5" }, context(root));
	assert.equal(harder.transport, "herdr");
	assert.equal((await readRegistry(registryPath(root))).lanes.find((entry) => entry.lane === "lane-u")?.model, "anthropic/claude-opus-5", "model stays overridable per call");

	assert.equal(resolveTransport(undefined), "herdr", "herdr is the default when a profile says nothing");
	assert.equal(resolveTransport("subprocess"), "subprocess");
	assert.throws(() => resolveTransport("telepathy"), /Unknown delegate transport/, "the profile value is still validated");

	writeProfiles(root, { scout: { model: "m", transport: "carrier-pigeon" } });
	const rejected = await service.execute({ action: "start", brief: "x", name: "lane-t" }, context(root));
	assert.match(String(rejected.warning), /malformed/, "a transport the runner does not have is a malformed profile");
}

// 29. The real launcher produces a process that outlives the call, and ps witnesses it.
{
	const dir = mkdtempSync(join(tmpdir(), "delegate-spawn-"));
	// A stand-in for pi that ignores its arguments and stays alive, so the assertions are about the
	// launcher, the process table and the kill rather than about pi.
	const fakePi = join(dir, "fake-pi");
	writeFileSync(fakePi, "#!/bin/sh\nsleep 30\n", "utf8");
	chmodSync(fakePi, 0o755);
	const runner = new SubprocessLaneRunner({ command: fakePi, sessionId: () => "01a08c19-0000-7000-8000-0000000000ff" });
	const spec = {
		lane: "lane-real", cwd: dir, parentId: "parent-1", model: "none", policy: { excludeTools: [] },
		prompt: "unused", handoff: join(dir, "h.md"), stateDir: join(dir, "state"),
	};
	// The launcher is generic, so a shell stands in for pi and the assertion stays about the process.
	const handle = await runner.spawn({ ...spec }, async () => {});
	const record = { lane: "lane-real", profile: "worker", pane: "", session: handle.session ?? "", cwd: dir, handoff: spec.handoff, started: new Date().toISOString(), read: false, closed: false, transport: "subprocess", pid: handle.pid, pidStart: handle.pidStart, logFile: handle.logFile } as LaneRecord;
	assert.ok(handle.pid, "the launcher returns a pid");
	assert.ok(handle.pidStart, "ps witnesses the process it just started");
	const observed = (await runner.probe([record])).get("lane-real");
	assert.equal(observed?.kind === "status" && observed.status, "working", "a real detached process reads as working");

	const killed = await runner.kill(record);
	assert.equal(killed.gone, true, "the process group is killed");
	const after = (await runner.probe([record])).get("lane-real");
	assert.equal(after?.kind === "status" && after.status, "done", "a killed worker reads as done");

	const stale = { ...record, pidStart: "Wed Sep 10 00:00:00 1999" };
	const mismatched = (await runner.probe([stale])).get("lane-real");
	assert.equal(mismatched?.kind === "status" && mismatched.status, "done", "a witness that does not match is not this lane");
}

// 30. The sort key the widget uses is one exported function, not two copies drifting apart.
{
	assert.deepEqual(["closed", "pending", "done", "working", "blocked"].sort((a, b) => statusRank(a) - statusRank(b)), ["blocked", "working", "done", "pending", "closed"]);
	assert.equal(statusRank("idle"), statusRank("done"), "idle and done rank together");

	// The widget sorts through the same key, so every status it can show ranks the same on both sides.
	const statuses = ["closed", "pending", "done", "working", "blocked", "idle", "unknown"];
	const views: LaneView[] = statuses.map((status) => ({ lane: `l-${status}`, profile: "worker", status, model: null, contextPct: null, spendUsd: null, rang: false, unread: false }));
	const expected = [...statuses].sort((left, right) => statusRank(left) - statusRank(right) || `l-${left}`.localeCompare(`l-${right}`));
	assert.deepEqual(sortLaneViews(views).map((view) => view.status), expected, "the widget ranks every status exactly as the exported key does");
}

// 31. A `ps` nobody can read is an unknown answer, never a dead one.
{
	const root = home();
	const launcher = new FakeLauncher();
	// This process: certainly alive, so `kill(pid, 0)` can act as the second opinion ps cannot give.
	launcher.pid = process.pid;
	const table = fakeTable({ [process.pid]: "Wed Sep 10 09:00:00 2026" });
	const signalled: Array<{ target: number; signal: string }> = [];
	const { service } = subprocessService(root, { launcher, table, kill: (target, signal) => { signalled.push({ target, signal }); } });
	await service.execute({ action: "start", brief: "x", name: "lane-dark" }, context(root));

	table.state.readable = false;
	const listed = (await service.execute({ action: "list" }, context(root))).lanes as Array<Record<string, unknown>>;
	assert.equal(listed[0]?.status, "unknown", "a ps that failed is not proof the worker exited");
	assert.equal((await readRegistry(registryPath(root))).lanes[0]?.closed, false, "a lane whose liveness cannot be established stays open");

	await assert.rejects(service.execute({ action: "stop", lane: "lane-dark" }, context(root)), /will not signal process group/, "stop says it could not act instead of returning alreadyGone");
	assert.deepEqual(signalled, [], "nothing is signalled while the pid is unproven");
	assert.equal((await readRegistry(registryPath(root))).lanes[0]?.closed, false, "the record survives the refused stop, so the pid stays addressable");

	table.state.readable = true;
	const recovered = (await service.execute({ action: "list" }, context(root))).lanes as Array<Record<string, unknown>>;
	assert.equal(recovered[0]?.status, "working", "a ps that answers again puts the lane back to working");

	table.table.delete(process.pid);
	const stopped = await service.execute({ action: "stop", lane: "lane-dark" }, context(root));
	assert.equal(stopped.gone, true, "once ps answers again, a lane that really exited closes normally");
	assert.deepEqual(signalled, [], "no signal was ever sent while the pid could not be proven");
}

// 32. Without a witness, nothing is killed: a recycled pid would take a stranger's process group.
{
	const root = home();
	const launcher = new FakeLauncher();
	launcher.pid = process.pid;
	const table = fakeTable({ [process.pid]: "Wed Sep 10 09:00:00 2026" });
	const signalled: Array<{ target: number; signal: string }> = [];
	const { service } = subprocessService(root, { launcher, table, kill: (target, signal) => { signalled.push({ target, signal }); } });
	await service.execute({ action: "start", brief: "x", name: "lane-blind" }, context(root));
	// The shape a spawn leaves behind when ps failed while the worker was starting.
	await mutateRegistry(registryPath(root), (registry) => { delete registry.lanes[0]!.pidStart; });

	const listed = (await service.execute({ action: "list" }, context(root))).lanes as Array<Record<string, unknown>>;
	assert.equal(listed[0]?.status, "unknown", "a live pid with no witness is not the lane still working");

	await assert.rejects(service.execute({ action: "stop", lane: "lane-blind" }, context(root)), /no recorded process start time/, "stop names the missing witness");
	await assert.rejects(service.execute({ action: "stop", lane: "lane-blind" }, context(root)), /kill -TERM -/, "and tells the operator how to finish the job by hand");
	assert.deepEqual(signalled, [], "a witness-less pid is never group-signalled");
	assert.equal((await readRegistry(registryPath(root))).lanes[0]?.closed, false, "the lane is not closed behind a refused stop");

	// A pid nothing holds is still safe to report as gone: there is no process group to hit.
	await mutateRegistry(registryPath(root), (registry) => { registry.lanes[0]!.pid = 4_194_301; });
	const freed = await service.execute({ action: "stop", lane: "lane-blind" }, context(root));
	assert.equal(freed.alreadyGone, true, "a pid no process holds needs no witness and no signal");
	assert.deepEqual(signalled, []);
}

// 33. The witness is read in a fixed locale, and one recorded in another locale still matches.
{
	assert.equal(sameProcessStart("Thu Sep 10 19:43:39 2026", "Thu Sep 10 19:43:39 2026"), true);
	assert.equal(sameProcessStart("Do. 10 Sep. 19:43:39 2026", "Thu Sep 10 19:43:39 2026"), true, "the same process recorded under de_DE is still the same process");
	assert.equal(sameProcessStart("Thu Sep 10 19:43:39 2026", "Thu Sep 10 19:43:40 2026"), false, "one second apart is a different process");
	assert.equal(sameProcessStart("", "Thu Sep 10 19:43:39 2026"), false, "an empty witness proves nothing");

	const previous = { lcAll: process.env.LC_ALL, lang: process.env.LANG };
	process.env.LC_ALL = "de_DE.UTF-8";
	process.env.LANG = "de_DE.UTF-8";
	try {
		const witness = String((await psTable([process.pid])).starts.get(process.pid));
		assert.match(witness, /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) /, `ps is asked in a fixed locale, so the parent's LANG cannot change the witness: ${witness}`);
	} finally {
		for (const [key, value] of Object.entries({ LC_ALL: previous.lcAll, LANG: previous.lang })) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

// 34. One corrupt pid costs its own lane and nothing else.
{
	// `ps -p good,4194303` prints nothing and exits 1 on macOS ("process id too large"), and
	// `99999999999` is not a pid on any kernel. Either one used to mark every headless lane done.
	const snapshot = await psTable([process.pid, 4_194_303, 99_999_999_999]);
	assert.ok(snapshot.starts.get(process.pid), "a bad pid in the batch does not hide a live one");
	assert.ok(snapshot.answered.has(process.pid));
	assert.equal(snapshot.starts.has(99_999_999_999), false, "an impossible pid holds no process");

	// A pid nothing holds is a real answer: ps exits 1 with an empty stderr and that means "free".
	const free = await psTable([process.pid, 1]);
	assert.ok(free.answered.has(1) && free.answered.has(process.pid), "every queried pid is answered for");

	const root = home();
	mkdirSync(join(root, ".pi", "agent", "delegate", "parent-1"), { recursive: true });
	writeFileSync(registryPath(root), JSON.stringify({ lanes: [{
		lane: "corrupt", profile: "worker", pane: "", session: "", cwd: root, handoff: join(root, "c.md"),
		started: new Date().toISOString(), read: false, closed: false, transport: "subprocess",
		pid: 99_999_999_999, pidStart: "Wed Sep 10 09:00:00 2026",
	}] }), "utf8");
	const loaded = (await readRegistry(registryPath(root))).lanes[0]!;
	assert.equal(loaded.pid, undefined, "a pid no kernel could hand out is dropped at load instead of reaching ps");
	assert.equal(loaded.lane, "corrupt", "the rest of the entry survives");
}

// 35. A session that cannot reach herdr still lists, reads and stops its headless lanes.
{
	const root = home();
	const herdr: { blocked?: string } = {};
	const table = fakeTable({ 4242: "Wed Sep 10 09:00:00 2026" });
	const { service } = subprocessService(root, { herdr, table, kill: () => { table.table.delete(4242); } });
	const pane = await service.execute({ action: "start", profile: "pane", brief: "pane work", name: "lane-pane" }, context(root));
	const head = await service.execute({ action: "start", brief: "headless work", name: "lane-head" }, context(root));
	assert.ok(pane.pane);

	// The session loses herdr: no HERDR_ENV, or the binary is gone, or the daemon stopped answering.
	herdr.blocked = "delegate cannot use the herdr transport: HERDR_ENV is not 1";
	const result = await service.execute({ action: "list" }, context(root));
	const lanes = result.lanes as Array<Record<string, unknown>>;
	assert.equal(lanes.length, 2, "both lanes are still listed");
	assert.equal(lanes.find((lane) => lane.lane === "lane-head")?.status, "working", "the headless lane still gets a fresh status");
	assert.equal(lanes.find((lane) => lane.lane === "lane-pane")?.status, "working", "the pane lane keeps its last known status");
	assert.match(String(result.staleTransports), /herdr/, "the result names the transport it could not ask");

	writeFileSync(String(head.handoff), "HEADLESS READY\n", "utf8");
	const read = await service.execute({ action: "read", lane: "lane-head" }, context(root));
	assert.equal(read.body, "HEADLESS READY\n", "the handoff is readable without herdr");
	const stopped = await service.execute({ action: "stop", lane: "lane-head" }, context(root));
	assert.equal(stopped.gone, true, "the headless lane stops without herdr");

	const records = (await readRegistry(registryPath(root))).lanes;
	assert.equal(records.find((lane) => lane.lane === "lane-pane")?.closed, false, "an unreachable transport never closes its own lanes");
	await assert.rejects(service.execute({ action: "stop", lane: "lane-pane" }, context(root)), /herdr transport/, "stopping a pane lane still fails in the pane transport's own words");
}

// 36. A headless worker inherits no part of its parent's Herdr workspace.
{
	const previous = { env: process.env.HERDR_ENV, socket: process.env.HERDR_SOCKET_PATH, tab: process.env.HERDR_TAB_ID, workspace: process.env.HERDR_WORKSPACE_ID, pane: process.env.HERDR_PANE_ID };
	Object.assign(process.env, { HERDR_ENV: "1", HERDR_SOCKET_PATH: "/tmp/herdr.sock", HERDR_TAB_ID: "t1", HERDR_WORKSPACE_ID: "w0", HERDR_PANE_ID: "w0:p1" });
	try {
		const env = childEnvironment("parent-1");
		for (const key of ["HERDR_ENV", "HERDR_SOCKET_PATH", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID", "HERDR_PANE_ID"]) {
			assert.equal(env[key], undefined, `${key} describes the parent's pane, not a paneless worker`);
		}
		assert.equal(env.PI_DELEGATE_ROLE, "child", "the depth guard still reaches the child");
		assert.equal(env.PI_DELEGATE_PARENT, "parent-1");
	} finally {
		for (const [key, value] of Object.entries({ HERDR_ENV: previous.env, HERDR_SOCKET_PATH: previous.socket, HERDR_TAB_ID: previous.tab, HERDR_WORKSPACE_ID: previous.workspace, HERDR_PANE_ID: previous.pane })) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

// 37. The widget says which model a lane runs, shortened, and no id can shift the alarm columns.
{
	const plain = (text: string) => text;
	assert.equal(shortModel("openai-codex/gpt-5.6-sol:high"), "gpt-5.6-sol:high", "the provider prefix is the same on every lane, so it goes");
	assert.equal(shortModel("anthropic/claude-opus-5"), "claude-opus-5");
	assert.equal(shortModel("bedrock/global.anthropic.claude-opus-5"), "global.anthropic.claude…", "a bare dotted id keeps its own shape until it hits the limit");
	assert.equal(shortModel("global.anthropic.claude-opus-5"), "global.anthropic.claude…", "an id with no provider prefix is treated the same way");
	assert.equal(shortModel(null), "—", "a lane with no recorded model shows a dash, not the word null");
	assert.equal(shortModel(""), "—");
	assert.equal(shortModel("x".repeat(400)).length, 24, "a very long id is clipped exactly as a long lane name is");

	const view = (over: Partial<LaneView> & { lane: string }): LaneView => ({ profile: "worker", status: "working", model: "openai-codex/gpt-5.6-sol:high", contextPct: 12.5, spendUsd: 0.4, rang: false, unread: false, ...over });
	const rows = laneRows([view({ lane: "a" })]);
	assert.equal(rows[1]!.cells[3]!.text, "gpt-5.6-sol:high", "the model sits between the profile and the status");
	assert.equal(rows[1]!.cells[4]!.text, "working");

	// A model id nobody validated must not push the status or the note sideways in the other rows.
	const monstrous = `openai-codex/${"m".repeat(300)}:high`;
	const lines = renderWidget([
		view({ lane: "huge", model: monstrous }),
		view({ lane: "stuck", status: "blocked", model: "anthropic/claude-opus-5" }),
		view({ lane: "tiny", model: "x" }),
	], 200, plain);
	const rowFor = (lines: readonly string[], name: string): string => lines.find((line) => line.includes(name))!;
	const huge = rowFor(lines, "huge");
	const stuck = rowFor(lines, "stuck");
	const tiny = rowFor(lines, "tiny");
	assert.equal(stuck.indexOf("BLOCKED"), tiny.indexOf("working"), "the status column starts at the same place for a 300 character id and a 1 character one");
	assert.equal(huge.indexOf("working"), tiny.indexOf("working"), "including on the row carrying the monstrous id");
	assert.ok(stuck.includes("needs you"), "the note column is still reachable behind the longest id");
	for (const line of lines) assert.ok(line.length <= 200, "no row outgrows the terminal");
	assert.ok(huge.includes(`${"m".repeat(23)}…`), "the long id is clipped rather than wrapped");

	// The same guarantee at a realistic width: the loud parts are still the loud parts.
	const tight = renderWidget([view({ lane: "stuck", status: "blocked", model: monstrous })], 96, plain);
	assert.ok(tight[2]!.trimStart().startsWith("!"), "the attention marker still leads the row");
	for (const line of tight) assert.ok(line.length <= 96);
}

// 38. A lane this session finished with stays on screen, dimmed, below the live ones.
{
	const plain = (text: string) => text;
	const root = home();
	const delegateRoot = join(root, ".pi", "agent", "delegate");
	const dir = join(delegateRoot, "parent-1");
	mkdirSync(dir, { recursive: true });
	const transcript = (name: string, cost: number): string => {
		const path = join(dir, `${name}.jsonl`);
		writeFileSync(path, `${JSON.stringify({ message: { role: "assistant", usage: { totalTokens: 56_000, cost: { total: cost } } } })}\n`, "utf8");
		return path;
	};
	const handoff = (name: string, present: boolean): string => {
		const path = join(dir, `${name}.md`);
		if (present) writeFileSync(path, "ok\n", "utf8");
		return path;
	};
	const record = (name: string, over: Record<string, unknown>) => ({
		lane: name, profile: "worker", pane: "w0:p1", session: `s-${name}`, cwd: root,
		handoff: handoff(name, true), started: "2026-01-01T00:00:00.000Z", read: true, closed: false,
		status: "working", ownerSession: "parent-1", model: "openai-codex/gpt-5.6-sol:high", ...over,
	});
	const lanes = [
		record("scout-drift", { profile: "scout", model: "openai-codex/gpt-5.6-luna", sessionFile: transcript("scout-drift", 0.9), read: false, handoff: join(dir, "scout-drift.pending.md") }),
		// Deliberately out of order in the file, so the ordering assertion is about the sort, not the read.
		record("page-lucy", { closed: true, status: "closed", closedAt: "2026-01-03T00:00:00.000Z", read: false, sessionFile: transcript("page-lucy", 1.9) }),
		record("widget-fix", { closed: true, status: "closed", closedAt: "2026-01-01T09:00:00.000Z", sessionFile: transcript("widget-fix", 3.2) }),
		record("transport", { closed: true, status: "closed", closedAt: "2026-01-02T00:00:00.000Z", sessionFile: transcript("transport", 6.3) }),
	];
	writeFileSync(join(dir, "lanes.json"), JSON.stringify({ lanes }), "utf8");

	const memory = new ClosedLaneMemory();
	const sample = () => sampleLaneViews({ root: delegateRoot, cwd: root, parentId: "parent-1", watcher: new SessionStatsWatcher(), finished: memory, contextWindow: () => 200_000 });
	const views = await sample();
	assert.deepEqual(views.map((view) => view.lane), ["scout-drift", "widget-fix", "transport", "page-lucy"],
		"live lanes first, then finished ones oldest first, so a new finished row appends instead of shoving the others down");

	const lines = renderWidget(views, 200, plain);
	assert.equal(lines.length, 6, "a rule, a header, and one row per lane including the finished ones");
	assert.match(lines[1]!, /^delegate {2}1 live · 3 done · 1 needs you · \$12\.30$/, "the header counts live, done, what still needs the operator, and the session's whole bill");
	assert.ok(lines[2]!.includes("scout-drift") && lines[2]!.includes("28% ctx") && lines[2]!.includes("$0.90"), `the live row keeps its numbers: ${lines[2]}`);
	assert.ok(lines[3]!.includes("widget-fix") && lines[3]!.includes("done") && lines[3]!.includes("$3.20") && lines[3]!.trimEnd().endsWith("read"), `a collected lane keeps its final spend: ${lines[3]}`);
	assert.ok(!lines[3]!.includes("% ctx") && lines[3]!.includes("—"), "a finished lane's context use is history nobody can act on");
	assert.ok(lines[5]!.includes("page-lucy") && lines[5]!.trimEnd().endsWith("unread handoff"), `an uncollected handoff is still named after the lane closes: ${lines[5]}`);
	assert.equal(lines[3]!.indexOf("done"), lines[5]!.indexOf("done"), "the finished rows share the live rows' columns");

	// Tone: the finished group is quiet, except the work the operator has not collected.
	const mark = (text: string, tone: string, bold: boolean) => `<${tone}${bold ? ":bold" : ""}>${text}</>`;
	const painted = renderWidget(views, 200, mark);
	assert.ok(painted[3]!.includes("<dim>widget-fix") && painted[3]!.includes("<dim>read"), "a collected finished lane is dim throughout");
	assert.ok(!painted[3]!.includes("notice") && !painted[3]!.includes("attention"), "and borrows no loud tone");
	assert.ok(painted[5]!.includes("<notice>unread handoff") && painted[5]!.includes("<notice>•"), "an unread handoff stays loud after the lane closes");
	assert.ok(painted[2]!.includes("<text>scout-drift"), "the live row keeps the normal text tone");
	assert.ok(painted.every((line) => !line.includes("\u001b")), "every color still comes from the theme");

	// A lane whose handoff never arrived is not reported as read.
	const stoppedEarly = await sampleLaneViews({
		root: delegateRoot, cwd: root, parentId: "parent-1", watcher: new SessionStatsWatcher(), finished: new ClosedLaneMemory(),
		contextWindow: () => 200_000,
	});
	const missingHandoff = laneRows([{ ...stoppedEarly[1]!, read: false, unread: false }]);
	assert.equal(missingHandoff[1]!.cells[7]!.text, "no handoff", "a lane stopped before it wrote anything says so instead of claiming it was read");

	// The registry prunes a closed record 24 hours after it closed. This session's history survives it.
	writeFileSync(join(dir, "lanes.json"), JSON.stringify({ lanes: [lanes[0]] }), "utf8");
	const afterPrune = await sample();
	assert.deepEqual(afterPrune.map((view) => view.lane), ["scout-drift", "widget-fix", "transport", "page-lucy"], "a pruned record does not make a row disappear mid-session");
	assert.deepEqual(afterPrune.map((view) => view.spendUsd), [0.9, 3.2, 6.3, 1.9], "each remembered lane keeps its final spend");
	assert.match(renderWidget(afterPrune, 200, plain)[1]!, /1 live · 3 done · 1 needs you · \$12\.30$/, "the header still counts them");

	// Reading the handoff of a lane whose record is gone still quiets the row.
	unlinkSync(join(dir, "page-lucy.md"));
	const collected = await sample();
	assert.equal(collected.find((view) => view.lane === "page-lucy")?.unread, false, "a handoff that is no longer there is no longer waiting for anyone");
	assert.match(renderWidget(collected, 200, plain)[1]!, /^delegate {2}1 live · 3 done · \$12\.30$/, "the needs-you count clears with it");

	// Empty now means no lane at all, live or finished. A session that never delegated shows nothing.
	const quiet = home();
	assert.deepEqual(await sampleLaneViews({ root: join(quiet, ".pi", "agent", "delegate"), cwd: quiet, parentId: "parent-1", watcher: new SessionStatsWatcher(), finished: new ClosedLaneMemory() }), [], "a session with no lanes has nothing to remember");
	assert.deepEqual(renderWidget([], 80, plain), [], "and draws no widget, not even a rule");

	// A lane name reused after the first one closed keeps its own row.
	const reused = new ClosedLaneMemory();
	const first = ClosedLaneMemory.key("lane-a", "2026-01-01T00:00:00.000Z");
	const second = ClosedLaneMemory.key("lane-a", "2026-02-01T00:00:00.000Z");
	assert.notEqual(first, second, "the memory keys on the start time as well as the name");
	reused.remember(first, { lane: "lane-a", profile: "worker", status: "closed", model: null, contextPct: null, spendUsd: 1, rang: false, unread: false, read: true, finished: true }, "/tmp/a.md");
	reused.remember(second, { lane: "lane-a", profile: "worker", status: "closed", model: null, contextPct: null, spendUsd: 2, rang: false, unread: false, read: true, finished: true }, "/tmp/a.md");
	assert.equal(reused.size, 2, "a reused lane name does not overwrite the earlier lane's row");
	assert.deepEqual(reused.remember(first, { lane: "lane-a", profile: "worker", status: "closed", model: null, contextPct: null, spendUsd: null, rang: false, unread: false, read: true, finished: true }, "/tmp/a.md").spendUsd, 1, "a transcript that has gone away does not zero a remembered bill");
}

// 39. No transport parameter reaches the model, and the model parameter deliberately still does.
{
	const previousRole = process.env.PI_DELEGATE_ROLE;
	const previousHome = process.env.HOME;
	const root = home();
	let tool: { description: string; parameters: { properties: Record<string, unknown> }; execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }>; details: Record<string, unknown> }> } | undefined;
	delete process.env.PI_DELEGATE_ROLE;
	process.env.HOME = root;
	try {
		delegateExtension({
			registerTool: (spec: unknown) => { tool = spec as typeof tool; },
			on: () => {},
			exec: async () => ({ stdout: "", stderr: "", code: 0 }),
		} as never);
		assert.ok(tool);
		const properties = tool.parameters.properties;
		assert.equal(properties.transport, undefined, "the tool schema offers no transport, so a future agent cannot reach it");
		assert.ok(properties.model, "model stays in the schema: matching a model to a lane's difficulty is the orchestrator's job");
		assert.match(tool.description, /transport comes from its profile and nowhere else/, "the description says where a transport comes from");
		assert.match(tool.description, /model stays yours to choose per lane/, "and names the asymmetry rather than leaving it to be guessed");
		assert.ok(!/optional name\/cwd\/model\/handoff\/transport/.test(tool.description), "no line still advertises a transport argument");

		// Even reaching past the schema does not work: the action refuses instead of obeying.
		const refused = await tool.execute("call", { action: "start", brief: "go", name: "lane-sneak", transport: "subprocess" }, undefined, undefined, {
			hasUI: false, cwd: root, sessionManager: { getSessionId: () => "parent-1" },
		});
		assert.equal(refused.details.error, "runtime");
		assert.match(String(refused.details.message), /transport is not a per-call choice/, "the refusal says whose choice it is");
		assert.match(refused.content[0]!.text, /transport is not a per-call choice/);
		assert.equal(existsSync(registryPath(root)), false, "nothing was started behind the refusal");
	} finally {
		if (previousRole === undefined) delete process.env.PI_DELEGATE_ROLE;
		else process.env.PI_DELEGATE_ROLE = previousRole;
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
	}
}

// 40. A screen with nothing but finished rows spawns nothing at all.
{
	const root = home();
	const delegateRoot = join(root, ".pi", "agent", "delegate", "parent-1");
	mkdirSync(delegateRoot, { recursive: true });
	const handoff = join(delegateRoot, "done.md");
	writeFileSync(handoff, "READY\n", "utf8");
	writeFileSync(join(delegateRoot, "lanes.json"), JSON.stringify({ lanes: [{
		lane: "done", profile: "worker", pane: "w0:p1", session: "s", cwd: root, handoff,
		started: new Date().toISOString(), read: false, closed: true, closedAt: new Date().toISOString(),
		status: "closed", ownerSession: "parent-1", model: "openai-codex/gpt-5.6-sol:high",
	}] }), "utf8");
	const bin = join(root, "bin");
	mkdirSync(bin, { recursive: true });
	writeFileSync(join(bin, "herdr"), "#!/bin/sh\nexit 0\n", "utf8");
	chmodSync(join(bin, "herdr"), 0o755);

	const previous = { home: process.env.HOME, herdrEnv: process.env.HERDR_ENV, path: process.env.PATH, role: process.env.PI_DELEGATE_ROLE };
	const realInterval = globalThis.setInterval;
	let beat: (() => void) | undefined;
	const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
	const spawns: string[] = [];
	const widgetCalls: string[] = [];
	delete process.env.PI_DELEGATE_ROLE;
	process.env.HOME = root;
	process.env.HERDR_ENV = "1";
	process.env.PATH = `${bin}:${previous.path ?? ""}`;
	globalThis.setInterval = ((callback: () => void) => { beat = callback; return { unref() {} }; }) as never;
	try {
		delegateExtension({
			registerTool: () => {},
			on: (event: string, handler: unknown) => { handlers.set(event, handler as (event: unknown, ctx: unknown) => Promise<void>); },
			exec: async (command: string) => { spawns.push(command); return { stdout: "", stderr: "", code: 0 }; },
		} as never);
		const ctx = { hasUI: true, cwd: root, sessionManager: { getSessionId: () => "parent-1", getEntries: () => [] }, ui: { setWidget: (_key: string, value: unknown) => { widgetCalls.push(value === undefined ? "clear" : "paint"); }, notify: () => {} } };
		await handlers.get("session_start")!({}, ctx);
		assert.deepEqual(widgetCalls, ["paint"], "a lane this session finished with is still something to show");
		for (let tick = 1; tick <= 12; tick += 1) {
			beat!();
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		assert.deepEqual(spawns, [], "twelve ticks over a screen of finished rows ask no transport anything");
		assert.deepEqual(widgetCalls, ["paint"], "and repaint nothing, because nothing moved");
		await handlers.get("session_shutdown")!({}, ctx);
	} finally {
		globalThis.setInterval = realInterval;
		for (const [key, value] of Object.entries({ HOME: previous.home, HERDR_ENV: previous.herdrEnv, PATH: previous.path, PI_DELEGATE_ROLE: previous.role })) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

console.log("delegate: all checks passed");
