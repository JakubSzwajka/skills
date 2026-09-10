import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { countBoxes, formatProgressLine, formatTally, parseDependencies, readProgress, readTickets, type TicketState } from "../progress.ts";

const root = mkdtempSync(join(tmpdir(), "spec-progress-"));
const issues = join(root, "issues");
mkdirSync(issues, { recursive: true });

const ticket = (name: string, body: string): string => {
	const path = join(issues, name);
	writeFileSync(path, body, "utf8");
	return path;
};

test("a box is ticked with [x] or [X], and only at the start of a list item", () => {
	assert.deepEqual(countBoxes("- [ ] one\n- [x] two\n- [X] three\n"), { boxes: 3, ticked: 2 });
	// Other bullet markers and legal indentation still count.
	assert.deepEqual(countBoxes("* [x] star\n+ [ ] plus\n   - [x] indented\n"), { boxes: 3, ticked: 2 });
	// Not a list item, so not a checkbox.
	assert.deepEqual(countBoxes("The flag [x] appears in prose.\n[x] no bullet\n- text then [x]\n"), { boxes: 0, ticked: 0 });
	// Inline code is an example of a box, not a box.
	assert.deepEqual(countBoxes("- `[x]` marks a ticked criterion\n- [ ] real one\n"), { boxes: 1, ticked: 0 });
	// A box needs a space after it, so `[x]y` is not a claim.
	assert.deepEqual(countBoxes("- [x]nospace\n"), { boxes: 0, ticked: 0 });
	assert.deepEqual(countBoxes(""), { boxes: 0, ticked: 0 });
});

test("a [x] inside a code fence is documentation, not a claim", () => {
	const body = [
		"# 03 — Something",
		"",
		"**What to build:** the template it writes is:",
		"",
		"```md",
		"- [x] Acceptance criterion 1",
		"- [x] Acceptance criterion 2",
		"```",
		"",
		"- [x] Real, ticked",
		"- [ ] Real, open",
		"",
		"~~~",
		"- [x] tilde fenced too",
		"~~~",
		"",
		"- [ ] Real, open again",
		"",
	].join("\n");
	assert.deepEqual(countBoxes(body), { boxes: 3, ticked: 1 });
	// An unterminated fence swallows the rest, which is what a Markdown reader does too.
	assert.deepEqual(countBoxes("```\n- [x] never closed\n"), { boxes: 0, ticked: 0 });
});

test("dependencies are the leading numbers on the Blocked by line, and the prose is ignored", () => {
	assert.deepEqual(parseDependencies("**Blocked by:** 01 — Build the extension contract harness.\n"), [1]);
	// Semicolons are what `/to-tickets` writes; commas appear too.
	assert.deepEqual(parseDependencies("**Blocked by:** 02 — Harden the codec; 04 — Resolve repository identity.\n"), [2, 4]);
	assert.deepEqual(parseDependencies("**Blocked by:** 06 — a, 07 — b, 08 — c\n"), [6, 7, 8]);
	// Titles carrying their own numbers must not become dependencies.
	assert.deepEqual(parseDependencies("**Blocked by:** 03 — Manage lifecycle through `/task` v2 for 9 callers.\n"), [3]);
	assert.deepEqual(parseDependencies("**Blocked by:** None — can start immediately.\n"), []);
	assert.deepEqual(parseDependencies("**Blocked by:** none\n"), []);
	assert.deepEqual(parseDependencies("# 01 — A ticket with no such line\n\n- [ ] x\n"), []);
	// Tolerated spellings: no colon inside the bold, a bulleted list on one line.
	assert.deepEqual(parseDependencies("**Blocked by** 05 — x\n"), [5]);
	assert.deepEqual(parseDependencies("**Blocked by:** - 05; - 06\n"), [5, 6]);
	// A fenced example is not this ticket's graph.
	assert.deepEqual(parseDependencies("```\n**Blocked by:** 99 — example\n```\n\n**Blocked by:** 02 — real\n"), [2]);
});

const stateOf = (progress: ReturnType<typeof readProgress>, label: string): TicketState =>
	progress.tickets.find((entry) => entry.label === label)!.state;

test("the five states are derived from boxes and the graph, and the written Status line is ignored", () => {
	const body = (blockedBy: string, boxes: string[]): string =>
		["# A ticket", "", "**What to build:** something.", "", `**Blocked by:** ${blockedBy}`, "", "**Status:** ready-for-agent", "", ...boxes, ""].join("\n");

	const files = [
		ticket("01-first.md", body("None — can start immediately.", ["- [x] a", "- [x] b"])),
		ticket("02-second.md", body("01 — First.", ["- [x] a", "- [ ] b"])),
		ticket("03-third.md", body("02 — Second.", ["- [ ] a", "- [ ] b"])),
		ticket("04-fourth.md", body("01 — First.", ["- [ ] a"])),
		ticket("05-no-boxes.md", body("01 — First.", ["Prose only, nobody wrote criteria."])),
		// A ticket whose written status claims completion while every box is open.
		ticket("06-lying-status.md", ["# 06 — Lying", "", "**Blocked by:** 01 — First.", "", "**Status:** done", "", "- [ ] a", ""].join("\n")),
	];

	const progress = readProgress(files);
	assert.equal(stateOf(progress, "01"), "done");
	assert.equal(stateOf(progress, "02"), "started");
	// 03 depends on 02, which is only started, so 03 waits.
	assert.equal(stateOf(progress, "03"), "blocked");
	assert.equal(stateOf(progress, "04"), "ready");
	// Zero boxes cannot be "done" by vacuous truth: nobody recorded anything.
	assert.equal(stateOf(progress, "05"), "unmeasured");
	assert.equal(stateOf(progress, "06"), "ready", "the Status line must not be authoritative");
	assert.deepEqual(
		{ total: progress.total, done: progress.done, started: progress.started, blocked: progress.blocked, ready: progress.ready, unmeasured: progress.unmeasured },
		{ total: 6, done: 1, started: 1, blocked: 1, ready: 2, unmeasured: 1 },
	);
	assert.equal(formatTally(progress), "1/6 done, 1 blocked");
	assert.equal(formatProgressLine(progress), "Tickets: 1/6 done. In progress: 02. Ready now: 04, 06. Blocked: 03. No acceptance boxes: 05.");
});

test("a dangling dependency blocks rather than passing silently", () => {
	const local = mkdtempSync(join(tmpdir(), "spec-progress-dangling-"));
	writeFileSync(join(local, "01-a.md"), "**Blocked by:** 42 — A ticket nobody wrote.\n\n- [ ] x\n", "utf8");
	writeFileSync(join(local, "02-b.md"), "**Blocked by:** None.\n\n- [x] x\n", "utf8");
	const progress = readProgress([join(local, "01-a.md"), join(local, "02-b.md")]);
	assert.equal(stateOf(progress, "01"), "blocked");
	assert.deepEqual(progress.tickets.find((entry) => entry.label === "01")!.dangling, [42]);
	assert.equal(formatProgressLine(progress), "Tickets: 1/2 done. Blocked: 01.");
	rmSync(local, { recursive: true, force: true });
});

test("a dependency cycle terminates, and its members read as blocked", () => {
	const local = mkdtempSync(join(tmpdir(), "spec-progress-cycle-"));
	writeFileSync(join(local, "01-a.md"), "**Blocked by:** 02 — B.\n\n- [ ] x\n", "utf8");
	writeFileSync(join(local, "02-b.md"), "**Blocked by:** 01 — A.\n\n- [ ] x\n", "utf8");
	writeFileSync(join(local, "03-c.md"), "**Blocked by:** 01 — A.\n\n- [ ] x\n", "utf8");
	const files = ["01-a.md", "02-b.md", "03-c.md"].map((name) => join(local, name));
	const progress = readProgress(files);
	assert.deepEqual(
		progress.tickets.map((entry) => entry.state),
		["blocked", "blocked", "blocked"],
	);
	assert.equal(formatProgressLine(progress), "Tickets: 0/3 done. Blocked: 01, 02, 03.");
	// Ticking every box on a cycle still reads done, because "done" is local to a ticket.
	writeFileSync(join(local, "01-a.md"), "**Blocked by:** 02 — B.\n\n- [x] x\n", "utf8");
	writeFileSync(join(local, "02-b.md"), "**Blocked by:** 01 — A.\n\n- [x] x\n", "utf8");
	assert.equal(formatProgressLine(readProgress(files)), "Tickets: 2/3 done. Ready now: 03.");
	rmSync(local, { recursive: true, force: true });
});

test("a duplicated ticket number is satisfied only when every file carrying it is done", () => {
	const local = mkdtempSync(join(tmpdir(), "spec-progress-dupes-"));
	writeFileSync(join(local, "01-a.md"), "- [x] x\n", "utf8");
	writeFileSync(join(local, "01-b.md"), "- [ ] x\n", "utf8");
	writeFileSync(join(local, "02-c.md"), "**Blocked by:** 01 — A.\n\n- [ ] x\n", "utf8");
	const progress = readProgress(["01-a.md", "01-b.md", "02-c.md"].map((name) => join(local, name)));
	assert.equal(progress.tickets[2].state, "blocked");
	rmSync(local, { recursive: true, force: true });
});

test("an unreadable ticket file counts as a ticket with nothing recorded", () => {
	const progress = readProgress([join(issues, "99-missing.md")]);
	assert.equal(progress.total, 1);
	assert.equal(progress.unmeasured, 1);
	assert.equal(formatTally(progress), "0/1 done");
});

test("the tally and the note line stay small for a forty-ticket feature", () => {
	const local = mkdtempSync(join(tmpdir(), "spec-progress-wide-"));
	const files: string[] = [];
	for (let number = 1; number <= 40; number++) {
		const label = String(number).padStart(2, "0");
		// A spread designed to fill every list at once: done, started, ready, unmeasured, blocked.
		const kind = number % 5;
		const boxes = kind === 0 ? ["- [x] a", "- [x] b"] : kind === 1 ? ["- [x] a", "- [ ] b"] : kind === 2 ? ["- [ ] a"] : kind === 3 ? ["prose only"] : ["- [ ] a"];
		const blockedBy = kind === 4 ? "03 — never done." : "None.";
		const path = join(local, `${label}-t.md`);
		writeFileSync(path, `**Blocked by:** ${blockedBy}\n\n${boxes.join("\n")}\n`, "utf8");
		files.push(path);
	}
	const line = formatProgressLine(readProgress(files));
	console.log(`  worst-case line (${line.length} chars): ${line}`);
	assert.ok(line.length < 220, `progress line is ${line.length} characters`);
	// Every list is capped at four names plus a count.
	for (const lead of ["In progress", "Ready now", "Blocked", "No acceptance boxes"]) {
		assert.match(line, new RegExp(`${lead}: \\d\\d, \\d\\d, \\d\\d, \\d\\d \\+\\d+ more\\.`));
	}
	rmSync(local, { recursive: true, force: true });
});

test("readTickets keeps the number, label and dependency list on each ticket", () => {
	const progress = readProgress([ticket("07-shape.md", "**Blocked by:** 02 — x; 05 — y.\n\n- [x] a\n- [ ] b\n")]);
	assert.deepEqual(progress.tickets[0].dependsOn, [2, 5]);
	assert.equal(progress.tickets[0].number, 7);
	assert.equal(progress.tickets[0].label, "07");
	assert.equal(progress.tickets[0].boxes, 2);
	assert.equal(progress.tickets[0].ticked, 1);
	assert.equal(readTickets([]).length, 0);
	assert.equal(formatTally(readProgress([])), "0/0 done");
});

test.after(() => rmSync(root, { recursive: true, force: true }));
