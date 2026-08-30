import assert from "node:assert/strict";
import test from "node:test";
import { aggregate, attemptSummary, fit, formatCost, formatDuration, sanitizeDisplayText, visibleRows, wrap } from "../render.ts";
import type { HistorySnapshot } from "../types.ts";

const snapshot: HistorySnapshot = { sessionId: "s", scope: "branch", loadedAt: 0, warnings: [], workflows: [{ id: "workflow:w", workflowRunId: "w", state: "complete", attributed: true, stale: false, totalTokens: undefined, totalCostUsd: undefined, warnings: [], logicalChildren: [{ id: "logical:w:k", workflowKey: "k", lineageAvailable: true, attempts: [{ id: "attempt:a", runId: "a", state: "complete", promptAttribution: "unavailable", nested: [] }] }] }] };

test("tree expansion and aggregates preserve unknown totals", () => {
	const rows = visibleRows(snapshot, new Set(["workflow:w"])); assert.deepEqual(rows.map((row) => row.kind), ["workflow", "attempt"]);
	assert.deepEqual(aggregate(snapshot), { workflows: 1, logical: 1, attempts: 1, tokens: undefined, cost: undefined, active: 0, failed: 0 });
	assert.equal(formatCost(undefined), "—"); assert.equal(formatDuration(undefined), "—");
});

test("artifact terminal controls are removed and failure reasons render", () => {
	const hostile = "safe\u001b[2J\u001b]0;owned\u0007text\u0000"; assert.equal(sanitizeDisplayText(hostile), "safetext"); assert.equal(fit(hostile, 80), "safetext");
	assert.equal(fit("line one\nline two\rlone\u0085c1", 80), "line one line two lonec1");
	assert.deepEqual(wrap("line one\r\nline two\rlone\u0085c1", 80), ["line one", "line two", "lonec1"]);
	assert.ok(attemptSummary({ id: "a", state: "failed", error: "boom", attention: true, promptAttribution: "unavailable", nested: [] }).some((line) => line === "Error        boom"));
	const failed = structuredClone(snapshot); failed.workflows[0].error = "root failure"; assert.match(visibleRows(failed, new Set()).at(0)?.label ?? "", /root failure/);
});

test("history rows form one vertical chronological sequence", () => {
	const attempt = (id: string, startedAt?: number) => ({ id, state: "complete" as const, startedAt, promptAttribution: "unavailable" as const, nested: [] });
	const timed: HistorySnapshot = { sessionId: "s", scope: "branch", loadedAt: 0, warnings: [], workflows: [
		{ id: "workflow:new", workflowRunId: "new", goal: "new", state: "complete", startedAt: 100, attributed: true, stale: false, warnings: [], logicalChildren: [{ id: "logical:new:k", workflowKey: "review", lineageAvailable: true, attempts: [attempt("new-child", 120)] }] },
		{ id: "workflow:old", workflowRunId: "old", goal: "old", state: "complete", startedAt: 0, attributed: true, stale: false, warnings: [], logicalChildren: [{ id: "logical:old:k", workflowKey: "scan", lineageAvailable: true, attempts: [attempt("old-late", 80), attempt("old-early", 20)] }] },
	] };
	const rows = visibleRows(timed, new Set(["workflow:new", "workflow:old"]));
	assert.deepEqual(rows.map((row) => row.id), ["workflow:old", "old-early", "old-late", "workflow:new", "new-child"]);
	assert.deepEqual(rows.map((row) => row.label), ["W1  old", "W1 / scan · #2 attempt", "W1 / scan · #1 attempt", "W2  new", "W2 / review · #1 attempt"]);
});

test("render helpers fit all acceptance widths", () => {
	for (const width of [1, 12, 23, 24, 39, 40, 59, 60, 80, 120]) {
		for (const line of wrap("wide 界 text ".repeat(30), width, 200)) {
			const visible = [...fit(line, width)].reduce((sum, char) => sum + ((char.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1), 0);
			assert.ok(visible <= width, `${visible} > ${width}`);
		}
	}
});
