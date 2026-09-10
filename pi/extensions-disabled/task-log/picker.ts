import { DynamicBorder, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	Container,
	decodeKittyPrintable,
	Key,
	matchesKey,
	SelectList,
	truncateToWidth,
	type Component,
	type SelectItem,
	type SelectListTheme,
	type TUI,
} from "@earendil-works/pi-tui";
import { lastActivity, relativeTime, sanitizeTaskOutput, sessionCount, tasksDir, type Task } from "./store.ts";

export type PickerAction =
	| { kind: "attach"; task: Task }
	| { kind: "new" }
	| { kind: "done"; task: Task }
	| { kind: "status"; task: Task }
	| { kind: "references"; task: Task }
	| { kind: "detach" }
	| { kind: "toggleInactive" }
	| { kind: "close" };

const MAX_VISIBLE = 12;
const LIST_SLOT = 2;
const LIST_LAYOUT = { minPrimaryColumnWidth: 24, maxPrimaryColumnWidth: 52 };
export const TASK_PICKER_WIDGET_KEY = "task-log:picker";

function describe(task: Task): string {
	const parts = [
		task.entries.length === 1 ? "1 entry" : `${task.entries.length} entries`,
		`${sessionCount(task)} sessions`,
		relativeTime(lastActivity(task)),
	];
	if (task.status !== "active") parts.unshift(task.status);
	return parts.join(" · ");
}

function printableInput(data: string): string | undefined {
	return decodeKittyPrintable(data) ?? (data.length > 0 && !/[\u0000-\u001f\u007f]/.test(data) ? data : undefined);
}

export function sanitizeTaskDisplay(value: unknown): string {
	return sanitizeTaskOutput(value).replace(/\n/g, " ");
}

type Theme = ExtensionCommandContext["ui"]["theme"];
type TaskPickerOptions = { tasks: Task[]; attachedPath?: string; showInactive: boolean };
type TaskRow = { task: Task; item: SelectItem };

function selectListTheme(theme: Theme): SelectListTheme {
	return {
		selectedPrefix: (text) => theme.fg("accent", text),
		selectedText: (text) => theme.fg("accent", text),
		description: (text) => theme.fg("muted", text),
		scrollInfo: (text) => theme.fg("muted", text),
		noMatch: (text) => theme.fg("muted", text),
	};
}

export class TaskPicker implements Component {
	private readonly container = new Container();
	private readonly rows: TaskRow[];
	private readonly hints: string[];
	private filter = "";
	private selectList: SelectList;

	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly options: TaskPickerOptions;
	private readonly done: (action: PickerAction) => void;

	constructor(
		tui: TUI,
		theme: Theme,
		options: TaskPickerOptions,
		done: (action: PickerAction) => void,
		cwd: string,
	) {
		this.tui = tui;
		this.theme = theme;
		this.options = options;
		this.done = done;
		const { tasks, attachedPath, showInactive } = options;
		this.rows = tasks.map((task) => ({
			task,
			item: {
				value: task.path,
				label: `${task.path === attachedPath ? "● " : "  "}${sanitizeTaskDisplay(task.title)}`,
				description: describe(task),
			},
		}));
		const attachedTitle = tasks.find((task) => task.path === attachedPath)?.title;
		let location = cwd;
		try { location = tasksDir(cwd); } catch {}
		const headline = attachedTitle
			? `Tasks · attached: ${sanitizeTaskDisplay(attachedTitle)}`
			: `Tasks · ${sanitizeTaskDisplay(location)}`;
		this.hints = [
			"enter attach",
			"ctrl+n new",
			this.rows.length > 0 ? "ctrl+s status" : "",
			this.rows.length > 0 ? "ctrl+r refs" : "",
			this.rows.length > 0 ? "ctrl+d done" : "",
			attachedPath ? "ctrl+x detach" : "",
			showInactive ? "tab hide inactive" : "tab show inactive",
			"esc close",
		].filter(Boolean);

		this.selectList = this.buildList();
		this.container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		this.container.addChild(this.line(() => headline, "accent"));
		this.container.addChild(this.selectList);
		this.container.addChild(this.line(() => (this.filter ? `filter: ${this.filter}` : this.hints.join(" · ")), "dim"));
		this.container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
	}

	private line(text: () => string, color: "accent" | "dim"): Component {
		return {
			render: (width: number) => [this.theme.fg(color, truncateToWidth(text(), width))],
			invalidate: () => {},
		};
	}

	private buildList(): SelectList {
		const needle = this.filter.toLowerCase();
		const matches = this.rows.filter(
			({ item }) => !needle || `${item.label} ${item.description}`.toLowerCase().includes(needle),
		);
		const empty: SelectItem = {
			value: "",
			label: this.rows.length === 0 ? "No tasks here yet" : "Nothing matches that filter",
			description: this.rows.length === 0 ? "ctrl+n creates one" : "backspace to clear",
		};
		const list = new SelectList(
			matches.length > 0 ? matches.map((row) => row.item) : [empty],
			Math.min(Math.max(matches.length, 1), MAX_VISIBLE),
			selectListTheme(this.theme),
			LIST_LAYOUT,
		);
		list.onSelect = (item) => {
			const row = this.rows.find((candidate) => candidate.item.value === item.value);
			if (row) this.done({ kind: "attach", task: row.task });
		};
		list.onCancel = () => this.done({ kind: "close" });
		return list;
	}

	private refilter(next: string): void {
		this.filter = next;
		this.selectList = this.buildList();
		this.container.children[LIST_SLOT] = this.selectList;
		this.tui.requestRender();
	}

	private selectedTask(): Task | undefined {
		return this.rows.find((row) => row.item.value === this.selectList.getSelectedItem()?.value)?.task;
	}

	render(width: number): string[] {
		return this.container.render(width);
	}

	invalidate(): void {
		this.container.invalidate();
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.ctrl("n"))) this.done({ kind: "new" });
		else if (matchesKey(data, Key.ctrl("d"))) {
			const task = this.selectedTask();
			if (task) this.done({ kind: "done", task });
		} else if (matchesKey(data, Key.ctrl("s"))) {
			const task = this.selectedTask();
			if (task) this.done({ kind: "status", task });
		} else if (matchesKey(data, Key.ctrl("r"))) {
			const task = this.selectedTask();
			if (task) this.done({ kind: "references", task });
		} else if (matchesKey(data, Key.ctrl("x"))) {
			if (this.options.attachedPath) this.done({ kind: "detach" });
		} else if (matchesKey(data, Key.tab)) this.done({ kind: "toggleInactive" });
		else if (matchesKey(data, Key.backspace)) this.refilter(this.filter.slice(0, -1));
		else {
			const printable = printableInput(data);
			if (printable !== undefined) this.refilter(this.filter + printable);
			else {
				this.selectList.handleInput(data);
				this.tui.requestRender();
			}
		}
	}
}

export function openTaskPicker(ctx: ExtensionCommandContext, options: TaskPickerOptions): Promise<PickerAction> {
	return new Promise((resolve, reject) => {
		let picker: TaskPicker | undefined;
		let settled = false;
		let unsubscribe = () => {};
		let subscriptionReady = false;
		let cleanupRequested = false;

		const cleanup = () => {
			cleanupRequested = true;
			if (subscriptionReady) unsubscribe();
			try { ctx.ui.setWidget(TASK_PICKER_WIDGET_KEY, undefined); } catch {}
		};
		const done = (action: PickerAction) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(action);
		};
		const fail = (error: unknown) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};

		try {
			ctx.ui.setWidget(
				TASK_PICKER_WIDGET_KEY,
				(tui, theme) => {
					picker = new TaskPicker(tui, theme, options, done, ctx.cwd);
					return picker;
				},
				{ placement: "aboveEditor" },
			);
			unsubscribe = ctx.ui.onTerminalInput((data) => {
				try { picker?.handleInput(data); } catch (error) { fail(error); }
				return { consume: true };
			});
			subscriptionReady = true;
			if (cleanupRequested) unsubscribe();
		} catch (error) {
			fail(error);
		}
	});
}
