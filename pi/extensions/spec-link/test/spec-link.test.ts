import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { contents, describeFeature, discover, extractTitle, featureFolderOf, formatAge, pickerLabels, renderNote, sanitizeDisplay } from "../discovery.ts";
import specLinkExtension from "../index.ts";

const root = mkdtempSync(join(tmpdir(), "spec-link-"));
const write = (relative: string, body: string, ageMinutes: number): string => {
	const path = join(root, relative);
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, body, "utf8");
	const when = new Date(Date.now() - ageMinutes * 60_000);
	utimesSync(path, when, when);
	return path;
};

// One feature with both records, one with tickets only, one spec-only under `.pi`.
const specPath = write(".scratch/auth-rework/SPEC.md", "# Rework auth to short-lived JWT\n\nbody\n", 600);
write(".scratch/auth-rework/issues/01-add-token-store.md", "# 01 — Add the token store\n\n**Blocked by:** None — can start immediately.\n\n- [x] store lands\n- [x] tests pass\n", 45);
write(".scratch/auth-rework/issues/02-rotate-keys.md", "# 02 — Rotate signing keys\n\n**Blocked by:** 01 — Add the token store.\n\n- [ ] rotation works\n", 300);
write(".scratch/auth-rework/issues/notes.md", "# Not a ticket\n", 1);
write(".scratch/task-log-continuation/issues/01-build-harness.md", "# 01 — Build the harness\n\n**Blocked by:** None.\n\n- [ ] harness runs\n", 90);
write(".scratch/task-log-continuation/issues/02-harden-codec.md", "# 02 — Harden the codec\n\n**Blocked by:** 01 — Build the harness.\n\n- [ ] codec holds\n", 1_500);
write("pi/extensions/thing/.pi/SPEC.md", "# Improve the thing extension\n", 200);
write("pi/extensions/thing/index.ts", "export {};\n", 0);
write("node_modules/pkg/SPEC.md", "# Ignored dependency spec\n", 0);
write("README.md", "# Not a spec\n", 0);

test("one row per feature folder, newest record first", () => {
	const found = discover(root);
	assert.deepEqual(
		found.map((feature) => feature.relativePath),
		[".scratch/auth-rework", ".scratch/task-log-continuation", "pi/extensions/thing"],
	);
	// The spec and its tickets are one row, titled by the spec.
	assert.equal(found[0].title, "Rework auth to short-lived JWT");
	assert.equal(found[0].ticketCount, 2);
	assert.equal(found[0].specPath, specPath);
	assert.equal(found[0].ticketsPath, join(root, ".scratch/auth-rework/issues"));
	// Tickets with no spec: folder name turned into words.
	assert.equal(found[1].title, "task log continuation");
	assert.equal(found[1].specPath, undefined);
	assert.equal(found[1].ticketCount, 2);
	// A spec with no tickets.
	assert.equal(found[2].title, "Improve the thing extension");
	assert.equal(found[2].ticketCount, 0);
});

test("the `.pi/SPEC.md` precedent lists as the module that owns it", () => {
	const module = join(root, "pi/extensions/thing");
	assert.equal(featureFolderOf(join(module, ".pi/SPEC.md")), module);
	assert.equal(featureFolderOf(join(module, ".pi/issues/03-x.md")), module);
	assert.equal(featureFolderOf(join(root, ".scratch/auth-rework/issues/01-add-token-store.md")), join(root, ".scratch/auth-rework"));
	const feature = describeFeature(module, root)!;
	assert.equal(feature.relativePath, "pi/extensions/thing");
	assert.equal(feature.specPath, join(module, ".pi/SPEC.md"));
});

test("recency is the newest record inside the feature, not the spec's own age", () => {
	const now = Date.now();
	const found = discover(root);
	// auth-rework's spec is 10h old; its newest ticket is 45m old and that is what ranks it.
	assert.equal(formatAge(found[0].modifiedAt, now), "45m ago");
	assert.equal(formatAge(found[1].modifiedAt, now), "1h ago");
	assert.equal(formatAge(found[2].modifiedAt, now), "3h ago");
	// Source files inside a module do not count; only the records do.
	assert.ok(found[2].modifiedAt < now - 3_600_000, "a fresh index.ts must not make the feature look new");
});

test("a folder with no record is not a feature", () => {
	const empty = mkdtempSync(join(tmpdir(), "spec-link-empty-"));
	mkdirSync(join(empty, "src"), { recursive: true });
	writeFileSync(join(empty, "src", "index.ts"), "export {};\n", "utf8");
	assert.deepEqual(discover(empty), []);
	assert.equal(describeFeature(join(empty, "src"), empty), undefined);
	rmSync(empty, { recursive: true, force: true });
});

test("picker rows align and report progress derived from the tickets", () => {
	const now = Date.now();
	const labels = pickerLabels(discover(root), now);
	for (const label of labels) console.log(`  ${label}`);
	const columns = labels.map((label) => label.split("  ·  "));
	assert.deepEqual(
		columns.map((row) => row.map((cell) => cell.trimEnd())),
		[
			// 01 is fully ticked; 02 waits on nothing unfinished, so it is ready, not blocked.
			["Rework auth to short-lived JWT", ".scratch/auth-rework", "1/2 done, spec, 45m ago"],
			// Both open, and 02 waits on 01, so one is blocked.
			["task log continuation", ".scratch/task-log-continuation", "0/2 done, 1 blocked, 1h ago"],
			// A spec with no tickets has no tally to show.
			["Improve the thing extension", "pi/extensions/thing", "spec, 3h ago"],
		],
	);
	// Columns line up, so the eye reads down the folders rather than hunting.
	for (const index of [0, 1]) {
		assert.equal(new Set(columns.map((row) => row[index].length)).size, 1, `column ${index} is ragged`);
	}
	// A feature with neither record cannot exist, but the segment never renders empty.
	assert.equal(contents({ specPath: "x", ticketCount: 0, progress: undefined }), "spec");
	assert.equal(contents({ specPath: undefined, ticketCount: 0, progress: undefined }), "no records");
});

test("titles fall back to names and stay display safe", () => {
	assert.equal(extractTitle("no heading here\njust prose\n", "/x/.scratch/f/issues/07-rotate-keys.md"), "rotate keys");
	assert.equal(extractTitle("## Second level works\n", "/x/SPEC.md"), "Second level works");
	assert.equal(extractTitle("# safe\u001b[2Jtitle\n", "/x/SPEC.md"), "safe [2Jtitle");
	assert.equal(sanitizeDisplay("a\u0000b\nc"), "a b c");
	assert.equal(sanitizeDisplay("x".repeat(90)).length, 80);
	assert.equal(formatAge(Date.now() - 50 * 3_600_000, Date.now()), "2d ago");
});

test("the per-turn note carries the tally and stays small in every state", () => {
	const features = discover(root);
	const sizes: string[] = [];
	for (const feature of features) {
		const note = renderNote(feature);
		// Paths are as long as the machine makes them; the prose around them is the part under our control.
		const pathChars = feature.path.length + (feature.specPath?.length ?? 0) + (feature.ticketsPath?.length ?? 0);
		sizes.push(`${feature.relativePath}: ${note.length} chars (${note.length - pathChars} of prose)`);
		assert.match(note, /^\[spec-link\] The operator linked this feature/);
		assert.match(note, new RegExp(`Folder: ${feature.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
		assert.ok(!note.includes("body"), "the note never carries a file body");
		assert.ok(note.length - pathChars < 420, `prose is ${note.length - pathChars} characters`);
	}
	for (const size of sizes) console.log(`  note cost — ${size}`);
	// Both records: the tally names the frontier by ticket number.
	assert.match(renderNote(features[0]), /Spec: .*SPEC\.md\nTickets: 1\/2 done\. Ready now: 02\.\nTicket files: .*auth-rework\/issues/);
	// Tickets and no spec: say so plainly, then report progress.
	assert.match(renderNote(features[1]), /Spec: none written yet, so the intent lives only in the tickets\.\nTickets: 0\/2 done\. Ready now: 01\. Blocked: 02\.\n/);
	// Spec and no tickets: no ticket lines at all.
	assert.ok(!renderNote(features[2]).includes("Tickets:"));
	assert.ok(!renderNote(features[2]).includes("Ticket files:"));
});

test("ticking a box changes the next note without any write from the extension", () => {
	const link = discover(root).find((feature) => feature.relativePath === ".scratch/task-log-continuation")!;
	assert.match(renderNote(link), /Tickets: 0\/2 done\. Ready now: 01\. Blocked: 02\./);
	const ticket = join(root, ".scratch/task-log-continuation/issues/01-build-harness.md");
	const before = readFileSync(ticket, "utf8");
	writeFileSync(ticket, before.replace("- [ ] harness runs", "- [x] harness runs"), "utf8");
	// Same link object, re-derived on render, so the next turn tells the truth.
	assert.match(renderNote(link), /Tickets: 1\/2 done\. Ready now: 02\./);
	writeFileSync(ticket, before, "utf8");
});

/** This test file may itself run inside a delegate child, so the role is set explicitly. */
const withRole = <T>(role: string | undefined, run: () => T): T => {
	const previous = process.env.PI_DELEGATE_ROLE;
	if (role === undefined) delete process.env.PI_DELEGATE_ROLE;
	else process.env.PI_DELEGATE_ROLE = role;
	try {
		return run();
	} finally {
		if (previous === undefined) delete process.env.PI_DELEGATE_ROLE;
		else process.env.PI_DELEGATE_ROLE = previous;
	}
};

const stubApi = () => {
	const commands: string[] = [];
	const events: string[] = [];
	const entries: Array<{ type: string; data: unknown }> = [];
	const api = {
		registerCommand: (name: string) => void commands.push(name),
		registerTool: () => assert.fail("spec-link registers no tools"),
		on: (event: string) => void events.push(event),
		appendEntry: (type: string, data: unknown) => void entries.push({ type, data }),
	};
	return { api, commands, events, entries };
};

test("the extension registers for an operator session and stays out of delegate children", () => {
	const operator = stubApi();
	withRole(undefined, () => specLinkExtension(operator.api as never));
	assert.deepEqual(operator.commands, ["spec", "spec:clear"]);
	assert.deepEqual(operator.events, ["context", "session_start", "session_tree", "session_shutdown"]);

	const child = stubApi();
	withRole("child", () => specLinkExtension(child.api as never));
	assert.deepEqual(child.commands, []);
	assert.deepEqual(child.events, []);
});

test("linking stores the feature, notes it before the last user message, and clears", async () => {
	const captured = stubApi();
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const api = { ...captured.api, on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => void handlers.set(event, handler) };
	const commandHandlers = new Map<string, (args: string, ctx: unknown) => Promise<void>>();
	withRole(undefined, () =>
		specLinkExtension({
			...api,
			registerCommand: (name: string, spec: { handler: (args: string, ctx: unknown) => Promise<void> }) => void commandHandlers.set(name, spec.handler),
		} as never),
	);

	const status: Array<string | undefined> = [];
	const ctx = {
		cwd: root,
		hasUI: true,
		mode: "tui",
		ui: {
			notify: () => {},
			setStatus: (_key: string, value?: string) => void status.push(value),
			select: async (_title: string, options: string[]) => options.find((option) => option.includes(".scratch/auth-rework ")),
		},
		sessionManager: { getBranch: () => [] },
	};

	await commandHandlers.get("spec")!("", ctx);
	assert.deepEqual(captured.entries.at(-1), {
		type: "spec-link:link",
		data: {
			path: join(root, ".scratch/auth-rework"),
			title: "Rework auth to short-lived JWT",
			specPath,
			ticketsPath: join(root, ".scratch/auth-rework/issues"),
			ticketCount: 2,
		},
	});
	assert.equal(status.at(-1), "spec: Rework auth to short-lived JWT");

	const stale = { role: "custom", customType: "spec-link:note", content: "old", display: false, timestamp: 1 };
	const messages = [{ role: "user", content: "first" }, { role: "assistant", content: "reply" }, stale, { role: "user", content: "latest" }];
	const result = handlers.get("context")!({ messages }, ctx) as { messages: Array<{ role: string; customType?: string; content: string; display?: boolean }> };
	assert.equal(result.messages.filter((message) => message.customType === "spec-link:note").length, 1);
	assert.equal(result.messages.at(-2)?.customType, "spec-link:note");
	assert.match(result.messages.at(-2)!.content, /Tickets: 1\/2 done/);
	assert.equal(result.messages.at(-1)?.content, "latest");

	// Restore re-reads the folder, so a link whose folder is gone drops out.
	handlers.get("session_start")!({}, { ...ctx, sessionManager: { getBranch: () => [{ type: "custom", customType: "spec-link:link", data: { path: join(root, "gone") } }] } });
	assert.equal(status.at(-1), undefined);

	await commandHandlers.get("spec")!("", ctx);
	await commandHandlers.get("spec:clear")!("", ctx);
	assert.deepEqual(captured.entries.at(-1), { type: "spec-link:link", data: { path: null } });
	assert.equal(status.at(-1), undefined);
	assert.equal(handlers.get("context")!({ messages: [{ role: "user", content: "latest" }] }, ctx), undefined);
});

test.after(() => rmSync(root, { recursive: true, force: true }));
