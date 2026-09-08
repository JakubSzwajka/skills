import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import devports, { DEVPORTS_WIDGET_KEY, openPortList, PortList } from "../../devports.ts";

let command: any;
let tool: any;
devports({
	registerCommand(name: string, spec: any) { assert.equal(name, "ports"); command = spec; },
	registerTool(spec: any) { tool = spec; },
} as any);
assert.ok(command, "ports command registered");
assert.equal(tool?.name, "ports", "ports tool remains registered");

const nonTuiNotices: string[] = [];
await command.handler("", { mode: "rpc", ui: { notify(message: string) { nonTuiNotices.push(message); } } });
assert.deepEqual(nonTuiNotices, ["/ports needs the TUI"]);

let component: any;
let terminalHandler: ((data: string) => { consume?: boolean }) | undefined;
let placement: string | undefined;
let clears = 0;
let unsubscribes = 0;
let editor = "ports draft\nunchanged";
let editorWrites = 0;
const themeCalls: string[] = [];
const theme = {
	fg: (color: string, text: string) => { themeCalls.push(color); return text; },
	bg: (color: string, text: string) => { themeCalls.push(color); return text; },
	bold: (text: string) => text,
};
const ctx = {
	mode: "tui",
	ui: {
		setWidget(key: string, factory: any, options?: { placement?: string }) {
			assert.equal(key, DEVPORTS_WIDGET_KEY);
			if (!factory) { clears++; return; }
			placement = options?.placement;
			component = factory({ terminal: { rows: 50 }, requestRender() {} }, theme);
		},
		onTerminalInput(handler: typeof terminalHandler) {
			terminalHandler = handler;
			return () => { unsubscribes++; };
		},
		getEditorText: () => editor,
		setEditorText(value: string) { editorWrites++; editor = value; },
	},
} as any;
const pending = openPortList(ctx);
assert.equal(placement, "aboveEditor");
const rendered = component.render(48);
assert.ok(rendered.length <= 18, `widget is bounded (${rendered.length} rows)`);
assert.ok(rendered[0]?.includes("─") && rendered.at(-1)?.includes("─"), "widget has a frame");
assert.equal(terminalHandler?.("?")?.consume, true, "unknown input is consumed");
assert.equal(terminalHandler?.("r")?.consume, true, "rescan is consumed");
assert.equal(terminalHandler?.("s")?.consume, true, "stale filter is consumed");
assert.equal(terminalHandler?.("q")?.consume, true, "close input is consumed");
assert.deepEqual(await pending, []);
assert.equal(clears, 1);
assert.equal(unsubscribes, 1);
assert.equal(editorWrites, 0);
assert.equal(editor, "ports draft\nunchanged");

let killCalls = 0;
let closedNotes: string[] = [];
const fixture = {
	port: 4321,
	pid: 987654,
	age: "2-00:00:00",
	ageDays: 2,
	cmd: "node fixture.js",
	cwd: "/tmp",
	dev: true,
	system: false,
	cwdGone: false,
	old: true,
};
const controlled = new PortList(
	{ terminal: { rows: 30 }, requestRender() {} } as any,
	theme as any,
	(notes) => { closedNotes = notes; },
	{
		scan: () => [fixture],
		loadGroups: () => ({ groups: [{ name: "Fixture", when: { dev: true } }] }),
		killPids: (pids: number[]) => { killCalls++; assert.deepEqual(pids, [fixture.pid]); return { killed: pids, failed: [] }; },
	} as any,
);
controlled.handleInput("\u001b[107u");
assert.equal(killCalls, 0, "first Kitty-encoded k only arms the confirmation");
controlled.render(40);
assert.ok(themeCalls.includes("accent") && themeCalls.includes("selectedBg") && themeCalls.includes("warning"), "frame, selection, and confirmation use active-theme colors");
controlled.handleInput("\u001b[107u");
assert.equal(killCalls, 1, "second matching Kitty-encoded k performs the kill");
controlled.handleInput("\u001b[113u");
assert.ok(closedNotes[0]?.includes(":4321"), "killed-process note survives until close");

const manyRows = Array.from({ length: 14 }, (_, index) => ({
	...fixture,
	port: fixture.port + index,
	pid: fixture.pid + index,
}));
const malformed = new PortList(
	{ terminal: { rows: 50 }, requestRender() {} } as any,
	theme as any,
	() => {},
	{
		scan: () => manyRows,
		loadGroups: () => ({ groups: [{ name: 42, note: { unsafe: true } }] }),
		killPids: () => ({ killed: [], failed: [] }),
	} as any,
);
const narrow = malformed.render(12);
assert.ok(narrow.every((line) => visibleWidth(line) <= 12), "every row fits a narrow widget width");
assert.ok(narrow.join("\n").includes("42"), "non-string config labels are coerced safely");
assert.ok(narrow.length <= 18, "large scans remain height-bounded");
for (let index = 0; index < 12; index++) malformed.handleInput("\u001b[B");
assert.notDeepEqual(malformed.render(12), narrow, "scrolling advances the bounded row window");

let setupCleared = false;
await assert.rejects(openPortList({
	ui: {
		setWidget(_key: string, factory: any) {
			if (factory) throw new Error("ports widget setup failed");
			setupCleared = true;
		},
		onTerminalInput() { throw new Error("must not subscribe"); },
	},
} as any), /ports widget setup failed/);
assert.equal(setupCleared, true, "setup errors still clear the ports widget");

let errorHandler: ((data: string) => { consume?: boolean }) | undefined;
let errorClears = 0;
let errorUnsubscribes = 0;
const handlerFailure = openPortList({
	ui: {
		setWidget(_key: string, factory: any) {
			if (!factory) { errorClears++; return; }
			factory({ terminal: { rows: 30 }, requestRender() {} }, theme);
		},
		onTerminalInput(next: typeof errorHandler) {
			errorHandler = next;
			return () => { errorUnsubscribes++; };
		},
	},
} as any, {
	scan: () => [fixture],
	loadGroups: () => ({ groups: [{ name: "Fixture" }] }),
	killPids: () => { throw new Error("kill failed"); },
} as any);
assert.equal(errorHandler?.("k")?.consume, true);
assert.equal(errorHandler?.("k")?.consume, true);
await assert.rejects(handlerFailure, /kill failed/);
assert.equal(errorClears, 1, "handler errors clear the ports widget");
assert.equal(errorUnsubscribes, 1, "handler errors unsubscribe terminal input");

export default function devportsSmoke(): void {}
