import assert from "node:assert/strict";
import test from "node:test";
import { isBlank, stripBlankEdges, stripRenderer } from "./blank-edges.ts";

test("isBlank ignores colour codes when deciding a line is empty", () => {
  assert.equal(isBlank(""), true);
  assert.equal(isBlank("\x1b[48;2;40;50;40m   \x1b[49m"), true);
  assert.equal(isBlank("\x1b[48;2;40;50;40m read \x1b[49m"), false);
});

test("stripBlankEdges removes the row spacer and box padding, keeping inner blanks", () => {
  const pad = "\x1b[48;2;40;50;40m    \x1b[49m";
  const carried = "\x1b[48;2;40;50;40m\x1b[49m";
  assert.deepEqual(stripBlankEdges(["", pad, " read a.ts", "", " line two", pad]), [
    carried + " read a.ts",
    "",
    " line two" + carried,
  ]);
  assert.deepEqual(stripBlankEdges([]), []);
  assert.deepEqual(stripBlankEdges(["", "  "]), []);
});

test("stripBlankEdges keeps escape sequences carried by a dropped blank line", () => {
  const zoneStart = "\x1b]133;A\x07";
  const zoneEnd = "\x1b]133;B\x07";
  assert.deepEqual(stripBlankEdges([zoneStart, " prose", zoneEnd + "   "]), [zoneStart + " prose" + zoneEnd]);
});

test("stripRenderer trims whatever the wrapped renderer produced", () => {
  const wrapped = stripRenderer(function (this: { lines: string[] }) {
    return this.lines;
  } as any);
  assert.deepEqual(wrapped.call({ lines: ["", " a", "", " b", "  "] } as any, 80), [" a", "", " b"]);
  assert.deepEqual(wrapped.call({ lines: "not an array" } as any, 80), "not an array" as any);
});
