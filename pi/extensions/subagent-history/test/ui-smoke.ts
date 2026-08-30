import assert from "node:assert/strict";
import { setKittyProtocolActive } from "@earendil-works/pi-tui";
import { HISTORY_OVERLAY_OPTIONS, HistoryComponent, disposeHistoryViews, openHistory } from "../history-ui.ts";
import type { HistorySnapshot } from "../types.ts";

assert.deepEqual(HISTORY_OVERLAY_OPTIONS, { overlay: true, overlayOptions: { anchor: "center", width: "90%", minWidth: 48, maxHeight: "85%", margin: 1 } }, "history opens as a centered modal overlay");

const snapshot: HistorySnapshot = {
	sessionId: "session", sessionName: "界 dashboard", scope: "branch", loadedAt: 1, warnings: [],
	workflows: [
		{ id: "workflow:one", workflowRunId: "one", goal: "界界 first", state: "complete", startedAt: 0, endedAt: 1200, attributed: true, stale: false, warnings: [], logicalChildren: [{ id: "logical:one:scan", workflowKey: "scan", lineageAvailable: true, attempts: [{ id: "attempt:child", runId: "child", state: "complete", agent: "scout", model: "provider/model", thinking: "low", context: "fresh", startedAt: 0, endedAt: 1200, durationMs: 1200, totalTokens: 42, toolCount: 3, prompt: "Inspect the tree", promptAttribution: "exact", promptNote: "Exact", nested: [] }] }, { id: "logical:one:review", workflowKey: "review", lineageAvailable: true, attempts: [{ id: "attempt:review", runId: "review", state: "complete", agent: "reviewer", startedAt: 400, endedAt: 1000, durationMs: 600, promptAttribution: "unavailable", nested: [] }] }] },
		{ id: "workflow:two", workflowRunId: "two", goal: "second", state: "complete", startedAt: 2000, endedAt: 3000, attributed: true, stale: false, warnings: [], logicalChildren: [] },
	],
};
const tui = { terminal: { rows: 20 }, requestRender() {} } as any;
const theme = { fg(_color: string, value: string) { return value; } } as any;
let closed = 0, reloads = 0;
const component = new HistoryComponent(tui, theme, snapshot, async () => { reloads++; return snapshot; }, () => { closed++; });
component.render(80);
setKittyProtocolActive(true);
component.handleInput("\u001b[106u"); // j to first chronological attempt
const timeline = component.render(80);
const scoutLine = timeline.findIndex((line) => line.includes(">  │ W1 / scan · #1 scout"));
const reviewLine = timeline.findIndex((line) => line.includes("W1 / review · #1 reviewer"));
assert.ok(scoutLine >= 0, "Kitty j selects the first attempt in the vertical timeline");
assert.ok(reviewLine > scoutLine, "later attempts render below earlier attempts");
component.handleInput("\r"); // enter opens inline summary
const inline = component.render(80);
assert.ok(inline[0]?.startsWith("╭─ Subagent history"), "the dashboard starts with a labelled frame");
assert.ok(inline.at(-1)?.startsWith("╰") && inline.at(-1)?.endsWith("╯"), "the dashboard ends with a closing frame");
assert.ok(inline.some((line) => line.startsWith("├") && line.endsWith("┤")), "header and footer separators are visible");
assert.ok(inline.some((line) => line.includes("│ State") && line.includes("complete")), "attempt details render inline beneath the tree row");
assert.ok(inline.some((line) => line.includes("╭─ summary")), "inline details have a visible start separator");
assert.ok(inline.some((line) => line.includes("╰─")), "inline details have a visible end separator");
assert.ok(inline.every((line) => /^[╭├│╰].*[╮┤│╯]$/.test(line)), "every modal line is enclosed by the outer frame");
component.handleInput("\u001b[114u"); // r
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(reloads, 1, "Kitty r refreshes");
component.handleInput("\u001b[113u"); // q
assert.equal(closed, 1, "Kitty q closes");
component.dispose(); setKittyProtocolActive(false);

let customDone: (() => void) | undefined;
let customOptions: unknown;
const manager = { getSessionId: () => "shutdown-session", getSessionFile: () => undefined, getSessionName: () => undefined, getEntries: () => [], getBranch: () => [] };
const ctx = {
	sessionManager: manager,
	ui: { custom(factory: any, options: unknown) { customOptions = options; return new Promise<void>((resolve) => { const done = () => resolve(); customDone = done; factory(tui, theme, {}, done); }); } },
} as any;
const pi = { events: { on() { return () => {}; } } } as any;
const open = openHistory(ctx, pi); await new Promise((resolve) => setTimeout(resolve, 0)); disposeHistoryViews(); await open;
assert.equal(customOptions, HISTORY_OVERLAY_OPTIONS, "openHistory passes modal overlay options to Pi");
assert.ok(customDone, "shutdown closer settled ui.custom");
console.log("UI Kitty, inline-detail, and shutdown smoke checks passed");
