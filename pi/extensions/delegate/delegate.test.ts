import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DelegateService, intercomRings, returnContract, toolPolicy, waitArguments } from "./delegate.ts";
import { mutateRegistry, readRegistry } from "./registry.ts";
import delegateExtension from "./index.ts";
import type { CommandResult, LaneRegistry } from "./types.ts";

interface Call { args: string[] }

class FakeRunner {
	readonly calls: Call[] = [];
	readonly panes: Array<Record<string, unknown>> = [];
	readonly agents: Array<Record<string, unknown>> = [];
	waitResponse: unknown = { result: { agent: { agent: "pi", pane_id: "w0:p1", name: "lane-a", agent_status: "done" } } };
	waitExitCode = 0;
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
			case "agent wait": return { stdout: JSON.stringify(this.waitResponse), stderr: "", code: this.waitExitCode };
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
		reviewer: "amazon-bedrock/global.anthropic.claude-opus-5",
		oracle: "amazon-bedrock/global.anthropic.claude-opus-5",
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

// 8. wait asks for all three terminal states and parses both response shapes.
{
	assert.deepEqual(waitArguments("lane-a", 1234), ["agent", "wait", "lane-a", "--until", "idle", "--until", "done", "--until", "blocked", "--timeout", "1234"]);

	const root = home();
	const runner = new FakeRunner();
	const service = new DelegateService(runner, root);
	await service.execute({ action: "start", brief: "x", name: "lane-a" }, context(root));

	for (const status of ["idle", "done", "blocked"]) {
		runner.waitResponse = { result: { agent: { agent: "pi", pane_id: "w0:p1", name: "lane-a", agent_status: status } } };
		const settled = await service.execute({ action: "wait", lanes: ["lane-a"], timeoutMs: 500 }, context(root));
		assert.equal(settled.timedOut, false);
		assert.equal(settled.status, status, `wait accepts ${status} as terminal`);
		assert.equal(settled.lane, "lane-a");
	}

	runner.waitResponse = { error: { code: "timeout", message: "timed out" } };
	runner.waitExitCode = 1;
	const timedOut = await service.execute({ action: "wait", timeoutMs: 500 }, context(root));
	assert.deepEqual(timedOut.timedOut, true, "the timeout JSON shape parses instead of throwing");
	assert.deepEqual(timedOut.lanes, ["lane-a"]);
	await assert.rejects(service.execute({ action: "wait", lanes: ["ghost"] }, context(root)), /Unknown live delegate lane/);
	await assert.rejects(service.execute({ action: "wait", timeoutMs: 0 }, context(root)), /positive integer/);
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
		{ sender: "01a08b53-c579-736c-84eb-1a817d671cf7", messageId: "d2e81a3f" },
		{ sender: "legacy-sender", messageId: "legacy-1" },
	], "only intercom entries with a sender count as rings");

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
	let tool: { description: string; promptGuidelines?: string[]; execute: (...args: unknown[]) => Promise<{ details: Record<string, unknown> }> } | undefined;
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

console.log("delegate: all checks passed");
