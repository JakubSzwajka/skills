import { DynamicBorder, getSelectListTheme, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	Container,
	Key,
	matchesKey,
	SelectList,
	truncateToWidth,
	type Component,
	type SelectItem,
} from "@earendil-works/pi-tui";
import { lastActivity, relativeTime, sessionCount, tasksDir, type Task } from "./store.ts";

export type PickerAction =
	| { kind: "attach"; task: Task }
	| { kind: "new" }
	| { kind: "done"; task: Task }
	| { kind: "detach" }
	| { kind: "toggleDone" }
	| { kind: "close" };

const MAX_VISIBLE = 12;
const LIST_SLOT = 2;
const LIST_LAYOUT = { minPrimaryColumnWidth: 24, maxPrimaryColumnWidth: 52 };

function describe(task: Task): string {
	const parts = [
		task.entries.length === 1 ? "1 entry" : `${task.entries.length} entries`,
		`${sessionCount(task)} sessions`,
		relativeTime(lastActivity(task)),
	];
	if (task.status === "done") parts.unshift("done");
	return parts.join(" · ");
}

function isPrintable(data: string): boolean {
	return data.length > 0 && !/[\u0000-\u001f\u007f]/.test(data);
}

/** One screen for the whole task workflow. Enter attaches, ctrl keys do the rest, typing filters. */
export async function openTaskPicker(
	ctx: ExtensionCommandContext,
	options: { tasks: Task[]; attachedPath?: string; showDone: boolean },
): Promise<PickerAction> {
	const { tasks, attachedPath, showDone } = options;

	const rows = tasks.map((task) => ({
		task,
		item: {
			value: task.path,
			label: `${task.path === attachedPath ? "● " : "  "}${task.title}`,
			description: describe(task),
		} satisfies SelectItem,
	}));

	const attachedTitle = tasks.find((task) => task.path === attachedPath)?.title;

	const result = await ctx.ui.custom<PickerAction>((tui, theme, _kb, done) => {
		const container = new Container();
		const listTheme = getSelectListTheme();
		let filter = "";

		const headline = attachedTitle ? `Tasks · attached: ${attachedTitle}` : `Tasks · ${tasksDir(ctx.cwd)}`;
		const hints = [
			"enter attach",
			"ctrl+n new",
			rows.length > 0 ? "ctrl+d done" : "",
			attachedPath ? "ctrl+x detach" : "",
			showDone ? "tab hide done" : "tab show done",
			"esc close",
		].filter(Boolean);

		const line = (text: () => string, color: "accent" | "dim"): Component => ({
			render: (width: number) => [theme.fg(color, truncateToWidth(text(), width))],
			invalidate: () => {},
		});

		const buildList = (): SelectList => {
			const needle = filter.toLowerCase();
			const matches = rows.filter(
				({ item }) => !needle || `${item.label} ${item.description}`.toLowerCase().includes(needle),
			);
			const empty: SelectItem = {
				value: "",
				label: rows.length === 0 ? "No tasks here yet" : "Nothing matches that filter",
				description: rows.length === 0 ? "ctrl+n creates one" : "backspace to clear",
			};

			const list = new SelectList(
				matches.length > 0 ? matches.map((row) => row.item) : [empty],
				Math.min(Math.max(matches.length, 1), MAX_VISIBLE),
				listTheme,
				LIST_LAYOUT,
			);
			list.onSelect = (item) => {
				const row = rows.find((candidate) => candidate.item.value === item.value);
				if (row) done({ kind: "attach", task: row.task });
			};
			list.onCancel = () => done({ kind: "close" });
			return list;
		};

		let selectList = buildList();
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		container.addChild(line(() => headline, "accent"));
		container.addChild(selectList);
		container.addChild(line(() => (filter ? `filter: ${filter}` : hints.join(" · ")), "dim"));
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		const refilter = (next: string) => {
			filter = next;
			selectList = buildList();
			container.children[LIST_SLOT] = selectList;
			tui.requestRender();
		};

		const selectedTask = () => rows.find((row) => row.item.value === selectList.getSelectedItem()?.value)?.task;

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, Key.ctrl("n"))) {
					done({ kind: "new" });
				} else if (matchesKey(data, Key.ctrl("d"))) {
					const task = selectedTask();
					if (task) done({ kind: "done", task });
				} else if (matchesKey(data, Key.ctrl("x"))) {
					if (attachedPath) done({ kind: "detach" });
				} else if (matchesKey(data, Key.tab)) {
					done({ kind: "toggleDone" });
				} else if (matchesKey(data, Key.backspace)) {
					refilter(filter.slice(0, -1));
				} else if (isPrintable(data)) {
					refilter(filter + data);
				} else {
					selectList.handleInput(data);
					tui.requestRender();
				}
			},
		};
	});

	return result ?? { kind: "close" };
}
