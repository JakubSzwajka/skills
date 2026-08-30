import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "history-home-"));
process.env.HOME = home;
const { collectHistory, sourceMatchesSession } = await import("../collector.ts");
const { ledgerPath, upsertSource } = await import("../ledger.ts");

type Entry = Record<string, any>;
class Manager {
	private entries: Entry[]; private branch: Entry[]; private file?: string;
	constructor(entries: Entry[], branch: Entry[], file?: string) { this.entries = entries; this.branch = branch; this.file = file; }
	getSessionId() { return "session-id"; }
	getSessionFile() { return this.file; }
	getSessionName() { return "Fixture session"; }
	getEntries() { return this.entries; }
	getBranch() { return this.branch; }
}
function call(id: string, parentId = "launch") { return { type: "message", id: parentId, parentId: null, timestamp: "x", message: { role: "assistant", content: [{ type: "toolCall", id, name: "subagent", arguments: {} }] } }; }
function result(id: string, runId: string, asyncDir: string) { return { type: "message", id: `result-${runId}`, parentId: "launch", timestamp: "x", message: { role: "toolResult", toolCallId: id, toolName: "subagent", content: [], details: { runId, asyncDir } } }; }
function fixture(owner: string) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "history-run-")); const sessions = path.join(root, "sessions"); const runZero = path.join(sessions, "run-0"); fs.mkdirSync(runZero, { recursive: true });
	const child = path.join(runZero, "session.jsonl"); fs.writeFileSync(child, ["{bad", JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "Fixture task" }] } }), JSON.stringify({ type: "message", message: { role: "assistant", model: "provider/model", content: [{ type: "text", text: "done" }], usage: { totalTokens: 77, cost: { total: 0.07 } } } })].join("\n"));
	const status = { lifecycleArtifactVersion: 3, runId: "run-1", sessionId: owner, toolCallId: "tool-1", mode: "workflow", state: "running", startedAt: 1000, sessionRoot: sessions, totalTokens: { total: 321 }, steps: [{ agent: "worker", workflowKey: "lane", runId: "child-1", status: "running", context: "fresh", sessionFile: child, tokens: { total: 123 }, totalCost: { costUsd: 0.12 }, toolCount: 2, turnCount: 1 }] };
	fs.writeFileSync(path.join(root, "status.json"), JSON.stringify(status));
	return { root, child };
}

test("active branch association, exact prompt, and unknown root cost", () => {
	const parent = path.join(home, "parent.jsonl"); fs.writeFileSync(parent, ""); const fx = fixture(parent);
	const entries = [call("tool-1"), result("tool-1", "run-1", fx.root), call("abandoned", "old")];
	const snapshot = collectHistory({ sessionManager: new Manager(entries, entries.slice(0, 2), parent) as any, scope: "branch", now: 2000 });
	assert.equal(snapshot.workflows.length, 1); const workflow = snapshot.workflows[0]; assert.equal(workflow.totalTokens, 321); assert.equal(workflow.totalCostUsd, undefined);
	const attempt = workflow.logicalChildren[0].attempts[0]; assert.equal(attempt.prompt, "Fixture task"); assert.equal(attempt.promptAttribution, "exact"); assert.equal(attempt.costUsd, 0.12);
	fs.rmSync(fx.root, { recursive: true, force: true });
});

test("whole session includes abandoned and unattributed but branch excludes them", () => {
	const fx1 = fixture("session-id"); const fx2 = fixture("session-id");
	const status2 = JSON.parse(fs.readFileSync(path.join(fx2.root, "status.json"), "utf8")); status2.runId = "run-2"; status2.toolCallId = "tool-2"; fs.writeFileSync(path.join(fx2.root, "status.json"), JSON.stringify(status2));
	const all = [call("tool-1"), result("tool-1", "run-1", fx1.root), call("tool-2", "old"), result("tool-2", "run-2", fx2.root)]; const branch = all.slice(0, 2); const manager = new Manager(all, branch);
	assert.equal(collectHistory({ sessionManager: manager as any, scope: "branch" }).workflows.length, 1);
	assert.equal(collectHistory({ sessionManager: manager as any, scope: "session" }).workflows.length, 2);
	fs.rmSync(fx1.root, { recursive: true, force: true }); fs.rmSync(fx2.root, { recursive: true, force: true });
});

test("started-event ledger source attaches through authoritative status before tool result", () => {
	const fx = fixture("session-id"); upsertSource("session-id", undefined, { workflowRunId: "run-1", asyncDir: fx.root, observedAt: Date.now() });
	const snapshot = collectHistory({ sessionManager: new Manager([call("tool-1")], [call("tool-1")]) as any, scope: "branch" });
	assert.equal(snapshot.workflows.length, 1); assert.equal(snapshot.workflows[0].parentToolCallId, "tool-1");
	fs.rmSync(fx.root, { recursive: true, force: true });
});

test("foreign owner is excluded and missing status preserves parent evidence", () => {
	const foreign = fixture("another-session"); const missing = fs.mkdtempSync(path.join(os.tmpdir(), "history-missing-"));
	const entries = [call("tool-1"), result("tool-1", "run-1", foreign.root), call("tool-x", "x"), result("tool-x", "run-x", missing)];
	const snapshot = collectHistory({ sessionManager: new Manager(entries, entries) as any, scope: "branch" });
	assert.deepEqual(snapshot.workflows.map((workflow) => workflow.workflowRunId), ["run-x"]); assert.equal(snapshot.workflows[0].state, "unknown"); assert.equal(snapshot.workflows[0].stale, true);
	fs.rmSync(foreign.root, { recursive: true, force: true }); fs.rmSync(missing, { recursive: true, force: true });
});

test("unchanged polling snapshots do not rewrite the compact ledger", () => {
	const fx = fixture("session-id"); const entries = [call("tool-1"), result("tool-1", "run-1", fx.root)]; const manager = new Manager(entries, entries);
	collectHistory({ sessionManager: manager as any, scope: "branch", now: 10 }); const before = fs.readFileSync(ledgerPath("session-id"), "utf8");
	collectHistory({ sessionManager: manager as any, scope: "branch", now: 20 }); const after = fs.readFileSync(ledgerPath("session-id"), "utf8");
	assert.equal(after, before);
	fs.rmSync(fx.root, { recursive: true, force: true });
});

test("corrupt ledger is warned and rebuilt from valid parent evidence", () => {
	const file = ledgerPath("session-id"); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "{corrupt");
	const fx = fixture("session-id"); const entries = [call("tool-1"), result("tool-1", "run-1", fx.root)];
	const snapshot = collectHistory({ sessionManager: new Manager(entries, entries) as any, scope: "branch" });
	assert.equal(snapshot.workflows.length, 1); assert.ok(snapshot.warnings.some((warning) => warning.kind === "ledger")); assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, "utf8")));
	fs.rmSync(fx.root, { recursive: true, force: true });
});

test("receipt lineage deduplicates resumed run ids and normalizes completed", () => {
	const fx = fixture("session-id"); const status = JSON.parse(fs.readFileSync(path.join(fx.root, "status.json"), "utf8"));
	status.state = "complete"; status.steps = [{ agent: "worker", workflowKey: "lane", runId: "child-2", status: "completed" }]; fs.writeFileSync(path.join(fx.root, "status.json"), JSON.stringify(status));
	fs.writeFileSync(path.join(fx.root, "workflow-receipt.json"), JSON.stringify({ version: 1, workflowRunId: "run-1", state: "complete", createdAt: 2, entries: { lane: { key: "lane", latestRunId: "child-2", continuation: { runIds: ["child-1", "child-1", "child-2"] }, resumability: { state: "not-resumable", reason: "done" } } } }));
	const entries = [call("tool-1"), result("tool-1", "run-1", fx.root)]; const child = collectHistory({ sessionManager: new Manager(entries, entries) as any, scope: "branch" }).workflows[0].logicalChildren[0];
	assert.deepEqual(child.attempts.map((attempt) => attempt.runId), ["child-1", "child-2"]); assert.equal(child.attempts[1].state, "complete");
	fs.rmSync(fx.root, { recursive: true, force: true });
});

test("producer-shaped receipt supplies context, output and session usage without workflow.value inference", () => {
	const fx = fixture("session-id"); const statusPath = path.join(fx.root, "status.json"); const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
	delete status.steps[0].context; delete status.steps[0].tokens; delete status.steps[0].totalCost; status.state = "complete"; status.steps[0].status = "completed"; status.workflow = { value: ["not child output"] };
	fs.writeFileSync(statusPath, JSON.stringify(status)); const output = path.join(fx.root, "child-output.md"); fs.writeFileSync(output, "authoritative output");
	fs.writeFileSync(path.join(fx.root, "workflow-receipt.json"), JSON.stringify({ version: 1, workflowRunId: "run-1", state: "complete", createdAt: 2, entries: { lane: { key: "lane", latestRunId: "child-1", resolvedContext: "fresh", outputReference: output, continuation: { runIds: ["child-1"] }, resumability: { state: "not-resumable", reason: "done" } } } }));
	const entries = [call("tool-1"), result("tool-1", "run-1", fx.root)]; const attempt = collectHistory({ sessionManager: new Manager(entries, entries) as any, scope: "branch" }).workflows[0].logicalChildren[0].attempts[0];
	assert.equal(attempt.promptAttribution, "exact"); assert.equal(attempt.prompt, "Fixture task"); assert.equal(attempt.outputPath, output); assert.equal("outputPreview" in attempt, false); assert.equal(attempt.totalTokens, 77); assert.equal(attempt.costUsd, 0.07);
	fs.rmSync(fx.root, { recursive: true, force: true });
});

test("resumed lineage retains prior attempt details from the ledger", () => {
	const fx = fixture("session-id"); const statusPath = path.join(fx.root, "status.json"); const entries = [call("tool-1"), result("tool-1", "run-1", fx.root)]; const manager = new Manager(entries, entries);
	let status = JSON.parse(fs.readFileSync(statusPath, "utf8")); status.state = "complete"; status.steps[0].status = "completed"; status.steps[0].model = "old-model"; fs.writeFileSync(statusPath, JSON.stringify(status));
	fs.writeFileSync(path.join(fx.root, "workflow-receipt.json"), JSON.stringify({ version: 1, workflowRunId: "run-1", state: "complete", createdAt: 2, entries: { lane: { key: "lane", latestRunId: "child-1", continuation: { runIds: ["child-1"] }, resumability: { state: "not-resumable", reason: "done" } } } })); collectHistory({ sessionManager: manager as any, scope: "branch" });
	status = JSON.parse(fs.readFileSync(statusPath, "utf8")); status.steps = [{ agent: "worker", workflowKey: "lane", runId: "child-2", status: "completed", model: "new-model" }]; fs.writeFileSync(statusPath, JSON.stringify(status));
	fs.writeFileSync(path.join(fx.root, "workflow-receipt.json"), JSON.stringify({ version: 1, workflowRunId: "run-1", state: "complete", createdAt: 3, entries: { lane: { key: "lane", latestRunId: "child-2", continuation: { runIds: ["child-1", "child-2"] }, resumability: { state: "not-resumable", reason: "done" } } } }));
	const attempts = collectHistory({ sessionManager: manager as any, scope: "branch" }).workflows[0].logicalChildren[0].attempts;
	assert.equal(attempts[0].model, "provider/model"); assert.equal(attempts[0].totalTokens, 123); assert.equal(attempts[1].model, "new-model");
	fs.rmSync(fx.root, { recursive: true, force: true });
});

test("events attach to attempts with attention overlay and nested steps are projected", () => {
	const fx = fixture("session-id"); const statusPath = path.join(fx.root, "status.json"); const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
	status.error = "workflow reason"; status.steps[0].error = "step reason"; status.steps[0].children = [{ id: "nested-root", state: "complete", steps: [{ agent: "scout", runId: "nested-child", status: "completed", error: "nested reason" }] }]; fs.writeFileSync(statusPath, JSON.stringify(status));
	fs.writeFileSync(path.join(fx.root, "events.jsonl"), [JSON.stringify({ ts: 5, runId: "run-1", stepIndex: 0, type: "subagent.attention", reason: "needs review" }), "{bad", JSON.stringify({ ts: 6, runId: "run-1", stepIndex: 0, type: "subagent.step.completed" })].join("\n"));
	const entries = [call("tool-1"), result("tool-1", "run-1", fx.root)]; const workflow = collectHistory({ sessionManager: new Manager(entries, entries) as any, scope: "branch" }).workflows[0]; const attempt = workflow.logicalChildren[0].attempts[0];
	assert.equal(workflow.error, "workflow reason"); assert.equal(attempt.error, "step reason"); assert.equal(attempt.attention, true); assert.deepEqual(attempt.activities?.map((event) => event.type), ["subagent.attention", "subagent.step.completed"]); assert.equal(attempt.nested[0].nested[0].runId, "nested-child"); assert.equal(attempt.nested[0].nested[0].error, "nested reason");
	fs.rmSync(fx.root, { recursive: true, force: true });
});

test("ownerless source requires authoritative current-session status", () => {
	const owned = fixture("session-id"); const foreign = fixture("other-session");
	assert.equal(sourceMatchesSession({ workflowRunId: "run-1", asyncDir: owned.root, observedAt: 1 }, "session-id"), true);
	assert.equal(sourceMatchesSession({ workflowRunId: "run-1", asyncDir: foreign.root, observedAt: 1 }, "session-id"), false);
	fs.rmSync(owned.root, { recursive: true, force: true }); fs.rmSync(foreign.root, { recursive: true, force: true });
});

test("valid JSON ledger with missing nested fields degrades without crashing", () => {
	const file = ledgerPath("session-id"); fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify({ version: 1, sessionId: "session-id", updatedAt: 1, sources: [{ workflowRunId: "old", observedAt: 1 }], workflows: [{ workflowRunId: "old", logicalChildren: [{ id: "logical:old:x", workflowKey: "x", attempts: [{ id: "attempt:x" }] }] }] }));
	const snapshot = collectHistory({ sessionManager: new Manager([], []) as any, scope: "session" }); assert.equal(snapshot.workflows.length, 1); assert.deepEqual(snapshot.workflows[0].warnings.length > 0, true); assert.equal(snapshot.workflows[0].logicalChildren[0].attempts[0].nested.length, 0);
});

test.after(() => fs.rmSync(home, { recursive: true, force: true }));
