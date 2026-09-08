import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import taskLog from "./index.ts";
import { openTaskPicker, TASK_PICKER_WIDGET_KEY, TaskPicker } from "./picker.ts";
import { createTask, type Task } from "./store.ts";

let registeredTaskCommand: any;
const registeredTools: string[] = [];
taskLog({
	registerCommand(name: string, spec: any) { assert.equal(name, "task"); registeredTaskCommand = spec; },
	registerTool(spec: any) { registeredTools.push(spec.name); },
	on() {},
	appendEntry() {},
	sendMessage() {},
} as any);
assert.ok(registeredTaskCommand, "task command registered");
assert.deepEqual(registeredTools, ["task_log", "task_read"], "task domain tools remain registered");

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};
const task: Task = {
	path: "/tmp/task.md",
	id: "task",
	title: "Native picker",
	status: "active",
	created: new Date(0).toISOString(),
	refs: [],
	description: "widget migration",
	entries: [],
};

async function invoke(inputs: string[]) {
	let component: any;
	let handler: ((data: string) => { consume?: boolean }) | undefined;
	let placement: string | undefined;
	let clears = 0;
	let unsubscribes = 0;
	let editor = "draft bytes\nunchanged";
	let editorWrites = 0;
	const ctx = {
		cwd: "/tmp",
		ui: {
			setWidget(key: string, factory: any, options?: { placement?: string }) {
				assert.equal(key, TASK_PICKER_WIDGET_KEY);
				if (!factory) { clears++; return; }
				placement = options?.placement;
				component = factory({ requestRender() {} }, theme);
			},
			onTerminalInput(next: typeof handler) { handler = next; return () => { unsubscribes++; }; },
			getEditorText: () => editor,
			setEditorText(value: string) { editorWrites++; editor = value; },
		},
	} as any;
	const pending = openTaskPicker(ctx, { tasks: [task], showDone: false });
	assert.equal(placement, "aboveEditor");
	assert.ok(component.render(60).length <= 17, "picker height stays bounded");
	const consumed = inputs.map((input) => handler?.(input)?.consume === true);
	const action = await pending;
	assert.ok(consumed.every(Boolean), "all picker input is consumed");
	assert.equal(clears, 1);
	assert.equal(unsubscribes, 1);
	assert.equal(editorWrites, 0);
	assert.equal(editor, "draft bytes\nunchanged");
	return action;
}

assert.equal((await invoke(["filter", "\u007f", "\u001b"])).kind, "close");
assert.equal((await invoke(["\u000e"])).kind, "new");
assert.equal((await invoke(["\u0004"])).kind, "done");
assert.equal((await invoke(["\r"])).kind, "attach");
assert.equal((await invoke(["\t"])).kind, "toggleDone");

async function invokeWithOptions(inputs: string[], options: { tasks: Task[]; attachedPath?: string; showDone: boolean }) {
	let handler: ((data: string) => { consume?: boolean }) | undefined;
	const pending = openTaskPicker({
		cwd: "/tmp",
		ui: {
			setWidget(_key: string, factory: any) { if (factory) factory({ requestRender() {} }, theme); },
			onTerminalInput(next: typeof handler) { handler = next; return () => {}; },
		},
	} as any, options);
	for (const input of inputs) assert.equal(handler?.(input)?.consume, true);
	return pending;
}

assert.equal((await invokeWithOptions(["\u0018"], { tasks: [task], attachedPath: task.path, showDone: false })).kind, "detach");
assert.equal((await invokeWithOptions(["\u0003"], { tasks: [task], showDone: false })).kind, "close");
const other = { ...task, path: "/tmp/other.md", id: "other", title: "Zebra task" };
const filtered = await invokeWithOptions(["\u001b[122u", "\r"], { tasks: [task, other], showDone: false });
assert.equal(filtered.kind, "attach");
assert.equal(filtered.kind === "attach" ? filtered.task.path : "", other.path, "Kitty printable filtering selects the matching task");
const navigated = await invokeWithOptions(["\u001b[B", "\r"], { tasks: [task, other], showDone: false });
assert.equal(navigated.kind === "attach" ? navigated.task.path : "", other.path, "arrow navigation still delegates to the native select list");

const hostile = { ...task, title: "Bad\u001b[31m\nTitle\u0007" };
const hostilePicker = new TaskPicker(
	{ requestRender() {} } as any,
	theme as any,
	{ tasks: [hostile], attachedPath: hostile.path, showDone: false },
	() => {},
	"/tmp",
);
const hostileRender = hostilePicker.render(80).join("\n");
assert.equal(hostileRender.includes("\u001b[31m"), false, "task titles cannot inject terminal escapes");
assert.equal(hostileRender.includes("\u0007"), false, "task titles cannot inject terminal controls");
assert.ok(hostileRender.includes("Bad Title"), "hostile task titles retain safe visible text");
const hostilePathPicker = new TaskPicker(
	{ requestRender() {} } as any,
	theme as any,
	{ tasks: [], showDone: false },
	() => {},
	"/tmp/unsafe\u001b[2J\npath",
);
const pathRender = hostilePathPicker.render(80).join("\n");
assert.equal(pathRender.includes("\u001b[2J"), false, "displayed task directories cannot inject terminal escapes");
assert.equal(pathRender.includes("\npath"), false, "displayed task directories are flattened");

let setupCleared = false;
await assert.rejects(openTaskPicker({
	cwd: "/tmp",
	ui: {
		setWidget(_key: string, factory: any) {
			if (factory) throw new Error("widget setup failed");
			setupCleared = true;
		},
		onTerminalInput() { throw new Error("must not subscribe"); },
	},
} as any, { tasks: [task], showDone: false }), /widget setup failed/);
assert.equal(setupCleared, true, "setup errors still clear the widget");

async function runNestedDialogCase(cwd: string, firstKey: string, dialog: "input" | "confirm"): Promise<void> {
	let terminalHandler: ((data: string) => { consume?: boolean }) | undefined;
	let pickerCount = 0;
	let widgetOpen = false;
	let subscriptionOpen = false;
	const ctx = {
		mode: "tui",
		cwd,
		ui: {
			setWidget(_key: string, factory: any) {
				if (!factory) { widgetOpen = false; return; }
				widgetOpen = true;
				pickerCount++;
				factory({ requestRender() {} }, theme);
			},
			onTerminalInput(next: typeof terminalHandler) {
				terminalHandler = next;
				subscriptionOpen = true;
				const key = pickerCount === 1 ? firstKey : "\u001b";
				queueMicrotask(() => terminalHandler?.(key));
				return () => { subscriptionOpen = false; };
			},
			async input() {
				assert.equal(dialog, "input");
				assert.equal(widgetOpen, false, "picker clears before native input opens");
				assert.equal(subscriptionOpen, false, "terminal interception ends before native input opens");
				return undefined;
			},
			async confirm() {
				assert.equal(dialog, "confirm");
				assert.equal(widgetOpen, false, "picker clears before native confirm opens");
				assert.equal(subscriptionOpen, false, "terminal interception ends before native confirm opens");
				return false;
			},
			notify() {},
		},
	} as any;
	await registeredTaskCommand.handler("", ctx);
	assert.equal(pickerCount, 2, "cancelled native dialog reopens a fresh picker");
}

await runNestedDialogCase(mkdtempSync(join(tmpdir(), "task-picker-input-")), "\u000e", "input");
const confirmRoot = mkdtempSync(join(tmpdir(), "task-picker-confirm-"));
createTask(confirmRoot, "Confirm fixture", "");
await runNestedDialogCase(confirmRoot, "\u0004", "confirm");

export default function pickerSmoke(): void {}
