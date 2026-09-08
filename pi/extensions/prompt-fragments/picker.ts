import { DynamicBorder, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, Key, matchesKey, truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { FragmentPlacement, PromptFragment } from "./fragments.ts";

const MAX_ROWS_PER_SECTION = 5;

/** Strip terminal sequences and flatten controls before rendering fragment-supplied text. */
export function sanitizeFragmentDisplay(value: string): string {
	return value
		.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b[P_X^][\s\S]*?\x1b\\/g, "")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/\x1b[@-_]/g, "")
		.replace(/\u009d[^\u0007\u009c]*(?:\u0007|\u009c)/g, "")
		.replace(/[\u0090\u0098\u009e\u009f][\s\S]*?\u009c/g, "")
		.replace(/\u009b[0-?]*[ -/]*[@-~]/g, "")
		.replace(/\t/g, "    ")
		.replace(/\r\n?|\n/g, " ")
		.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

export const FRAGMENT_PICKER_WIDGET_KEY = "prompt-fragments:picker";
export type FragmentPickerResult = PromptFragment[] | "open-global" | "open-project" | undefined;

export class FragmentPicker implements Component {
	private cursor = 0;
	private readonly checked = new Set<number>();
	private readonly offsets: Record<FragmentPlacement, number> = { before: 0, after: 0 };
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly border: DynamicBorder;
	private readonly fragments: readonly PromptFragment[];
	private readonly done: (result: FragmentPickerResult) => void;

	constructor(
		tui: TUI,
		theme: Theme,
		fragments: readonly PromptFragment[],
		done: (result: FragmentPickerResult) => void,
	) {
		this.tui = tui;
		this.theme = theme;
		this.border = new DynamicBorder((text: string) => theme.fg("accent", text));
		this.fragments = [
			...fragments.filter((fragment) => fragment.placement === "before"),
			...fragments.filter((fragment) => fragment.placement === "after"),
		];
		this.done = done;
	}

	private group(placement: FragmentPlacement): Array<{ fragment: PromptFragment; index: number }> {
		return this.fragments.flatMap((fragment, index) => fragment.placement === placement ? [{ fragment, index }] : []);
	}

	private keepVisible(): void {
		const current = this.fragments[this.cursor];
		if (!current) return;
		const group = this.group(current.placement);
		const localIndex = group.findIndex(({ index }) => index === this.cursor);
		let offset = this.offsets[current.placement];
		if (localIndex < offset) offset = localIndex;
		if (localIndex >= offset + MAX_ROWS_PER_SECTION) offset = localIndex - MAX_ROWS_PER_SECTION + 1;
		this.offsets[current.placement] = Math.max(0, offset);
	}

	private move(delta: number): void {
		if (this.fragments.length === 0) return;
		this.cursor = Math.max(0, Math.min(this.fragments.length - 1, this.cursor + delta));
		this.keepVisible();
		this.tui.requestRender();
	}

	private renderGroup(placement: FragmentPlacement, width: number): string[] {
		const label = placement === "before" ? "Before" : "After";
		const group = this.group(placement);
		const lines = [this.theme.bold(this.theme.fg("accent", `${label} (${group.length})`))];
		if (group.length === 0) return [...lines, this.theme.fg("dim", "  No fragments")];

		const maxOffset = Math.max(0, group.length - MAX_ROWS_PER_SECTION);
		const offset = Math.min(this.offsets[placement], maxOffset);
		for (const { fragment, index } of group.slice(offset, offset + MAX_ROWS_PER_SECTION)) {
			const marker = index === this.cursor ? ">" : " ";
			const checkbox = this.checked.has(index) ? "[x]" : "[ ]";
			const title = sanitizeFragmentDisplay(fragment.title);
			const safeDescription = sanitizeFragmentDisplay(fragment.description);
			const description = safeDescription ? ` — ${safeDescription}` : "";
			const text = truncateToWidth(`${marker} ${checkbox} ${title} · ${fragment.scope}${description}`, width);
			lines.push(index === this.cursor ? this.theme.bg("selectedBg", text) : text);
		}
		if (group.length > MAX_ROWS_PER_SECTION) {
			lines.push(this.theme.fg("dim", `  items ${offset + 1}–${Math.min(offset + MAX_ROWS_PER_SECTION, group.length)} of ${group.length}`));
		}
		return lines;
	}

	render(width: number): string[] {
		const content = [
			this.theme.bold(this.theme.fg("accent", "Prompt fragments")),
			...this.renderGroup("before", width),
			"",
			...this.renderGroup("after", width),
			"",
			this.theme.fg("dim", "↑/↓ navigate · space toggle · enter apply · esc cancel"),
			this.theme.fg("dim", "n open global dir · ⇧n open project dir"),
		].map((line) => truncateToWidth(line, width));
		return [...this.border.render(width), ...content, ...this.border.render(width)];
	}

	invalidate(): void {
		this.border.invalidate();
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;
		if (matchesKey(data, Key.up)) this.move(-1);
		else if (matchesKey(data, Key.down)) this.move(1);
		else if (matchesKey(data, Key.home)) this.move(-this.fragments.length);
		else if (matchesKey(data, Key.end)) this.move(this.fragments.length);
		else if (matchesKey(data, Key.space)) {
			if (this.fragments[this.cursor]) {
				this.checked.has(this.cursor) ? this.checked.delete(this.cursor) : this.checked.add(this.cursor);
				this.tui.requestRender();
			}
		} else if (data === "n") {
			this.done("open-global");
		} else if (data === "N" || matchesKey(data, Key.shift("n"))) {
			this.done("open-project");
		} else if (matchesKey(data, Key.enter)) {
			this.done(this.fragments.filter((_fragment, index) => this.checked.has(index)));
		} else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.done(undefined);
		}
	}
}

export async function openFragmentPicker(
	ctx: ExtensionContext,
	fragments: readonly PromptFragment[],
): Promise<FragmentPickerResult> {
	return new Promise((resolve) => {
		let picker: FragmentPicker | undefined;
		let settled = false;
		let unsubscribe = () => {};

		const done = (result: FragmentPickerResult) => {
			if (settled) return;
			settled = true;
			unsubscribe();
			ctx.ui.setWidget(FRAGMENT_PICKER_WIDGET_KEY, undefined);
			resolve(result);
		};

		ctx.ui.setWidget(
			FRAGMENT_PICKER_WIDGET_KEY,
			(tui, theme) => {
				picker = new FragmentPicker(tui, theme, fragments, done);
				return picker;
			},
			{ placement: "aboveEditor" },
		);

		unsubscribe = ctx.ui.onTerminalInput((data) => {
			picker?.handleInput(data);
			return { consume: true };
		});
	});
}
