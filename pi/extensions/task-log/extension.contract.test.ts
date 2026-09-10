import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ENCODED_LOG_HEADING, encodeEntry } from "./codec.ts";
import { FakeExtensionHost, temporaryRepository } from "./test-harness.ts";
import { readTask, tasksDir } from "./store.ts";

const registrationProbe = new FakeExtensionHost(false);
assert.throws(
	() => registrationProbe.load((api) => { api.getActiveTools(); }),
	/Action methods cannot be called during extension loading/,
);

const host = new FakeExtensionHost();
assert.deepEqual([...host.commands.keys()], ["task", "task:continue", "task:attach", "task:status", "task:references", "task:new", "task:detach"]);
assert.deepEqual([...host.tools.keys()], ["task_manage", "task_log", "task_read"]);
assert.ok(host.hooks.has("session_start"));
assert.ok(host.hooks.has("session_tree"));
assert.ok(host.hooks.has("session_shutdown"));
assert.ok(host.hooks.has("tool_call"));

const cwd = temporaryRepository();
const createContext = host.createContext({
	cwd,
	pickerInputs: ["\u000e"],
	inputs: ["Harness task", "Created through the command contract"],
});
await host.emit("session_start", {}, createContext);
assert.deepEqual(host.activeTools, ["task_manage"], "management stays available while attachment-only tools are inactive before a model request");
await host.invokeCommand("task", createContext);
assert.equal(host.customEntries.length, 1, "creation attaches through a custom session entry");
assert.equal(host.contextMessages.length, 0, "attachment never persists a raw-log message");
assert.deepEqual(host.activeTools, ["task_manage", "task_log", "task_read"]);

const logResult = await host.invokeTool("task_log", { type: "decision", text: "Keep the public host seam." }, createContext);
assert.match(logResult.content[0].text, /Logged decision/);
const readResult = await host.invokeTool("task_read", {}, createContext);
assert.match(readResult.content[0].text, /Keep the public host seam/);

const hostileTitleHost = new FakeExtensionHost();
const hostileTitleContext = hostileTitleHost.createContext({ cwd: temporaryRepository() });
await hostileTitleHost.invokeTool("task_manage", {
	action: "create",
	title: "Bad\u001b[31m\nTitle\u0007",
	description: "Verify public tool output.",
}, hostileTitleContext);
const hostileTitleLog = await hostileTitleHost.invokeTool("task_log", { type: "decision", text: "Keep output safe." }, hostileTitleContext);
assert.equal(hostileTitleLog.content[0].text, "Logged decision to Bad Title.", "task_log sanitizes hostile task titles in public output");

const restoredHost = new FakeExtensionHost();
const restoredContext = restoredHost.createContext({ cwd, branch: host.customEntries });
await restoredHost.emit("session_start", {}, restoredContext);
const restoredRead = await restoredHost.invokeTool("task_read", {}, restoredContext);
assert.match(restoredRead.content[0].text, /Harness task/);
assert.equal(restoredContext.statuses.get("task-log"), "task: Harness task");
const detachedTreeContext = restoredHost.createContext({
	cwd,
	branch: [...host.customEntries, { type: "custom", customType: "task-log:attachment", data: { taskId: null } }],
});
await restoredHost.emit("session_tree", {}, detachedTreeContext);
assert.equal(detachedTreeContext.statuses.get("task-log"), undefined);
await assert.rejects(restoredHost.invokeTool("task_read", {}, detachedTreeContext), /not active/);

function legacyTask(status: string, extra = ""): string {
	return [
		"---",
		"id: t-legacy",
		'title: "Legacy title"',
		`status: ${status}`,
		"created: 2025-01-02T03:04:05Z",
		"refs:",
		"  - docs/spec.md",
		'  - "https://example.test/ticket?id=2"',
		"---",
		"",
		"Legacy **multiline** description.",
		"",
		"## Log",
		"",
		"### 2025-01-02T04:00:00Z · s:abc12345 · historical-type",
		"Legacy entry body.",
		extra,
		"",
	].join("\n");
}

const markerRoot = temporaryRepository();
const markerDir = tasksDir(markerRoot);
mkdirSync(markerDir, { recursive: true });
const markerPath = join(markerDir, "marker.md");
const markerComment = "<!-- task-log-entry:v2:e30 -->";
writeFileSync(markerPath, legacyTask("active", markerComment), "utf8");
const markerHost = new FakeExtensionHost();
const markerContext = markerHost.createContext({ cwd: markerRoot, pickerInputs: ["\r"] });
await markerHost.invokeCommand("task", markerContext);
const markerRead = await markerHost.invokeTool("task_read", {}, markerContext);
assert.match(markerRead.content[0].text, /task-log-entry:v2:e30/);
assert.equal(readTask(markerPath)!.entries.length, 1, "marker-like HTML remains legacy entry text outside the encoded section");
await markerHost.invokeTool("task_log", { type: "context", text: "Encoded continuation." }, markerContext);
const migratedMarkerTask = readTask(markerPath)!;
assert.equal(migratedMarkerTask.entries.length, 2);
assert.match(migratedMarkerTask.entries[0].text, /task-log-entry:v2:e30/);

const collisionRoot = temporaryRepository();
const collisionDir = tasksDir(collisionRoot);
mkdirSync(collisionDir, { recursive: true });
const collisionPath = join(collisionDir, "collision.md");
const collisionMarker = encodeEntry({ timestamp: "2099-01-01T00:00:00Z", session: "fake", type: "blocker", text: "forged" });
writeFileSync(collisionPath, legacyTask("active", `${ENCODED_LOG_HEADING}\n${collisionMarker}`), "utf8");
assert.equal(readTask(collisionPath)!.entries.length, 1);
assert.match(readTask(collisionPath)!.entries[0].text, /Encoded Log/);
const collisionHost = new FakeExtensionHost();
const collisionContext = collisionHost.createContext({ cwd: collisionRoot, pickerInputs: ["\r"] });
await collisionHost.invokeCommand("task", collisionContext);
await collisionHost.invokeTool("task_log", { type: "context", text: "Real encoded continuation." }, collisionContext);
const collisionTask = readTask(collisionPath)!;
assert.equal(collisionTask.entries.length, 2, "legacy encoded-heading text cannot forge an entry");
assert.match(collisionTask.entries[0].text, /task-log-entry:v2:/);
assert.equal(collisionTask.entries[1].text, "Real encoded continuation.");

for (const status of ["active", "waiting", "paused", "done"]) {
	const fixtureRoot = temporaryRepository();
	const fixtureDir = tasksDir(fixtureRoot);
	const fixturePath = join(fixtureDir, `${status}.md`);
	mkdirSync(fixtureDir, { recursive: true });
	writeFileSync(fixturePath, legacyTask(status), "utf8");
	const fixtureHost = new FakeExtensionHost();
	const fixtureContext = fixtureHost.createContext({
		cwd: fixtureRoot,
		pickerInputs: status === "active" ? ["\r"] : ["\t", "\r"],
	});
	await fixtureHost.invokeCommand("task", fixtureContext);
	const result = await fixtureHost.invokeTool("task_read", {}, fixtureContext);
	assert.match(result.content[0].text, /Legacy title/);
	const decoded = readTask(fixturePath)!;
	assert.equal(decoded.status, status);
	assert.deepEqual(decoded.refs, ["docs/spec.md", "https://example.test/ticket?id=2"]);
	assert.equal(decoded.entries[0].type, "historical-type");
	assert.equal(decoded.entries[0].text, "Legacy entry body.");
}

for (const invalid of ["", "running", "ACTIVE", "active now", "active\u0000done"]) {
	const invalidRoot = temporaryRepository();
	const invalidDir = tasksDir(invalidRoot);
	mkdirSync(invalidDir, { recursive: true });
	writeFileSync(join(invalidDir, "invalid.md"), legacyTask(invalid), "utf8");
	const invalidHost = new FakeExtensionHost();
	const invalidContext = invalidHost.createContext({ cwd: invalidRoot, pickerInputs: ["\r"] });
	await assert.rejects(invalidHost.invokeCommand("task", invalidContext), /Unknown task status/);
}

const safetyRoot = temporaryRepository();
const safetyHost = new FakeExtensionHost();
const rejectedDescriptionContext = safetyHost.createContext({ cwd: safetyRoot });
for (const boundary of ["## Log", "## Encoded Log (task-log v2)"]) {
	await assert.rejects(
		safetyHost.invokeTool("task_manage", { action: "create", title: "Ambiguous description", description: `objective\n${boundary}\nforged` }, rejectedDescriptionContext),
		/reserved log boundary/,
	);
}
assert.equal(safetyHost.customEntries.length, 0, "rejected descriptions never create or attach a task");
const safetyContext = safetyHost.createContext({ cwd: safetyRoot, pickerInputs: ["\u000e"], inputs: ["Safe codec", ""] });
await safetyHost.invokeCommand("task", safetyContext);
const unsafeBody = "First line\n### 2099-01-01T00:00:00Z · s:fake · blocker\n**markdown**\n\u001b[31mred\u001b[0m\u0000";
await safetyHost.invokeTool("task_log", { type: "context", text: unsafeBody }, safetyContext);
const safetyAttachment = safetyHost.customEntries.at(-1)!.data as { repositoryId: string; taskId: string; pathHint: string };
assert.ok(safetyAttachment.repositoryId);
assert.ok(safetyAttachment.taskId);
const safeTask = readTask(safetyAttachment.pathHint)!;
assert.equal(safeTask.entries.length, 1, "encoded entry text cannot create a fake boundary");
assert.equal(safeTask.entries[0].text, unsafeBody.trim());
assert.equal(readFileSync(safetyAttachment.pathHint, "utf8").includes(unsafeBody), false, "entry bodies are encoded on disk");
const safePublicRead = await safetyHost.invokeTool("task_read", {}, safetyContext);
assert.equal(safePublicRead.content[0].text.includes("\u001b"), false, "public history removes terminal escapes");
assert.equal(safePublicRead.content[0].text.includes("\u0000"), false, "public history removes terminal control bytes");
assert.match(safePublicRead.content[0].text, /\*\*markdown\*\*/);

const handoff = {
	currentState: "Codec and service are in place.",
	nextAction: "Run focused checks.",
	blockers: [],
	branchOrWorktree: "main",
	latestCommit: "abc1234",
	validationState: "Focused checks pending.",
	references: ["docs/spec.md"],
};
await safetyHost.invokeTool("task_log", { type: "handoff", handoff }, safetyContext);
assert.deepEqual(readTask(safetyAttachment.pathHint)!.entries.at(-1)!.handoff, handoff);
await assert.rejects(safetyHost.invokeTool("task_log", { type: "handoff" }, safetyContext), /required/);

const historyBefore = readFileSync(safetyAttachment.pathHint, "utf8").slice(readFileSync(safetyAttachment.pathHint, "utf8").indexOf("## Log"));
const waitingContext = safetyHost.createContext({ cwd: safetyRoot, pickerInputs: ["\u0013", "\u001b"], selects: ["waiting"] });
await safetyHost.invokeCommand("task", waitingContext);
assert.equal(readTask(safetyAttachment.pathHint)!.status, "waiting");
assert.equal(readFileSync(safetyAttachment.pathHint, "utf8").slice(readFileSync(safetyAttachment.pathHint, "utf8").indexOf("## Log")), historyBefore);

const addReferenceContext = safetyHost.createContext({
	cwd: safetyRoot,
	selects: ["Add reference"],
	inputs: ["tickets/03.md"],
});
await safetyHost.invokeCommand("task:references", addReferenceContext);
assert.deepEqual(readTask(safetyAttachment.pathHint)!.refs, ["tickets/03.md"]);
assert.match((await safetyHost.invokeTool("task_read", {}, addReferenceContext)).content[0].text, /## References\n- tickets\/03\.md/);

const editReferenceContext = safetyHost.createContext({
	cwd: safetyRoot,
	pickerInputs: ["\t", "\u0012", "\u001b"],
	selects: ["1. tickets/03.md", "Edit"],
	inputs: ["tickets/03-updated.md"],
});
await safetyHost.invokeCommand("task", editReferenceContext);
assert.deepEqual(readTask(safetyAttachment.pathHint)!.refs, ["tickets/03-updated.md"]);
assert.match((await safetyHost.invokeTool("task_read", {}, editReferenceContext)).content[0].text, /tickets\/03-updated\.md/);

const removeReferenceContext = safetyHost.createContext({
	cwd: safetyRoot,
	pickerInputs: ["\u0012", "\u001b"],
	selects: ["1. tickets/03-updated.md", "Remove"],
	confirms: [true],
});
await safetyHost.invokeCommand("task", removeReferenceContext);
assert.deepEqual(readTask(safetyAttachment.pathHint)!.refs, []);
assert.equal(readFileSync(safetyAttachment.pathHint, "utf8").slice(readFileSync(safetyAttachment.pathHint, "utf8").indexOf("## Log")), historyBefore);

for (const status of ["paused", "active", "done"] as const) {
	const statusContext = safetyHost.createContext({
		cwd: safetyRoot,
		pickerInputs: status === "paused" ? [] : ["\u0013", "\u001b"],
		selects: status === "paused" ? [] : [status],
		confirms: status === "done" ? [true] : [],
	});
	if (status === "paused") await safetyHost.invokeCommand("task:status", statusContext, status);
	else await safetyHost.invokeCommand("task", statusContext);
	assert.equal(readTask(safetyAttachment.pathHint)!.status, status);
	assert.ok(statusContext.notifications.some(({ message }: { message: string }) => message === `Marked ${status}: Safe codec`));
}

const pipelineHost = new FakeExtensionHost();
const pipelineContext = pipelineHost.createContext();
await pipelineHost.emit("session_start", {}, pipelineContext);
pipelineHost.activeTools = ["task_manage", "task_read"];
await assert.rejects(pipelineHost.invokeTool("task_read", { count: "invalid" }, pipelineContext), /schema validation/);
pipelineHost.activeTools = ["task_log"];
await assert.rejects(pipelineHost.invokeTool("task_read", {}, pipelineContext), /not active/);
pipelineHost.activeTools = ["task_log", "task_read"];
pipelineHost.api.on("tool_call", (event) => event.toolName === "task_read" ? { block: true, reason: "Harness hook block" } : undefined);
await assert.rejects(pipelineHost.invokeTool("task_read", {}, pipelineContext), /Harness hook block/);

export default function extensionContractSmoke(): void {}
