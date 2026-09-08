import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	composePrompt,
	discoverFragments,
	parseFragment,
	type PromptFragment,
} from "../fragments.ts";

test("parser, discovery, ordering, trust, override, and composition", () => {
const parsed = parseFragment(`---\nplacement: before\ntitle: Ground rules\ndescription: Keep these in mind\norder: 2\n---\n\nUse facts.\n`, "rules.md", "global");
assert.equal(parsed.body, "Use facts.", "frontmatter is stripped from the inserted body");
assert.equal(parsed.title, "Ground rules");
assert.equal(parsed.order, 2);
assert.throws(() => parseFragment("No frontmatter", "bad.md", "global"), /placement/);
assert.throws(() => parseFragment("---\nplacement: middle\n---\nBody", "bad.md", "global"), /placement/);
assert.throws(() => parseFragment("---\nplacement: before\norder: nope\n---\nBody", "bad.md", "global"), /order/);
assert.throws(() => parseFragment("---\nplacement: [\n---\nBody", "bad.md", "global"));

const root = mkdtempSync(join(tmpdir(), "prompt-fragments-test-"));
const globalDir = join(root, "global");
const projectDir = join(root, "project");
mkdirSync(globalDir);
mkdirSync(projectDir);
const file = (dir: string, name: string, metadata: string, body: string) =>
	writeFileSync(join(dir, name), `---\n${metadata}\n---\n${body}\n`);
file(globalDir, "same.md", "placement: before\ntitle: Global same", "global body");
file(globalDir, "z.md", "placement: after\ntitle: Same title\norder: 3", "z body");
file(globalDir, "a.md", "placement: after\ntitle: Same title\norder: 3", "a body");
file(globalDir, "first.md", "placement: after\ntitle: First\norder: -1", "first body");
file(projectDir, "same.md", "placement: before\ntitle: Project same", "project body");
file(projectDir, "local.md", "placement: after\ntitle: Local", "local body");
mkdirSync(join(globalDir, "nested.md"));
file(join(globalDir, "nested.md"), "ignored.md", "placement: before", "nested body");

const trusted = discoverFragments({ globalDir, projectDir, includeProject: true });
assert.deepEqual(trusted.warnings, []);
assert.equal(trusted.fragments.find((fragment) => fragment.filename === "same.md")?.scope, "project", "project filename overrides global");
assert.equal(trusted.fragments.find((fragment) => fragment.filename === "same.md")?.body, "project body");
assert.equal(trusted.fragments.some((fragment) => fragment.filename === "ignored.md"), false, "discovery is non-recursive");
assert.deepEqual(
	trusted.fragments.filter((fragment) => fragment.placement === "after").map((fragment) => fragment.filename),
	["first.md", "local.md", "a.md", "z.md"],
	"fragments sort by order, then title, then filename",
);

const untrusted = discoverFragments({ globalDir, projectDir, includeProject: false });
assert.equal(untrusted.fragments.some((fragment) => fragment.filename === "local.md"), false, "untrusted project fragments are excluded");
assert.equal(untrusted.fragments.find((fragment) => fragment.filename === "same.md")?.scope, "global");
file(projectDir, "invalid.md", "placement: sideways", "bad body");
const withInvalid = discoverFragments({ globalDir, projectDir, includeProject: true });
assert.equal(withInvalid.fragments.some((fragment) => fragment.filename === "invalid.md"), false);
assert.ok(withInvalid.warnings.some((warning) => warning.includes("project fragment invalid.md") && warning.includes("placement")), "invalid files yield a useful warning");

const before = parseFragment("---\nplacement: before\norder: 2\n---\nBefore two", "before-2.md", "global");
const beforeFirst = parseFragment("---\nplacement: before\norder: 1\n---\nBefore one", "before-1.md", "global");
const after = parseFragment("---\nplacement: after\n---\nAfter", "after.md", "global");
assert.equal(composePrompt("Editor", [before, after, beforeFirst]), "Before one\n\nBefore two\n\nEditor\n\nAfter");
assert.equal(composePrompt("Editor\n", [after]), "Editor\n\nAfter", "existing boundary newlines stay exact without adding a dirty separator");
assert.equal(composePrompt("", [beforeFirst, after]), "Before one\n\nAfter", "empty editor does not add extra separators");
assert.equal(composePrompt("Editor\n", []), "Editor\n", "empty selection preserves editor text exactly");

const emptyBody: PromptFragment = { ...after, filename: "empty.md", title: "Empty", body: "" };
assert.equal(composePrompt("Editor", [emptyBody]), "Editor", "empty fragment bodies do not add separators");
});
