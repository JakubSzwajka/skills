import assert from "node:assert/strict";
import { homedir } from "node:os";
import test from "node:test";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import {
  describeArgs,
  isBlank,
  patchAssistantMessages,
  patchToolRows,
  renderForeignRow,
  stripBlankEdges,
  stripRenderer,
} from "./transcript.ts";
import compactTools, {
  THINKING_LABEL,
  condenseCommand,
  formatDuration,
  middleTruncate,
  plainLine,
  separate,
  shortenPath,
  splitCommands,
  trackEnd,
  trackStart,
} from "./index.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
} as any;

function registerTools() {
  const tools = new Map<string, any>();
  const events = new Map<string, (event: any) => void>();
  const transformers: Array<(markdown: string, context: any) => string> = [];
  compactTools({
    registerTool: (tool: any) => tools.set(tool.name, tool),
    on: (name: string, handler: (event: any) => void) => events.set(name, handler),
    registerMarkdownTransformer: (fn: any) => transformers.push(fn),
  } as any);
  return { tools, events, transformers };
}

function renderContext(overrides: Record<string, unknown> = {}) {
  return {
    args: {},
    toolCallId: "call-1",
    lastComponent: undefined,
    state: {} as { line?: any },
    cwd: "/work/board",
    isPartial: false,
    expanded: false,
    isError: false,
    ...overrides,
  } as any;
}

function renderRow(tool: any, args: any, result: any, context: any, width = 72) {
  const call = tool.renderCall(args, theme, { ...context, args });
  context.state.line = call;
  const body = tool.renderResult(
    result,
    { expanded: context.expanded, isPartial: context.isPartial },
    theme,
    { ...context, args },
  );
  return [...call.render(width), ...body.render(width)].map((line: string) => line.replace(/\s+$/, ""));
}

test("registers every built-in tool with a self-rendered shell", () => {
  const { tools } = registerTools();
  for (const name of ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
    const tool = tools.get(name);
    assert.ok(tool, `${name} is registered`);
    assert.equal(tool.renderShell, "self");
    assert.equal(typeof tool.renderCall, "function");
    assert.equal(typeof tool.renderResult, "function");
    assert.ok(tool.description.length > 0, `${name} keeps its description`);
  }
});

test("registers no commands and no toggles", () => {
  const calls: string[] = [];
  compactTools({
    registerTool: () => {},
    on: () => {},
    registerMarkdownTransformer: () => {},
    registerCommand: (name: string) => calls.push(name),
  } as any);
  assert.deepEqual(calls, []);
});

test("the tool row patch applies once and survives a repeat call", () => {
  const config = { theme: () => theme, owns: () => true, duration: () => undefined };
  assert.equal(patchToolRows(config), true);
  const patched = ToolExecutionComponent.prototype.render;
  assert.equal(patchToolRows(config), true);
  assert.equal(ToolExecutionComponent.prototype.render, patched);
  assert.deepEqual(patched.call({ hideComponent: true } as any, 80), []);
});

test("isBlank ignores colour codes when deciding a line is empty", () => {
  assert.equal(isBlank(""), true);
  assert.equal(isBlank("\x1b[48;2;40;50;40m   \x1b[49m"), true);
  assert.equal(isBlank("\x1b[48;2;40;50;40m read \x1b[49m"), false);
});

test("stripBlankEdges removes the row spacer and box padding, keeping inner blanks", () => {
  const pad = "\x1b[48;2;40;50;40m    \x1b[49m";
  const carried = "\x1b[48;2;40;50;40m\x1b[49m";
  const row = ["", pad, " read a.ts", "", " line two", pad];
  assert.deepEqual(stripBlankEdges(row), [carried + " read a.ts", "", " line two" + carried]);
  assert.deepEqual(stripBlankEdges([]), []);
  assert.deepEqual(stripBlankEdges(["", "  "]), []);
});

test("shortenPath prefers cwd-relative, then home-relative", () => {
  assert.equal(shortenPath("/work/board/map/data/areas.yaml", "/work/board"), "map/data/areas.yaml");
  assert.equal(shortenPath(`${homedir()}/notes.md`), "~/notes.md");
  assert.equal(shortenPath("/etc/hosts", "/work/board"), "/etc/hosts");
});

test("formatDuration switches to minutes past a minute", () => {
  assert.equal(formatDuration(412), "0.4s");
  assert.equal(formatDuration(62_000), "1m02s");
});

test("middleTruncate keeps both ends", () => {
  assert.equal(middleTruncate("short", 20), "short");
  assert.equal(middleTruncate("abcdefghij", 5), "ab…ij");
});

test("splitCommands ignores separators inside quotes", () => {
  assert.deepEqual(splitCommands("cd /tmp && ls"), ["cd /tmp", "ls"]);
  assert.deepEqual(splitCommands("node -e 'a; b' && echo ok"), ["node -e 'a; b'", "echo ok"]);
  assert.deepEqual(splitCommands("a; b || c"), ["a", "b", "c"]);
});

test("condenseCommand drops the leading cd and counts the rest of the chain", () => {
  assert.equal(
    condenseCommand("cd /work/board && npm run typecheck && npm test 2>&1 | tail -20", "/work/board"),
    "npm run typecheck + 1 more",
  );
  assert.equal(condenseCommand("git status --short"), "git status --short");
  assert.equal(condenseCommand(`sed -n '1,5p' ${homedir()}/notes.md`), "sed -n '1,5p' ~/notes.md");
});

test("a finished row is one line with right-aligned summary and duration", () => {
  const { tools } = registerTools();
  const lines = renderRow(
    tools.get("read"),
    { path: "/work/board/map/data/areas.yaml" },
    { content: [{ type: "text", text: "a\nb\nc\n" }], details: {} },
    renderContext(),
  );

  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /^ ┊ read {5}map\/data\/areas\.yaml {2,}3 lines$/);
});

test("columns line up across rows of different argument lengths", () => {
  const rows = [
    plainLine({ name: "read", args: "map/data/areas.yaml", summary: "240 lines", duration: "0.4s" }, 70),
    plainLine({ name: "$", args: "npm test", summary: "failed", duration: "12.4s", isError: true }, 70),
    plainLine({ name: "edit", args: "log/decisions.md", summary: "+12 -4", duration: "0.1s" }, 70),
  ];

  assert.deepEqual(rows.map((row) => row.length), [70, 70, 70]);

  const rightBlock = (summary: string, duration: string) => summary.padStart(11) + "  " + duration.padStart(6);
  assert.ok(rows[0]!.endsWith(rightBlock("240 lines", "0.4s")));
  assert.ok(rows[1]!.endsWith(rightBlock("failed", "12.4s")));
  assert.ok(rows[2]!.endsWith(rightBlock("+12 -4", "0.1s")));
});

test("narrow widths drop the duration first, then the summary", () => {
  const parts = { name: "read", args: "some/file.ts", summary: "240 lines", duration: "0.4s" };
  assert.ok(plainLine(parts, 70).includes("0.4s"));
  assert.ok(!plainLine(parts, 45).includes("0.4s"));
  assert.ok(plainLine(parts, 45).includes("240 lines"));
  assert.ok(!plainLine(parts, 30).includes("240 lines"));
});

test("an error row swaps the gutter for a cross", () => {
  const { tools } = registerTools();
  const context = renderContext({ isError: true, args: { command: "npm test" } });
  const lines = renderRow(
    tools.get("bash"),
    context.args,
    { content: [{ type: "text", text: "1 failing" }], details: {} },
    context,
  );

  assert.match(lines[0]!, /^ ✗ \$ +npm test +failed/);
  assert.ok(!lines[0]!.includes("┊"));
});

test("a streaming row reads as running and carries no duration", () => {
  const { tools } = registerTools();
  const context = renderContext({ isPartial: true, args: { command: "npm run build" } });
  const lines = renderRow(
    tools.get("bash"),
    context.args,
    { content: [{ type: "text", text: "building" }], details: {} },
    context,
  );

  assert.match(lines[0]!, /running$/);
});

test("expanded output is indented under the gutter", () => {
  const { tools } = registerTools();
  const lines = renderRow(
    tools.get("bash"),
    { command: "git status --short" },
    { content: [{ type: "text", text: "M index.ts\nM README.md" }], details: {} },
    renderContext({ expanded: true }),
  );

  assert.equal(lines.length, 3);
  assert.match(lines[1]!, /^ ┊ M index\.ts$/);
});

test("truncated results are marked as a lower bound", () => {
  const { tools } = registerTools();
  const lines = renderRow(
    tools.get("grep"),
    { pattern: "board" },
    { content: [{ type: "text", text: "a\nb\n" }], details: { truncation: { truncated: true } } },
    renderContext(),
  );

  assert.match(lines[0]!, /≥2 hits$/);
});

test("duration comes from execution events, not only from the wrapped execute", () => {
  const { tools, events } = registerTools();
  events.get("tool_execution_start")!({ toolCallId: "evented" });
  trackStart("evented");
  trackEnd("evented");
  events.get("tool_execution_end")!({ toolCallId: "evented" });

  const lines = renderRow(
    tools.get("ls"),
    { path: "." },
    { content: [{ type: "text", text: "index.ts\n" }], details: {} },
    renderContext({ toolCallId: "evented" }),
  );

  assert.match(lines[0]!, /\d+\.\ds$/);
});

test("describeArgs skims a foreign tool's arguments in a readable order", () => {
  assert.equal(describeArgs({ id: 3, status: "completed", action: "update" }), "update · 3 · completed");
  assert.equal(describeArgs({ agent: "reviewer", async: true, dryRun: false }), "reviewer · async");
  assert.equal(describeArgs({ path: "/work/board/log/decisions.md" }, "/work/board"), "log/decisions.md");
  assert.equal(describeArgs({ nested: { a: 1 } }), "");
  assert.equal(describeArgs(undefined), "");
});

test("a foreign tool row is rendered as our grid row", () => {
  const config = { theme: () => theme, owns: (name: string) => name === "read", duration: () => "0.2s" };
  const row = {
    toolName: "todo",
    toolCallId: "t1",
    args: { action: "update", id: 3, status: "completed" },
    cwd: "/work/board",
    expanded: false,
    executionStarted: true,
    result: { content: [{ type: "text" }], isError: false },
    getTextOutput: () => "task 3 completed",
  };

  const lines = renderForeignRow(row, 72, config)!.map((line: string) => line.replace(/\s+$/, ""));
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /^ ┊ todo {5}update · 3 · completed {2,}1 line {4}0\.2s$/);
});

test("a foreign row that failed is marked, and an expanded one shows its output", () => {
  const config = { theme: () => theme, owns: () => false, duration: () => undefined };
  const failed = renderForeignRow(
    { toolName: "task_log", args: { type: "next" }, result: { content: [], isError: true }, getTextOutput: () => "no task" },
    72,
    config,
  )!;
  assert.match(failed[0]!, /^ ✗ task_log +next +failed/);

  const expanded = renderForeignRow(
    {
      toolName: "subagent",
      args: { agent: "reviewer" },
      expanded: true,
      result: { content: [], isError: false },
      getTextOutput: () => "line one\nline two",
    },
    72,
    config,
  )!.map((line: string) => line.replace(/\s+$/, ""));
  assert.equal(expanded.length, 3);
  assert.match(expanded[1]!, /^ ┊ line one$/);
});

test("rows we own, image results, and hidden rows fall back to the original renderer", () => {
  const config = { theme: () => theme, owns: (name: string) => name === "read", duration: () => undefined };
  assert.equal(renderForeignRow({ toolName: "read", args: {} }, 72, config), undefined);
  assert.equal(renderForeignRow({ toolName: "todo", args: {}, hideComponent: true }, 72, config), undefined);
  assert.equal(
    renderForeignRow({ toolName: "todo", args: {}, result: { content: [{ type: "image" }] } }, 72, config),
    undefined,
  );
  assert.equal(
    renderForeignRow({ toolName: "todo", args: {} }, 72, { ...config, theme: () => undefined }),
    undefined,
  );
});

test("separate rules off assistant prose, and leaves everything else alone", () => {
  assert.equal(separate("Done.", "assistant", false), "---\n\nDone.\n\n---");
  assert.equal(separate("Done.", "assistant", true), "---\n\nDone.");
  assert.equal(separate("Done.", "user", false), "Done.");
  assert.equal(separate("Done.", "assistant-thinking", false), "Done.");
  assert.equal(separate("  ", "assistant", false), "  ");
});

test("the markdown transformer registered by the extension is the separator", () => {
  const { transformers } = registerTools();
  assert.equal(transformers.length, 1);
  assert.equal(
    transformers[0]!("Now I'll apply the fixes.", { messageType: "assistant", isStreaming: false }),
    "---\n\nNow I'll apply the fixes.\n\n---",
  );
});

test("stripBlankEdges keeps escape sequences carried by a dropped blank line", () => {
  const zoneStart = "\x1b]133;A\x07";
  const zoneEnd = "\x1b]133;B\x07";
  const stripped = stripBlankEdges([zoneStart, " prose", zoneEnd + "   "]);
  assert.deepEqual(stripped, [zoneStart + " prose" + zoneEnd]);
  assert.equal(isBlank(zoneStart), true);
});

test("stripRenderer trims whatever the wrapped renderer produced", () => {
  const wrapped = stripRenderer(function (this: { lines: string[] }) {
    return this.lines;
  } as any);
  assert.deepEqual(wrapped.call({ lines: ["", " a", "", " b", "  "] } as any, 80), [" a", "", " b"]);
  assert.deepEqual(wrapped.call({ lines: "not an array" } as any, 80), "not an array" as any);
});

test("assistant messages are patched once so a hidden thinking run sits flush", () => {
  assert.equal(patchAssistantMessages(), true);
  const patched = AssistantMessageComponent.prototype.render;
  assert.equal(patchAssistantMessages(), true);
  assert.equal(AssistantMessageComponent.prototype.render, patched);
});

test("the hidden thinking label wears the same gutter as a tool row", () => {
  assert.equal(THINKING_LABEL, "┊ Thinking...");

  const labels: string[] = [];
  compactTools({
    registerTool: () => {},
    registerMarkdownTransformer: () => {},
    on: (name: string, handler: any) => {
      if (name === "session_start") {
        handler({}, { ui: { theme, setHiddenThinkingLabel: (label: string) => labels.push(label) } });
      }
    },
  } as any);

  assert.deepEqual(labels, ["┊ Thinking..."]);
});
