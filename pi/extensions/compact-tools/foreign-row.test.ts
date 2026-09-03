import assert from "node:assert/strict";
import test from "node:test";
import { describeArgs, renderForeignRow } from "./foreign-row.ts";

const theme = {
  fg: (_colour: string, text: string) => text,
  bold: (text: string) => text,
} as any;

const config = { theme: () => theme, owns: (name: string) => name === "read", duration: () => "0.2s" };
const plain = (lines: string[]) => lines.map((line) => line.replace(/\s+$/, ""));

test("describeArgs skims a foreign tool's arguments in a readable order", () => {
  assert.equal(describeArgs({ id: 3, status: "completed", action: "update" }), "update · 3 · completed");
  assert.equal(describeArgs({ agent: "reviewer", async: true, dryRun: false }), "reviewer · async");
  assert.equal(describeArgs({ path: "/work/board/log/decisions.md" }, "/work/board"), "log/decisions.md");
  assert.equal(describeArgs({ nested: { a: 1 } }), "");
  assert.equal(describeArgs(undefined), "");
});

test("a foreign tool row is rendered as our grid row", () => {
  const lines = plain(
    renderForeignRow(
      {
        toolName: "todo",
        toolCallId: "t1",
        args: { action: "update", id: 3, status: "completed" },
        cwd: "/work/board",
        executionStarted: true,
        result: { content: [{ type: "text" }], isError: false },
        getTextOutput: () => "task 3 completed",
      },
      72,
      config,
    )!,
  );

  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /^ ┊ todo {5}update · 3 · completed {2,}1 line {4}0\.2s$/);
});

test("a foreign row that failed is marked, and an expanded one shows its output", () => {
  const failed = renderForeignRow(
    {
      toolName: "task_log",
      args: { type: "next" },
      result: { content: [], isError: true },
      getTextOutput: () => "no task",
    },
    72,
    config,
  )!;
  assert.match(failed[0]!, /^ ✗ task_log +next +failed/);

  const expanded = plain(
    renderForeignRow(
      {
        toolName: "subagent",
        args: { agent: "reviewer" },
        expanded: true,
        result: { content: [], isError: false },
        getTextOutput: () => "line one\nline two",
      },
      72,
      config,
    )!,
  );
  assert.equal(expanded.length, 3);
  assert.match(expanded[1]!, /^ ┊ line one$/);
});

test("a row still running says so and carries no duration", () => {
  const running = renderForeignRow({ toolName: "todo", args: { action: "create" }, executionStarted: true }, 72, config)!;
  assert.match(running[0]!, /running\s*$/);
});

test("rows we own, image results, and hidden rows fall back to the original renderer", () => {
  assert.equal(renderForeignRow({ toolName: "read", args: {} }, 72, config), undefined);
  assert.equal(renderForeignRow({ toolName: "todo", args: {}, hideComponent: true }, 72, config), undefined);
  assert.equal(
    renderForeignRow({ toolName: "todo", args: {}, result: { content: [{ type: "image" }] } }, 72, config),
    undefined,
  );
  assert.equal(renderForeignRow({ toolName: "todo", args: {} }, 72, { ...config, theme: () => undefined }), undefined);
});
