import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ENCODED_LOG_HEADING, encodeEntry, encodeNewTask, type LogEntry, type TaskStatus } from "./codec.ts";
import { TASK_CONTEXT_CHARS } from "./history.ts";
import { resolveRepository } from "./repository.ts";
import { TaskService } from "./service.ts";
import { FakeExtensionHost, temporaryRepository } from "./test-harness.ts";

function writeTask(
	cwd: string,
	input: { id: string; title: string; status?: TaskStatus; description?: string; refs?: string[]; entries?: LogEntry[] },
): void {
	const repository = resolveRepository(cwd);
	mkdirSync(repository.tasksDir, { recursive: true });
	let raw = encodeNewTask(input.id, input.title, "2025-01-01T00:00:00Z", input.description ?? `${input.title} objective`);
	if (input.status && input.status !== "active") raw = raw.replace("status: active", `status: ${input.status}`);
	if (input.refs?.length) raw = raw.replace("refs: []", `refs:\n${input.refs.map((reference) => `  - ${JSON.stringify(reference)}`).join("\n")}`);
	if (input.entries?.length) raw += `${ENCODED_LOG_HEADING}\n${input.entries.map(encodeEntry).join("\n")}\n`;
	writeFileSync(join(repository.tasksDir, `${input.id}.md`), raw);
}

function entry(timestamp: string, session: string, type: string, text: string): LogEntry {
	return { timestamp, session, type, text };
}

function handoff(timestamp: string, branchOrWorktree: string, currentState: string): LogEntry {
	return {
		timestamp,
		session: "handoff-session",
		type: "handoff",
		text: "",
		handoff: {
			currentState,
			nextAction: "Continue implementation.",
			blockers: [],
			branchOrWorktree,
			latestCommit: "abc1234",
			validationState: "Focused tests pending.",
			references: ["tickets/07.md"],
		},
	};
}

const emptyRoot = temporaryRepository();
for (const status of ["waiting", "paused", "done"] as const) writeTask(emptyRoot, { id: `t-${status}`, title: status, status });
const emptyHost = new FakeExtensionHost();
const emptyContext = emptyHost.createContext({ cwd: emptyRoot });
const emptyContinue = await emptyHost.invokeTool("task_manage", { action: "continue", request: "continue lifecycle work" }, emptyContext);
assert.match(emptyContinue.content[0].text, /No relevant active repository task/);
assert.deepEqual(emptyHost.activeTools, ["task_manage"], "inactive lifecycle candidates never activate attachment tools");

const oneRoot = temporaryRepository();
writeTask(oneRoot, { id: "t-only", title: "Only active" });
const oneHost = new FakeExtensionHost();
const oneContext = oneHost.createContext({ cwd: oneRoot });
const undecidedContinue = await oneHost.invokeTool("task_manage", { action: "continue" }, oneContext);
assert.equal(undecidedContinue.details.needsRelevanceDecision, true, "agent continuation does not attach without a relevance decision");
assert.deepEqual(oneHost.activeTools, ["task_manage"]);
const oneContinue = await oneHost.invokeTool("task_manage", { action: "continue", request: "Only active objective" }, oneContext);
assert.equal(oneContinue.details.taskId, "t-only");
assert.equal(oneContinue.details.source, "selected");
assert.deepEqual(oneHost.activeTools, ["task_manage", "task_log", "task_read"]);
assert.equal(oneHost.customEntries.length, 1, "continue attaches before it returns");
const listed = await oneHost.invokeTool("task_manage", { action: "list" }, oneContext);
assert.equal(listed.details.tasks[0].id, "t-only");
await oneHost.invokeTool("task_manage", { action: "reference", referenceAction: "add", reference: "tickets/07.md" }, oneContext);
await oneHost.invokeTool("task_manage", { action: "reference", referenceAction: "edit", referenceIndex: 0, reference: "tickets/07-updated.md" }, oneContext);
await oneHost.invokeTool("task_manage", { action: "reference", referenceAction: "remove", referenceIndex: 0 }, oneContext);
await oneHost.invokeTool("task_manage", { action: "status", status: "waiting" }, oneContext);
assert.equal(new TaskService(oneRoot).getById("t-only").status, "waiting");
await oneHost.invokeTool("task_manage", { action: "detach" }, oneContext);
assert.deepEqual(oneHost.activeTools, ["task_manage"]);
const created = await oneHost.invokeTool("task_manage", { action: "create", title: "Created directly", description: "Management create action." }, oneContext);
assert.match(created.content[0].text, /Created directly/);

const activityRoot = temporaryRepository();
writeTask(activityRoot, { id: "t-older", title: "Older", entries: [entry("2025-01-01T00:00:00Z", "s1", "context", "older")] });
writeTask(activityRoot, { id: "t-newer", title: "Newer", entries: [entry("2026-01-01T00:00:00Z", "s1", "context", "newer")] });
const activityHost = new FakeExtensionHost();
const activityContext = activityHost.createContext({ cwd: activityRoot });
assert.equal((await activityHost.invokeTool("task_manage", { action: "continue", request: "objective" }, activityContext)).details.taskId, "t-newer", "activity breaks ties without an association");

const inactiveAttachmentRoot = temporaryRepository();
writeTask(inactiveAttachmentRoot, { id: "t-waiting-attached", title: "Authentication migration" });
writeTask(inactiveAttachmentRoot, { id: "t-active-fallback", title: "Billing reconciliation" });
const inactiveAttachmentHost = new FakeExtensionHost();
const inactiveAttachmentContext = inactiveAttachmentHost.createContext({ cwd: inactiveAttachmentRoot });
await inactiveAttachmentHost.invokeTool("task_manage", { action: "attach", taskId: "t-waiting-attached" }, inactiveAttachmentContext);
const externalStatusService = new TaskService(inactiveAttachmentRoot);
externalStatusService.changeStatus(externalStatusService.getById("t-waiting-attached").path, "waiting");
const inactiveFallback = await inactiveAttachmentHost.invokeTool("task_manage", {
	action: "continue",
	request: "Complete billing reconciliation",
}, inactiveAttachmentContext);
assert.equal(inactiveFallback.details.taskId, "t-active-fallback", "an externally inactivated mismatched attachment falls through to a relevant active candidate");
assert.equal(inactiveFallback.details.source, "selected");
assert.deepEqual(inactiveAttachmentHost.activeTools, ["task_manage", "task_log", "task_read"]);

const rankedRoot = temporaryRepository();
const branch = resolveRepository(rankedRoot).branch;
writeTask(rankedRoot, {
	id: "t-branch",
	title: "Branch match",
	entries: [handoff("2025-01-02T00:00:00Z", branch, "Older but associated with this branch.")],
});
writeTask(rankedRoot, {
	id: "t-recent",
	title: "Recent other branch",
	entries: [handoff("2026-01-02T00:00:00Z", "unrelated-branch", "Newer but unrelated.")],
});
const rankedHost = new FakeExtensionHost();
const rankedContext = rankedHost.createContext({ cwd: rankedRoot });
const ranked = await rankedHost.invokeTool("task_manage", { action: "continue", request: "objective" }, rankedContext);
assert.equal(ranked.details.taskId, "t-branch", "explicit current branch association outranks activity");
await rankedHost.invokeTool("task_manage", { action: "attach", taskId: "t-recent" }, rankedContext);
const manual = await rankedHost.invokeTool("task_manage", { action: "continue" }, rankedContext);
assert.equal(manual.details.taskId, "t-recent", "a current manual attachment remains authoritative");
assert.equal(manual.details.source, "attached");
const attachmentMismatch = await rankedHost.invokeTool("task_manage", { action: "continue", request: "billing invoice reconciliation" }, rankedContext);
assert.match(attachmentMismatch.content[0].text, /does not cover this request/);
assert.equal(attachmentMismatch.details.attached, true, "a relevance decline does not silently detach a manual selection");
const separate = await rankedHost.invokeTool("task_manage", {
	action: "continue",
	separate: true,
	title: "Explicit separate work",
	description: "Do not merge this request into another task.",
}, rankedContext);
assert.equal(separate.details.source, "created");
assert.notEqual(separate.details.taskId, "t-recent");

const unrelatedRoot = temporaryRepository();
writeTask(unrelatedRoot, { id: "t-auth", title: "Refresh authentication tokens", description: "Replace long-lived JWT sessions." });
const unrelatedHost = new FakeExtensionHost();
const unrelatedContext = unrelatedHost.createContext({ cwd: unrelatedRoot });
const unrelated = await unrelatedHost.invokeTool("task_manage", { action: "continue", request: "Optimize billing invoice reconciliation" }, unrelatedContext);
assert.match(unrelated.content[0].text, /No relevant active repository task/);
assert.deepEqual(unrelatedHost.activeTools, ["task_manage"], "an unrelated active task is not attached");

const historyRoot = temporaryRepository();
const historyEntries = [
	entry("2025-01-01T01:00:00Z", "s1", "decision", "alpha needle"),
	entry("2025-01-01T02:00:00Z", "s2", "context", "beta"),
	entry("2025-01-01T03:00:00Z", "s1", "context", "gamma needle"),
	entry("2025-01-01T04:00:00Z", "s2", "blocker", "delta"),
	entry("2025-01-01T05:00:00Z", "s1", "context", "epsilon"),
];
writeTask(historyRoot, {
	id: "t-history",
	title: "Searchable history",
	description: "D".repeat(4_000),
	refs: ["SPEC.md", "tickets/08.md"],
	entries: historyEntries,
});
const historyHost = new FakeExtensionHost();
const historyContext = historyHost.createContext({ cwd: historyRoot });
await historyHost.invokeTool("task_manage", { action: "attach", taskId: "t-history" }, historyContext);
const firstPage = await historyHost.invokeTool("task_read", { count: 2, maxChars: 2_000 }, historyContext);
assert.match(firstPage.content[0].text, /epsilon/);
assert.match(firstPage.content[0].text, /delta/);
assert.doesNotMatch(firstPage.content[0].text, /gamma needle/);
assert.ok(firstPage.details.nextCursor);
const secondPage = await historyHost.invokeTool("task_read", { count: 2, maxChars: 2_000, cursor: firstPage.details.nextCursor }, historyContext);
assert.match(secondPage.content[0].text, /gamma needle/);
assert.match(secondPage.content[0].text, /beta/);
assert.doesNotMatch(secondPage.content[0].text, /epsilon/);
const filtered = await historyHost.invokeTool("task_read", {
	count: 10,
	maxChars: 2_000,
	type: "context",
	session: "s1",
	text: "needle",
}, historyContext);
assert.equal(filtered.details.totalMatches, 1);
assert.match(filtered.content[0].text, /gamma needle/);
for (const params of [
	{ count: 0 }, { count: -1 }, { count: 1.5 }, { count: 201 },
	{ maxChars: 0 }, { maxChars: -1 }, { maxChars: 1.5 }, { maxChars: 20_001 },
]) {
	await assert.rejects(historyHost.invokeTool("task_read", params, historyContext), /schema validation/);
}
await assert.rejects(historyHost.invokeTool("task_read", { cursor: "not-a-cursor" }, historyContext), /Invalid task_read cursor/);
for (let maxChars = 1; maxChars <= 10; maxChars++) {
	let cursor: string | undefined;
	let pages = 0;
	do {
		const page = await historyHost.invokeTool("task_read", { count: 1, maxChars, ...(cursor ? { cursor } : {}) }, historyContext);
		assert.equal(page.details.shown, 1, `maxChars=${maxChars} consumes an entry`);
		assert.notEqual(page.details.nextCursor, cursor, `maxChars=${maxChars} advances the cursor`);
		cursor = page.details.nextCursor;
		pages++;
	} while (cursor && pages < historyEntries.length + 1);
	assert.equal(pages, historyEntries.length, `maxChars=${maxChars} reaches the end`);
}

const largeEntries = Array.from({ length: 300 }, (_, index) => entry(
	`2025-02-${String(Math.floor(index / 24) + 1).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00Z`,
	`bulk-${index % 3}`,
	"context",
	`large-${index} ${"x".repeat(1_000)}`,
));
writeTask(historyRoot, {
	id: "t-large",
	title: "Large log",
	description: "objective ".repeat(5_000),
	entries: largeEntries,
});
await historyHost.invokeTool("task_manage", { action: "attach", taskId: "t-large" }, historyContext);
await historyHost.invokeTool("task_log", { type: "context", text: "Context refresh after attachment." }, historyContext);
const bounded = await historyHost.invokeTool("task_read", { count: 200, maxChars: 500 }, historyContext);
assert.ok(bounded.content[0].text.length <= 500);
assert.equal(bounded.details.characters, bounded.content[0].text.length);
assert.equal(bounded.details.truncated, true);
assert.match(bounded.content[0].text, /omitted/);
const largeContext = (await historyHost.emit("context", { messages: [{ role: "user", content: "continue" }] }, historyContext))[0] as { messages: any[] };
const largeContextMessage = largeContext.messages.find((message) => message.customType === "task-log:context");
assert.ok(largeContextMessage.content.length <= TASK_CONTEXT_CHARS, "hundreds of oversized entries stay inside the provider context budget");
assert.match(largeContextMessage.content, /changes omitted/);

const contextRoot = temporaryRepository();
writeTask(contextRoot, {
	id: "t-context",
	title: "Fresh provider context",
	description: "Compact objective.",
	refs: ["SPEC.md", "tickets/09.md"],
	entries: [
		handoff("2025-03-01T01:00:00Z", resolveRepository(contextRoot).branch, "Initial handoff state."),
		entry("2025-03-01T02:00:00Z", "s1", "decision", "Decision after handoff."),
	],
});
const contextHost = new FakeExtensionHost();
const contextCtx = contextHost.createContext({ cwd: contextRoot });
const attachedResult = await contextHost.invokeTool("task_manage", { action: "attach", taskId: "t-context" }, contextCtx);
const repeatedAttach = await contextHost.invokeTool("task_manage", { action: "attach", taskId: "t-context" }, contextCtx);
assert.equal(repeatedAttach.details.unchanged, true);
assert.doesNotMatch(repeatedAttach.content[0].text, /Initial handoff state/, "unchanged management calls do not repeat compact state");
const legacyMessage = { role: "custom", customType: "task-log", content: "OLD FULL RAW LOG", display: true, timestamp: 1 };
const unrelatedMessage = { role: "custom", customType: "other-extension", content: "Keep this provider context.", display: false, timestamp: 2 };
const managementMessages = [
	{ role: "system", content: "system" },
	{ role: "toolResult", content: attachedResult.content },
	legacyMessage,
	unrelatedMessage,
	{ role: "user", content: "current request" },
];
const afterManagement = (await contextHost.emit("context", { messages: managementMessages }, contextCtx))[0] as { messages: any[] };
assert.equal(afterManagement.messages.some((message) => message.customType === "task-log:context"), false, "management state is not duplicated by provider context");
assert.ok(afterManagement.messages.includes(managementMessages[1]), "the persisted management result is retained");
assert.equal(afterManagement.messages.some((message) => message.customType === "task-log"), false);

const providerHost = new FakeExtensionHost();
const providerCtx = providerHost.createContext({ cwd: contextRoot, branch: contextHost.customEntries });
await providerHost.emit("session_start", {}, providerCtx);
const baseMessages = [
	{ role: "system", content: "system" },
	{ role: "user", content: "older user" },
	legacyMessage,
	unrelatedMessage,
	{ role: "assistant", content: "answer" },
	{ role: "user", content: "current request" },
];
const firstContext = (await providerHost.emit("context", { messages: baseMessages }, providerCtx))[0] as { messages: any[] };
const markerIndex = firstContext.messages.findIndex((message) => message.customType === "task-log:context");
assert.equal(markerIndex, firstContext.messages.length - 2, "task state is immediately before the latest user request");
assert.match(firstContext.messages[markerIndex].content, /Initial handoff state/);
assert.match(firstContext.messages[markerIndex].content, /Decision after handoff/);
assert.match(firstContext.messages[markerIndex].content, /tickets\/09\.md/);
assert.ok(firstContext.messages[markerIndex].content.length <= TASK_CONTEXT_CHARS);
assert.equal(firstContext.messages.some((message) => message.customType === "task-log"), false);
assert.ok(firstContext.messages.includes(unrelatedMessage));
assert.equal(firstContext.messages[markerIndex].display, false);
const firstTaskMessage = firstContext.messages[markerIndex];
const repeatedContextResult = await providerHost.emit("context", { messages: firstContext.messages }, providerCtx);
assert.equal(repeatedContextResult[0], undefined, "an unchanged provider message is retained without rebuilding context");
assert.equal(firstContext.messages[markerIndex], firstTaskMessage, "unchanged task context keeps object identity and timestamp");

const externalService = new TaskService(contextRoot);
const externalTask = externalService.getById("t-context");
externalService.append(externalTask.path, { type: "context", text: "External session refresh.", session: "external" });
const refreshedContext = (await providerHost.emit("context", { messages: firstContext.messages }, providerCtx))[0] as { messages: any[] };
const refreshed = refreshedContext.messages.find((message) => message.customType === "task-log:context");
assert.match(refreshed.content, /External session refresh/);
assert.notEqual(refreshed, firstTaskMessage, "disk changes replace the provider-only snapshot");
assert.ok(refreshed.content.length <= TASK_CONTEXT_CHARS);
assert.equal(providerHost.contextMessages.length, 0);

const oversizedHandoffRoot = temporaryRepository();
writeTask(oversizedHandoffRoot, {
	id: "t-oversized-handoff",
	title: "Oversized structured handoff",
	entries: [{
		timestamp: "2025-04-01T00:00:00Z",
		session: "oversized",
		type: "handoff",
		text: "",
		handoff: {
			currentState: `CURRENT-${"c".repeat(4_000)}`,
			nextAction: `NEXT-${"n".repeat(4_000)}`,
			blockers: [`BLOCKER-${"b".repeat(4_000)}`],
			branchOrWorktree: `BRANCH-${"w".repeat(4_000)}`,
			latestCommit: `COMMIT-${"m".repeat(4_000)}`,
			validationState: `VALIDATION-${"v".repeat(4_000)}`,
			references: [`REFERENCE-${"r".repeat(4_000)}`],
		},
	}],
});
const oversizedHandoffHost = new FakeExtensionHost();
const oversizedHandoffContext = oversizedHandoffHost.createContext({ cwd: oversizedHandoffRoot });
await oversizedHandoffHost.invokeTool("task_manage", { action: "attach", taskId: "t-oversized-handoff" }, oversizedHandoffContext);
await oversizedHandoffHost.invokeTool("task_log", { type: "context", text: "Refresh oversized context." }, oversizedHandoffContext);
const oversizedPayload = (await oversizedHandoffHost.emit("context", { messages: [{ role: "user", content: "continue" }] }, oversizedHandoffContext))[0] as { messages: any[] };
const oversizedMessage = oversizedPayload.messages.find((message) => message.customType === "task-log:context");
for (const required of [
	"Current state: CURRENT-",
	"Next action: NEXT-",
	"Blockers: BLOCKER-",
	"Branch/worktree: BRANCH-",
	"Latest commit: COMMIT-",
	"Validation: VALIDATION-",
	"References: REFERENCE-",
]) assert.match(oversizedMessage.content, new RegExp(required), `${required} remains represented`);
assert.ok(oversizedMessage.content.length <= TASK_CONTEXT_CHARS);

export default function continuationHistoryContextSmoke(): void {}
