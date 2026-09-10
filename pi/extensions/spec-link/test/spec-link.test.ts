import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import specLinkExtension from "../index.ts";
import { discover, extractTitle, formatAge, pickerLabel, renderNote, sanitizeDisplay } from "../discovery.ts";

const root = mkdtempSync(join(tmpdir(), "spec-link-"));
const write = (relative: string, body: string, ageMinutes: number): string => {
	const path = join(root, relative);
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, body, "utf8");
	const when = new Date(Date.now() - ageMinutes * 60_000);
	utimesSync(path, when, when);
	return path;
};

test("discovery finds both conventions and sorts newest first", () => {
	write(".scratch/auth-rework/SPEC.md", "# Rework auth to short-lived JWT\n\nbody\n", 120);
	write(".scratch/auth-rework/issues/01-add-token-store.md", "# 01 — Add the token store\n", 5);
	write(".scratch/auth-rework/issues/02-rotate-keys.md", "# 02 — Rotate signing keys\n", 60);
	write("pi/extensions/thing/.pi/SPEC.md", "# Thing extension spec\n", 30);
	write(".scratch/auth-rework/issues/notes.md", "# Not a ticket\n", 1);
	write("node_modules/pkg/SPEC.md", "# Ignored dependency spec\n", 0);
	write("README.md", "# Not a spec\n", 0);

	const found = discover(root);
	assert.deepEqual(found.map((candidate) => candidate.relativePath), [
		".scratch/auth-rework/issues/01-add-token-store.md",
		"pi/extensions/thing/.pi/SPEC.md",
		".scratch/auth-rework/issues/02-rotate-keys.md",
		".scratch/auth-rework/SPEC.md",
	]);
	assert.deepEqual(found.map((candidate) => candidate.kind), ["ticket", "spec", "ticket", "spec"]);
	assert.equal(found[0].title, "01 — Add the token store");
	assert.match(pickerLabel(found[0], Date.now()), /01 — Add the token store {2}· {2}\.scratch\/auth-rework\/issues\/01-add-token-store\.md {2}· {2}ticket, 5m ago/);
});

test("no specs found returns an empty list rather than an error", () => {
	const empty = mkdtempSync(join(tmpdir(), "spec-link-empty-"));
	mkdirSync(join(empty, "src"), { recursive: true });
	writeFileSync(join(empty, "src", "index.ts"), "export {};\n", "utf8");
	assert.deepEqual(discover(empty), []);
	rmSync(empty, { recursive: true, force: true });
});

test("titles fall back to the file name and stay display safe", () => {
	assert.equal(extractTitle("no heading here\njust prose\n", "/x/.scratch/f/issues/07-rotate-keys.md"), "rotate keys");
	assert.equal(extractTitle("## Second level works\n", "/x/SPEC.md"), "Second level works");
	assert.equal(extractTitle("# safe\u001b[2Jtitle\n", "/x/SPEC.md"), "safe [2Jtitle");
	assert.equal(sanitizeDisplay("a\u0000b\nc"), "a b c");
	assert.equal(sanitizeDisplay("x".repeat(90)).length, 80);
	assert.equal(formatAge(Date.now() - 3 * 3_600_000, Date.now()), "3h ago");
	assert.equal(formatAge(Date.now() - 50 * 3_600_000, Date.now()), "2d ago");
});

test("the per-turn note carries the link and stays under 400 characters", () => {
	const note = renderNote({ path: join(root, ".scratch/auth-rework/SPEC.md"), title: "Rework auth to short-lived JWT", kind: "spec" });
	assert.match(note, /\[spec-link\]/);
	assert.match(note, /Rework auth to short-lived JWT/);
	assert.match(note, /SPEC\.md/);
	assert.ok(!note.includes("body"), "the note never carries the file body");
	assert.ok(note.length < 400, `note is ${note.length} characters`);
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

test("the note is injected before the last user message and replaces a stale copy", async () => {
	const captured = stubApi();
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const api = { ...captured.api, on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => void handlers.set(event, handler) };
	const commandHandlers = new Map<string, (args: string, ctx: unknown) => Promise<void>>();
	withRole(undefined, () => specLinkExtension({ ...api, registerCommand: (name: string, spec: { handler: (args: string, ctx: unknown) => Promise<void> }) => void commandHandlers.set(name, spec.handler) } as never));

	const specPath = join(root, ".scratch/auth-rework/SPEC.md");
	const status: Array<string | undefined> = [];
	const ctx = {
		cwd: root,
		hasUI: true,
		mode: "tui",
		ui: {
			notify: () => {},
			setStatus: (_key: string, value?: string) => void status.push(value),
			select: async (_title: string, options: string[]) => options.find((option) => option.includes("auth-rework/SPEC.md")),
		},
		sessionManager: { getBranch: () => [] },
	};

	await commandHandlers.get("spec")!("", ctx);
	assert.deepEqual(captured.entries.at(-1), { type: "spec-link:link", data: { path: specPath, title: "Rework auth to short-lived JWT", kind: "spec" } });
	assert.equal(status.at(-1), "spec: Rework auth to short-lived JWT");

	const stale = { role: "custom", customType: "spec-link:note", content: "old", display: false, timestamp: 1 };
	const messages = [{ role: "user", content: "first" }, { role: "assistant", content: "reply" }, stale, { role: "user", content: "latest" }];
	const result = handlers.get("context")!({ messages }, ctx) as { messages: Array<{ role: string; customType?: string; content: string; display?: boolean }> };
	assert.equal(result.messages.filter((message) => message.customType === "spec-link:note").length, 1);
	assert.equal(result.messages.at(-2)?.customType, "spec-link:note");
	assert.equal(result.messages.at(-2)?.display, false);
	assert.equal(result.messages.at(-1)?.content, "latest");

	await commandHandlers.get("spec:clear")!("", ctx);
	assert.deepEqual(captured.entries.at(-1), { type: "spec-link:link", data: { path: null } });
	assert.equal(status.at(-1), undefined);
	const cleared = handlers.get("context")!({ messages }, ctx) as { messages: Array<{ customType?: string }> };
	assert.equal(cleared.messages.some((message) => message.customType === "spec-link:note"), false);
	assert.equal(handlers.get("context")!({ messages: [{ role: "user", content: "latest" }] }, ctx), undefined);
});

test.after(() => rmSync(root, { recursive: true, force: true }));
