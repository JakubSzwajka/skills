import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import taskLog from "./index.ts";
import { FakeExtensionHost, temporaryRepository } from "./test-harness.ts";

const SUBAGENT_CHILD_ENV = "PI_SUBAGENT_CHILD";
const SUBAGENT_BINDINGS_ENV = "PI_SUBAGENT_EXTENSION_BINDINGS";
const TASK_BINDING_NAMESPACE = "task-log/1";
const TASK_TOOLS = ["task_manage", "task_log", "task_read"];

const toolHost = new FakeExtensionHost(false);
toolHost.activeTools = ["read", "bash"];
const toolAmbientChild = process.env[SUBAGENT_CHILD_ENV];
delete process.env[SUBAGENT_CHILD_ENV];
toolHost.load(taskLog);
if (toolAmbientChild !== undefined) process.env[SUBAGENT_CHILD_ENV] = toolAmbientChild;
const cwd = temporaryRepository();
await toolHost.emit("session_start", {}, toolHost.createContext({ cwd }));
assert.deepEqual(toolHost.activeTools, ["read", "bash", "task_manage"], "ordinary session startup preserves unrelated active tools and enables task management");

const parent = new FakeExtensionHost();
const parentContext = parent.createContext({ cwd });
await parent.invokeTool("task_manage", { action: "create", title: "Orchestrator task", description: "Owned by the parent session." }, parentContext);
const parentAttachment = parent.customEntries.at(-1)!.data as { repositoryId: string; taskId: string; pathHint: string };
assert.deepEqual(parent.activeTools, TASK_TOOLS, "an attached parent task enables all parent task tools");
await parent.invokeTool("task_log", { type: "context", text: "parent-only log entry" }, parentContext);
const parentRead = await parent.invokeTool("task_read", {}, parentContext);
assert.match(parentRead.content[0].text, /parent-only log entry/, "ordinary parent task logging and reading still work");

const launchInputs: Array<Record<string, unknown>> = [
	{ agent: "worker", task: "Foreground launch", async: false },
	{ agent: "worker", task: "Async launch", async: true },
	{
		agent: "worker",
		task: "Launch with caller bindings",
		async: true,
		extensionBindings: {
			"other.extension/1": { keep: true },
			[TASK_BINDING_NAMESPACE]: { repositoryId: "caller-value", taskId: "caller-value" },
		},
	},
	{ agent: "worker", task: "Malformed caller bindings", async: true, extensionBindings: "malformed" },
];
for (const [index, input] of launchInputs.entries()) {
	const before = structuredClone(input);
	const results = await parent.emit("tool_call", { type: "tool_call", toolName: "subagent", toolCallId: `launch-${index}`, input }, parentContext);
	assert.deepEqual(results, [undefined], "an attached parent task never blocks a subagent launch");
	assert.deepEqual(input, before, "task-log never mutates subagent launch input or extensionBindings");
}

function childHost(rawBindings: string | undefined): FakeExtensionHost {
	const originalChild = process.env[SUBAGENT_CHILD_ENV];
	const originalBindings = process.env[SUBAGENT_BINDINGS_ENV];
	process.env[SUBAGENT_CHILD_ENV] = "1";
	if (rawBindings === undefined) delete process.env[SUBAGENT_BINDINGS_ENV];
	else process.env[SUBAGENT_BINDINGS_ENV] = rawBindings;
	try {
		const host = new FakeExtensionHost(false);
		host.load(taskLog);
		return host;
	} finally {
		if (originalChild === undefined) delete process.env[SUBAGENT_CHILD_ENV];
		else process.env[SUBAGENT_CHILD_ENV] = originalChild;
		if (originalBindings === undefined) delete process.env[SUBAGENT_BINDINGS_ENV];
		else process.env[SUBAGENT_BINDINGS_ENV] = originalBindings;
	}
}

const bindingPayloads = [
	undefined,
	"not-json",
	JSON.stringify({ "other.extension/1": { keep: true } }),
	JSON.stringify({ [TASK_BINDING_NAMESPACE]: { repositoryId: parentAttachment.repositoryId, taskId: parentAttachment.taskId } }),
	JSON.stringify({ [TASK_BINDING_NAMESPACE]: { repositoryId: parentAttachment.repositoryId, taskId: parentAttachment.taskId, path: parentAttachment.pathHint } }),
];
for (const rawBindings of bindingPayloads) {
	const child = childHost(rawBindings);
	child.activeTools.push("read", "bash");
	const childContext = child.createContext({ cwd, branch: parent.customEntries });
	await child.emit("session_start", {}, childContext);
	assert.deepEqual(child.activeTools, ["read", "bash"], "subagent children expose no task tools regardless of extension binding payloads or forked attachments");
	assert.deepEqual(child.customEntries.at(-1)?.data, { taskId: null }, "a child clears a fork-inherited parent attachment");
	for (const toolName of TASK_TOOLS) {
		await assert.rejects(child.invokeTool(toolName, toolName === "task_manage" ? { action: "list" } : {}, childContext), /not active/, `${toolName} stays unavailable in a child`);
	}
}

const treeChild = childHost(JSON.stringify({ [TASK_BINDING_NAMESPACE]: {
	repositoryId: parentAttachment.repositoryId,
	taskId: parentAttachment.taskId,
} }));
const treeContext = treeChild.createContext({ cwd, branch: parent.customEntries });
await treeChild.emit("session_start", {}, treeContext);
assert.deepEqual(treeChild.activeTools, []);
await treeChild.emit("session_tree", {}, treeContext);
assert.deepEqual(treeChild.activeTools, [], "session tree changes cannot reactivate task tools in a child");

const primitiveChild = childHost(undefined);
await primitiveChild.emit("session_start", {}, primitiveChild.createContext({
	cwd,
	branch: [{ type: "custom", customType: "task-log:attachment", data: "malformed" } as any],
}));
assert.deepEqual(primitiveChild.activeTools, [], "malformed fork attachment data is ignored without enabling child task tools");

const skillPaths = [
	"skills/to-spec/SKILL.md",
	"skills/to-tickets/SKILL.md",
	"skills/implement/SKILL.md",
	"skills/handoff/SKILL.md",
	"skills/prototype/SKILL.md",
	"skills/research/SKILL.md",
];
for (const path of skillPaths) {
	const guidance = readFileSync(join(process.cwd(), path), "utf8");
	assert.match(guidance, /## Task continuity/);
	assert.match(guidance, /`task_log` is active/);
	assert.match(guidance, /structured `handoff`/);
	assert.match(guidance, /Do not copy the artifact body/);
}

export default function subagentSkillIntegrationSmoke(): void {}
