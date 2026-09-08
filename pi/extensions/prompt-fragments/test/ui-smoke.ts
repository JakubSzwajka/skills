import assert from "node:assert/strict";
import test from "node:test";
import type { PromptFragment } from "../fragments.ts";
import { FragmentPicker, sanitizeFragmentDisplay, type FragmentPickerResult } from "../picker.ts";

test("picker keyboard behavior and empty state", () => {
const fragments: PromptFragment[] = [
	{ filename: "three.md", title: "Three", description: "third", placement: "after", order: 0, body: "three", scope: "global" },
	{ filename: "one.md", title: "One", description: "first", placement: "before", order: 0, body: "one", scope: "global" },
	{ filename: "two.md", title: "Two", description: "second", placement: "before", order: 1, body: "two", scope: "project" },
];
let renders = 0;
const tui = { requestRender() { renders++; } } as any;
const theme = {
	fg(_color: string, text: string) { return text; },
	bg(_color: string, text: string) { return text; },
	bold(text: string) { return text; },
} as any;
let result: FragmentPickerResult | "open" = "open";
const picker = new FragmentPicker(tui, theme, fragments, (selection) => { result = selection; });
const initial = picker.render(80);
assert.ok(initial[0]?.includes("─") && initial.at(-1)?.includes("─"), "standard Pi borders frame the picker");
assert.ok(initial.some((line) => line.includes("Before (2)")), "Before section is visible");
assert.ok(initial.some((line) => line.includes("After (1)")), "After section is visible");
assert.ok(initial.some((line) => line.includes("[ ] One · global")), "rows show checkbox and scope");
picker.handleInput(" ");
picker.handleInput("\u001b[B");
picker.handleInput("\u001b[B");
picker.handleInput(" ");
picker.handleInput("\r");
assert.ok(Array.isArray(result));
assert.deepEqual(result.map((fragment) => fragment.title), ["One", "Three"], "arrows cross sections and Space toggles before Enter applies");
assert.ok(renders >= 4);

let kittyResult: FragmentPickerResult | "open" = "open";
const kittyPicker = new FragmentPicker(tui, theme, fragments, (selection) => { kittyResult = selection; });
kittyPicker.handleInput("\u001b[1;1:1B");
kittyPicker.handleInput("\u001b[1;1:3B");
kittyPicker.handleInput(" ");
kittyPicker.handleInput("\r");
assert.deepEqual(
	kittyResult.map((fragment) => fragment.title),
	["Two"],
	"a Kitty ArrowDown press and release move only one row",
);

let freshResult: FragmentPickerResult | "open" = "open";
const fresh = new FragmentPicker(tui, theme, fragments, (selection) => { freshResult = selection; });
fresh.handleInput("\r");
assert.deepEqual(freshResult, [], "each picker starts with no selections");

let cancelled: FragmentPickerResult | "open" = "open";
const cancelPicker = new FragmentPicker(tui, theme, fragments, (selection) => { cancelled = selection; });
cancelPicker.handleInput("\u001b");
assert.equal(cancelled, undefined, "Escape cancels");

const empty = new FragmentPicker(tui, theme, [], () => {});
const emptyView = empty.render(80);
assert.equal(emptyView.filter((line) => line.includes("No fragments")).length, 2, "both empty sections explain their state");

let directoryAction: FragmentPickerResult | "open" = "open";
const globalDirectoryPicker = new FragmentPicker(tui, theme, fragments, (action) => { directoryAction = action; });
globalDirectoryPicker.handleInput("n");
assert.equal(directoryAction, "open-global", "n opens the global fragment directory");
const projectDirectoryPicker = new FragmentPicker(tui, theme, fragments, (action) => { directoryAction = action; });
projectDirectoryPicker.handleInput("N");
assert.equal(directoryAction, "open-project", "Shift+n opens the project fragment directory");

const hostile: PromptFragment = {
	filename: "Fallback\rName.md",
	title: "Safe\u001b[2J\nTitle\u009b31m",
	description: "Desc\u001b]0;owned\u0007tail\tX\u0000\u0085",
	placement: "before",
	order: 0,
	body: "body keeps \u001b[2J controls",
	scope: "project",
};
let hostileSelection: PromptFragment[] | undefined;
const hostilePicker = new FragmentPicker(tui, theme, [hostile], (selection) => {
	if (Array.isArray(selection)) hostileSelection = selection;
});
const hostileView = hostilePicker.render(80).join("\n");
assert.ok(hostileView.includes("Safe Title · project — Desctail    X"));
assert.equal(/[\u001b\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(hostileView), false, "rendered metadata contains no terminal controls");
assert.equal(sanitizeFragmentDisplay("Fallback\rName\u001b[2J"), "Fallback Name", "filename-derived labels are flattened and sanitized");
hostilePicker.handleInput(" ");
hostilePicker.handleInput("\r");
assert.equal(hostileSelection?.[0]?.body, hostile.body, "display sanitization does not alter inserted bodies");
});
