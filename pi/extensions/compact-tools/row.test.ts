import assert from "node:assert/strict";
import { homedir } from "node:os";
import test from "node:test";
import { colorLine, fitLine, formatDuration, middleTruncate, plainLine, shortenPath, unit } from "./row.ts";

const probe = () => {
  const seen: string[] = [];
  const theme = {
    fg: (colour: string, text: string) => (seen.push(colour), text),
    bold: (text: string) => text,
  } as any;
  return { seen, theme };
};

test("shortenPath prefers cwd-relative, then home-relative", () => {
  assert.equal(shortenPath("/work/board/map/data/areas.yaml", "/work/board"), "map/data/areas.yaml");
  assert.equal(shortenPath(`${homedir()}/notes.md`), "~/notes.md");
  assert.equal(shortenPath("/etc/hosts", "/work/board"), "/etc/hosts");
  assert.equal(shortenPath(""), "");
});

test("formatDuration switches to minutes past a minute", () => {
  assert.equal(formatDuration(412), "0.4s");
  assert.equal(formatDuration(62_000), "1m02s");
  assert.equal(formatDuration(-1), "");
});

test("middleTruncate keeps both ends", () => {
  assert.equal(middleTruncate("short", 20), "short");
  assert.equal(middleTruncate("abcdefghij", 5), "ab…ij");
});

test("unit pluralises, and marks a truncated count as a lower bound", () => {
  assert.equal(unit(1, "line"), "1 line");
  assert.equal(unit(2, "line"), "2 lines");
  assert.equal(unit(3, "entry", { plural: "entries" }), "3 entries");
  assert.equal(unit(240, "line", { atLeast: true }), "≥240 lines");
});

test("columns line up across rows of different argument lengths", () => {
  const rows = [
    plainLine({ name: "read", args: "map/data/areas.yaml", summary: "240 lines", duration: "0.4s" }, 70),
    plainLine({ name: "$", args: "npm test", summary: "failed", duration: "12.4s", isError: true }, 70),
    plainLine({ name: "edit", args: "log/decisions.md", summary: "+12 -4", duration: "0.1s" }, 70),
  ];

  assert.deepEqual(rows.map((row) => row.length), [70, 70, 70]);
  const right = (summary: string, duration: string) => summary.padStart(11) + "  " + duration.padStart(6);
  assert.ok(rows[0]!.endsWith(right("240 lines", "0.4s")));
  assert.ok(rows[1]!.endsWith(right("failed", "12.4s")));
  assert.ok(rows[2]!.endsWith(right("+12 -4", "0.1s")));
});

test("narrow widths drop the duration first, then the summary", () => {
  const parts = { name: "read", args: "some/file.ts", summary: "240 lines", duration: "0.4s" };
  assert.ok(plainLine(parts, 70).includes("0.4s"));
  assert.ok(!plainLine(parts, 45).includes("0.4s"));
  assert.ok(plainLine(parts, 45).includes("240 lines"));
  assert.ok(!plainLine(parts, 30).includes("240 lines"));
});

test("arguments never squeeze below a readable width", () => {
  const fitted = fitLine({ name: "read", args: "a".repeat(80), summary: "240 lines", duration: "0.4s" }, 40);
  assert.ok(fitted.args.length >= 16);
});

test("an error row swaps the gutter for a cross", () => {
  assert.ok(plainLine({ name: "$", args: "npm test", isError: true }, 60).startsWith("✗ "));
  assert.ok(plainLine({ name: "$", args: "npm test" }, 60).startsWith("┊ "));
});

test("tone decides how loudly a row speaks", () => {
  const mutate = probe();
  colorLine({ name: "write", args: "a.ts", tone: "mutate", summary: "1 line" }, 70, mutate.theme);
  assert.deepEqual(mutate.seen.slice(0, 3), ["dim", "toolTitle", "accent"]);

  const read = probe();
  colorLine({ name: "$", args: "git status", tone: "read", summary: "1 line" }, 70, read.theme);
  assert.deepEqual(read.seen.slice(0, 3), ["dim", "muted", "muted"]);

  const quiet = probe();
  colorLine({ name: "todo", args: "x", tone: "quiet", summary: "ok" }, 70, quiet.theme);
  assert.deepEqual(quiet.seen.slice(0, 3), ["dim", "dim", "dim"]);

  const failed = probe();
  colorLine({ name: "$", args: "npm test", tone: "read", summary: "failed", isError: true }, 70, failed.theme);
  assert.deepEqual(failed.seen.slice(0, 3), ["error", "error", "error"]);
});
