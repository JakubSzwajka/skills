import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import promptFragmentsExtension from "../index.ts";

test("extension registration and editor-only apply", async () => {
let command: any;
let shortcut: any;
let shortcutKey: string | undefined;
const execCalls: Array<{ command: string; args: string[] }> = [];
const pi = {
	registerCommand(name: string, spec: any) { assert.equal(name, "fragments"); command = spec; },
	registerShortcut(key: string, spec: any) { shortcutKey = key; shortcut = spec; },
	async exec(command: string, args: string[]) {
		execCalls.push({ command, args });
		return { code: 0, stdout: "", stderr: "", killed: false };
	},
} as any;
promptFragmentsExtension(pi);
assert.equal(shortcutKey, "super+shift+r");
assert.ok(command && shortcut, "command and shortcut are registered");

const root = mkdtempSync(join(tmpdir(), "prompt-fragments-extension-"));
const agentDir = join(root, "agent");
const cwd = join(root, "project");
mkdirSync(agentDir);
mkdirSync(join(cwd, ".pi", "prompt-fragments"), { recursive: true });
writeFileSync(join(cwd, ".pi", "prompt-fragments", "test.md"), "---\nplacement: before\ntitle: Test\n---\nFragment body\n");
process.env.PI_CODING_AGENT_DIR = agentDir;

let editor = "Editor body";
let projectTrusted = true;
let setCalls = 0;
let widgetClears = 0;
let inputSequence = [" ", "\r"];
let widgetPlacement: string | undefined;
const notifications: string[] = [];
const consumed: boolean[] = [];
const tui = { requestRender() {} } as any;
const theme = { fg(_color: string, text: string) { return text; }, bg(_color: string, text: string) { return text; }, bold(text: string) { return text; } } as any;
const ctx = {
	mode: "tui",
	cwd,
	isProjectTrusted: () => projectTrusted,
	ui: {
		notify(message: string) { notifications.push(message); },
		getEditorText: () => editor,
		setEditorText(value: string) { setCalls++; editor = value; },
		setWidget(key: string, content: any, options?: { placement?: string }) {
			assert.equal(key, "prompt-fragments:picker");
			if (content === undefined) {
				widgetClears++;
				return;
			}
			widgetPlacement = options?.placement;
			content(tui, theme);
		},
		onTerminalInput(handler: (data: string) => { consume?: boolean } | undefined) {
			queueMicrotask(() => {
				for (const input of inputSequence) consumed.push(handler(input)?.consume === true);
			});
			return () => {};
		},
	},
} as any;
await command.handler("", ctx);
assert.equal(editor, "Fragment body\n\nEditor body", "apply only replaces editor text");
assert.equal(setCalls, 1);
assert.equal(widgetPlacement, "aboveEditor", "picker uses Pi's native above-editor widget placement");
assert.equal(widgetClears, 1, "applying clears the widget");
assert.ok(consumed.every(Boolean), "picker input does not leak into the editor");
assert.equal(notifications.length, 0);

inputSequence = ["\u001b"];
await shortcut.handler(ctx);
assert.equal(setCalls, 1, "shortcut opens the same picker and cancel leaves the editor unchanged");
assert.equal(widgetClears, 2, "cancelling clears the widget");

inputSequence = ["n"];
await command.handler("", ctx);
const globalDir = join(agentDir, "prompt-fragments");
assert.equal(existsSync(globalDir), true, "n creates the global directory when needed");
assert.deepEqual(
	execCalls.at(-1),
	process.platform === "darwin"
		? { command: "open", args: ["-a", "Cursor", globalDir] }
		: { command: "cursor", args: [globalDir] },
	"n opens the global directory in Cursor",
);

inputSequence = ["N"];
await shortcut.handler(ctx);
const projectDir = join(cwd, ".pi", "prompt-fragments");
assert.deepEqual(
	execCalls.at(-1),
	process.platform === "darwin"
		? { command: "open", args: ["-a", "Cursor", projectDir] }
		: { command: "cursor", args: [projectDir] },
	"Shift+n opens the project directory in Cursor",
);

const callsBeforeUntrusted = execCalls.length;
projectTrusted = false;
await shortcut.handler(ctx);
assert.equal(execCalls.length, callsBeforeUntrusted, "untrusted project directories are not opened");
assert.ok(notifications.some((message) => message.includes("Trust this project")));
});
