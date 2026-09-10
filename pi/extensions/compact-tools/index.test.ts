import assert from "node:assert/strict";
import test from "node:test";
import { AssistantMessageComponent, initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { patchAssistantMessages, patchToolRows } from "./patch.ts";
import { presenters } from "./presenters.ts";
import compactTools, { separate, THINKING_LABEL } from "./index.ts";

const theme = {
  fg: (_colour: string, text: string) => text,
  bold: (text: string) => text,
} as any;

function load(overrides: Record<string, unknown> = {}) {
  const tools = new Map<string, any>();
  const transformers: Array<(markdown: string, context: any) => string> = [];
  const commands: string[] = [];
  compactTools({
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerMarkdownTransformer: (fn: any) => transformers.push(fn),
    registerCommand: (name: string) => commands.push(name),
    on: (name: string, handler: any) => {
      if (name === "session_start") {
        handler({}, { ui: { theme, setHiddenThinkingLabel() {} } });
      }
    },
    ...overrides,
  } as any);
  return { tools, transformers, commands };
}

test("every built-in tool is registered with a self-rendered shell and a tone", () => {
  const { tools } = load();
  assert.deepEqual([...tools.keys()].sort(), ["bash", "edit", "find", "grep", "ls", "read", "write"]);

  for (const [name, tool] of tools) {
    assert.equal(tool.renderShell, "self", `${name} renders its own shell`);
    assert.ok(tool.description.length > 0, `${name} keeps its description`);
    assert.ok(presenters[name]!.tone, `${name} declares a tone`);
  }
  assert.deepEqual(
    Object.entries(presenters).map(([name, presenter]) => [name, presenter.tone]).sort(),
    [
      ["bash", "read"],
      ["edit", "mutate"],
      ["find", "read"],
      ["grep", "read"],
      ["ls", "read"],
      ["read", "read"],
      ["write", "mutate"],
    ],
  );
});

test("the extension registers no commands and no toggles", () => {
  assert.deepEqual(load().commands, []);
});

test("assistant prose is ruled off once it stops streaming", () => {
  assert.equal(separate("Done.", "assistant", false), "---\n\nDone.\n\n---");
  assert.equal(separate("Done.", "assistant", true), "---\n\nDone.");
  assert.equal(separate("Done.", "user", false), "Done.");
  assert.equal(separate("Done.", "assistant-thinking", false), "Done.");
  assert.equal(separate("  ", "assistant", false), "  ");

  const { transformers } = load();
  assert.equal(transformers.length, 1);
  assert.equal(
    transformers[0]!("Applying the fixes.", { messageType: "assistant", isStreaming: false }),
    "---\n\nApplying the fixes.\n\n---",
  );
});

test("the hidden thinking label wears the same gutter as a tool row", () => {
  assert.equal(THINKING_LABEL, "┊ Thinking...");

  const labels: string[] = [];
  load({
    on: (name: string, handler: any) => {
      if (name === "session_start") {
        handler({}, { ui: { theme, setHiddenThinkingLabel: (label: string) => labels.push(label) } });
      }
    },
  });
  assert.deepEqual(labels, ["┊ Thinking..."]);
});

test("the patches apply once and survive a repeat call", () => {
  const config = { theme: () => theme, owns: () => true, duration: () => undefined };
  const timing = { onStart: () => {}, onEnd: () => {} };

  assert.equal(patchToolRows(config, timing), true);
  const rowRender = ToolExecutionComponent.prototype.render;
  assert.equal(patchToolRows(config, timing), true);
  assert.equal(ToolExecutionComponent.prototype.render, rowRender);
  assert.deepEqual(rowRender.call({ hideComponent: true } as any, 80), []);

  assert.equal(patchAssistantMessages(), true);
  const proseRender = AssistantMessageComponent.prototype.render;
  assert.equal(patchAssistantMessages(), true);
  assert.equal(AssistantMessageComponent.prototype.render, proseRender);
});

test("subagent keeps its own live renderer and expanded child detail", () => {
  initTheme("dark");
  load();
  const definition = {
    renderCall: (args: { agent: string }) => new Text(`rich subagent ${args.agent}`, 0, 0),
    renderResult: (_result: unknown, options: { expanded: boolean; isPartial: boolean }) =>
      new Text(`rich ${options.isPartial ? "live async progress" : "result"}${options.expanded ? "\nexpanded child detail" : ""}`, 0, 0),
  };
  const row = new ToolExecutionComponent(
    "subagent",
    "call_subagent",
    { agent: "reviewer", async: true },
    {},
    definition,
    { requestRender() {} } as any,
    process.cwd(),
  );

  row.markExecutionStarted();
  row.setExpanded(true);
  row.updateResult({ content: [{ type: "text", text: "generic output" }], details: {}, isError: false }, true);

  const rendered = row.render(90).map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, "").trimEnd());
  assert.ok(rendered.some((line) => line.includes("rich subagent reviewer")));
  assert.ok(rendered.some((line) => line.includes("rich live async progress")));
  assert.ok(rendered.some((line) => line.includes("expanded child detail")));
  assert.ok(rendered.every((line) => !line.includes("┊ subagent")));
});

test("todo still uses the compact foreign row", () => {
  initTheme("dark");
  load();
  const definition = {
    renderCall: () => new Text("rich todo call", 0, 0),
    renderResult: () => new Text("rich todo result", 0, 0),
  };
  const row = new ToolExecutionComponent(
    "todo",
    "call_todo",
    { action: "update", id: 3, status: "completed" },
    {},
    definition,
    { requestRender() {} } as any,
    process.cwd(),
  );

  row.markExecutionStarted();
  row.updateResult({ content: [{ type: "text", text: "task 3 completed" }], details: {}, isError: false });

  const rendered = row.render(90).map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, "").trimEnd());
  assert.equal(rendered.length, 1);
  assert.match(rendered[0]!, /^ ┊ todo +update · 3 · completed +1 line/);
  assert.doesNotMatch(rendered[0]!, /rich todo/);
});

test("a real tool row, driven end to end, renders as one line with its duration", async () => {
  initTheme("dark");
  const { tools } = load();
  const definition = tools.get("ls");
  const toolCallId = "call_live|fc_live";
  const args = { path: "." };

  const row = new ToolExecutionComponent("ls", toolCallId, args, {}, definition, { requestRender() {} } as any, process.cwd());
  row.markExecutionStarted();
  row.updateResult({ ...(await definition.execute(toolCallId, args, undefined, undefined, { cwd: process.cwd() } as any)), isError: false });

  const rendered = row.render(90).map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+$/, ""));
  assert.equal(rendered.length, 1);
  assert.match(rendered[0]!, /^ ┊ ls {7}\. +\d+ entries {4}\d+\.\ds$/);
});

test("an expanded row indents its output under the gutter", async () => {
  initTheme("dark");
  const { tools } = load();
  const definition = tools.get("ls");
  const args = { path: "." };

  const row = new ToolExecutionComponent("ls", "call_expanded", args, {}, definition, { requestRender() {} } as any, process.cwd());
  row.setExpanded(true);
  row.updateResult({ ...(await definition.execute("call_expanded", args, undefined, undefined, { cwd: process.cwd() } as any)), isError: false });

  const rendered = row.render(90).map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, "").replace(/\s+$/, ""));
  assert.ok(rendered.length > 1);
  assert.ok(rendered.slice(1).every((line) => line.startsWith(" ┊ ")));
});
