import assert from "node:assert/strict";
import { homedir } from "node:os";
import test from "node:test";
import { condenseCommand, splitCommands } from "./command.ts";

test("splitCommands ignores separators inside quotes", () => {
  assert.deepEqual(splitCommands("cd /tmp && ls"), ["cd /tmp", "ls"]);
  assert.deepEqual(splitCommands("node -e 'a; b' && echo ok"), ["node -e 'a; b'", "echo ok"]);
  assert.deepEqual(splitCommands("a; b || c"), ["a", "b", "c"]);
  assert.deepEqual(splitCommands(""), []);
});

test("condenseCommand drops the leading cd and counts the rest of the chain", () => {
  assert.equal(
    condenseCommand("cd /work/board && npm run typecheck && npm test 2>&1 | tail -20", "/work/board"),
    "npm run typecheck + 1 more",
  );
  assert.equal(condenseCommand("git status --short"), "git status --short");
  assert.equal(condenseCommand("cd /work/board", "/work/board"), "cd /work/board");
});

test("condenseCommand shortens absolute paths inside the command it shows", () => {
  assert.equal(condenseCommand(`sed -n '1,5p' ${homedir()}/notes.md`), "sed -n '1,5p' ~/notes.md");
});
