import { access, open, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { readRegistry } from "./registry.ts";
import type { LaneStatus } from "./types.ts";

/** What the widget needs to know about one lane. */
export interface LaneView {
	lane: string;
	profile: string;
	status: LaneStatus | string;
	contextPct: number | null;
	spendUsd: number | null;
	rang: boolean;
	unread: boolean;
}

export type Tone = "label" | "text" | "muted" | "dim" | "attention" | "notice" | "ok";
export interface Cell { text: string; tone: Tone; bold?: boolean; align?: "right" }
export interface Row { cells: Cell[]; indent: number }

/** Paints one cell. The extension passes a theme-backed painter; tests pass identity. */
export type Paint = (text: string, tone: Tone, bold: boolean) => string;

const CHUNK_BYTES = 4 * 1024 * 1024;
const NAME_LIMIT = 24;
const PROFILE_LIMIT = 10;
const GAP = 2;
const RULE_CHAR = "\u2500";

export function laneRows(lanes: readonly LaneView[]): Row[] {
	const sorted = sortLaneViews(lanes);
	const needing = sorted.filter(needsOperator).length;
	const summary = `${sorted.length} lane${sorted.length === 1 ? "" : "s"}${needing ? ` · ${needing} need${needing === 1 ? "s" : ""} you` : ""}`;
	const header: Row = { indent: 0, cells: [{ text: "delegate", tone: "label", bold: true }, { text: summary, tone: "dim" }] };
	return [header, ...sorted.map((lane) => ({ indent: 2, cells: laneCells(lane) }))];
}

export function renderRows(rows: readonly Row[], width: number, paint: Paint): string[] {
	const body = rows.filter((row) => row.indent > 0);
	const widths: number[] = [];
	for (const row of body) row.cells.forEach((cell, index) => { widths[index] = Math.max(widths[index] ?? 0, cell.text.length); });
	return rows.map((row) => {
		const columns = row.indent > 0 ? widths : row.cells.map((cell) => cell.text.length);
		let plain = " ".repeat(row.indent);
		let painted = " ".repeat(row.indent);
		for (const [index, cell] of row.cells.entries()) {
			const target = columns[index] ?? cell.text.length;
			const padded = cell.align === "right" ? cell.text.padStart(target) : cell.text.padEnd(target);
			const separator = index === 0 ? "" : " ".repeat(GAP);
			const last = index === row.cells.length - 1;
			const piece = last ? padded.trimEnd() : padded;
			if (!piece.trim() && last) break;
			if (plain.length + separator.length + piece.length > width) {
				const room = width - plain.length - separator.length;
				if (room <= 1) break;
				plain += separator + clip(piece, room);
				painted += separator + paint(clip(piece, room), cell.tone, cell.bold ?? false);
				break;
			}
			plain += separator + piece;
			painted += separator + paint(piece, cell.tone, cell.bold ?? false);
		}
		return painted;
	});
}

/**
 * One muted rule across the top, so the widget reads as its own block instead of the tail of the
 * todo list above it. Painted through the same `Paint` the rows use, so the color comes from the
 * theme and a theme switch repaints it.
 */
export function separatorLine(width: number, paint: Paint): string | undefined {
	if (width < 1) return undefined;
	return paint(RULE_CHAR.repeat(width), "dim", false);
}

/** The widget's own lines: the rule, then the rows. No lane row means no widget, so no rule either. */
function widgetLines(rows: readonly Row[], width: number, paint: Paint): string[] {
	if (!rows.some((row) => row.indent > 0)) return [];
	const rule = separatorLine(width, paint);
	const body = renderRows(rows, width, paint);
	return rule === undefined ? body : [rule, ...body];
}

export function renderWidget(lanes: readonly LaneView[], width: number, paint: Paint): string[] {
	return widgetLines(laneRows(lanes), width, paint);
}

/** The slice of pi's Theme the widget uses. Declared with method syntax so the real Theme is assignable. */
export interface ThemeLike {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

const TONE_COLORS: Record<Tone, string> = {
	label: "accent",
	text: "text",
	muted: "muted",
	dim: "dim",
	attention: "error",
	notice: "warning",
	ok: "success",
};

/** Builds the component factory `ui.setWidget` accepts. Colors are applied at render time, so a theme change repaints. */
export function laneWidgetFactory(lanes: readonly LaneView[]): (tui: unknown, theme: ThemeLike) => LaneWidgetComponent {
	const rows = laneRows(lanes);
	return (_tui: unknown, theme: ThemeLike) => new LaneWidgetComponent(rows, theme);
}

export class LaneWidgetComponent {
	private cachedWidth?: number;
	private cachedLines?: string[];
	private readonly rows: Row[];
	private readonly theme: ThemeLike;

	constructor(rows: Row[], theme: ThemeLike) {
		this.rows = rows;
		this.theme = theme;
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		// An unknown color throws inside the host renderer, outside the tick's catch, so a bad tone
		// costs its color and nothing else.
		const paint: Paint = (text, tone, bold) => {
			const body = bold ? this.theme.bold(text) : text;
			try { return this.theme.fg(TONE_COLORS[tone], body); }
			catch { return body; }
		};
		this.cachedLines = widgetLines(this.rows, Math.max(width - 1, 1), paint).map((line) => ` ${line}`);
		this.cachedWidth = width;
		return this.cachedLines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

/** Cheap identity of what the widget shows. Equal signature means no repaint is needed. */
export function laneSignature(lanes: readonly LaneView[]): string {
	return sortLaneViews(lanes).map((lane) => [lane.lane, lane.profile, lane.status, lane.contextPct ?? "", lane.spendUsd ?? "", lane.rang ? 1 : 0, lane.unread ? 1 : 0].join("\u0001")).join("\u0002");
}

export function sortLaneViews(lanes: readonly LaneView[]): LaneView[] {
	return [...lanes].sort((left, right) => statusRank(left.status) - statusRank(right.status) || left.lane.localeCompare(right.lane));
}

function laneCells(lane: LaneView): Cell[] {
	const blocked = lane.status === "blocked";
	return [
		{ text: blocked ? "!" : lane.unread ? "•" : " ", tone: blocked ? "attention" : lane.unread ? "notice" : "dim", bold: blocked },
		{ text: clip(lane.lane, NAME_LIMIT), tone: "text", bold: blocked },
		{ text: clip(lane.profile, PROFILE_LIMIT), tone: "muted" },
		statusCell(lane.status),
		{ text: lane.contextPct === null ? "— ctx" : `${trimNumber(lane.contextPct)}% ctx`, tone: "muted", align: "right" },
		{ text: lane.spendUsd === null ? "—" : `$${Number(lane.spendUsd).toFixed(2)}`, tone: "muted", align: "right" },
		noteCell(lane),
	];
}

function statusCell(status: string): Cell {
	if (status === "blocked") return { text: "BLOCKED", tone: "attention", bold: true };
	if (status === "working") return { text: "working", tone: "text" };
	if (status === "done") return { text: "done", tone: "ok" };
	return { text: status, tone: "muted" };
}

function noteCell(lane: LaneView): Cell {
	if (lane.status === "blocked") return { text: "needs you", tone: "attention", bold: true };
	if (lane.unread) return { text: "unread handoff", tone: "notice" };
	if (lane.rang) return { text: "rang", tone: "dim" };
	return { text: "", tone: "dim" };
}

function needsOperator(lane: LaneView): boolean { return lane.status === "blocked" || lane.unread; }
function statusRank(status: string): number { return status === "blocked" ? 0 : status === "working" ? 1 : status === "done" || status === "idle" ? 2 : status === "unknown" || status === "pending" ? 3 : 4; }
function trimNumber(value: number): string { return String(Math.round(value * 10) / 10); }

export function clip(text: string, limit: number): string {
	if (limit <= 0) return "";
	if (text.length <= limit) return text;
	return limit === 1 ? "…" : `${text.slice(0, limit - 1)}…`;
}

/**
 * Incremental reader for a worker's session file. Each sample reads only the bytes appended
 * since the previous sample, so a one-second widget tick costs a stat plus a short tail read
 * per lane instead of parsing the whole transcript again.
 */
export class SessionStatsWatcher {
	private readonly files = new Map<string, FileState>();

	async sample(path: string, configuredWindow: number | null): Promise<{ contextPct: number | null; spendUsd: number | null }> {
		let size: number;
		let inode: number;
		try { const info = await stat(path); size = info.size; inode = info.ino; }
		catch { return { contextPct: null, spendUsd: null }; }
		let state = this.files.get(path);
		// A shrunk file was truncated; a new inode means a different file took the path. Either way the
		// old offset points into bytes that are gone, so the tally restarts.
		if (!state || size < state.offset || inode !== state.inode) {
			state = { offset: 0, inode, decoder: new StringDecoder("utf8"), partial: "", tokens: null, spend: 0, sawCost: false };
			this.files.set(path, state);
		}
		if (size > state.offset) await this.consume(path, state, size);
		return statsOf(state, configuredWindow);
	}

	/** Drop watchers for lanes that no longer exist so a long session does not accumulate state. */
	prune(live: Iterable<string>): void {
		const keep = new Set(live);
		for (const path of [...this.files.keys()]) if (!keep.has(path)) this.files.delete(path);
	}

	private async consume(path: string, state: FileState, size: number): Promise<void> {
		let handle;
		try { handle = await open(path, "r"); }
		catch { return; }
		try {
			const buffer = Buffer.alloc(Math.min(size - state.offset, CHUNK_BYTES));
			while (state.offset < size) {
				const { bytesRead } = await handle.read(buffer, 0, buffer.length, state.offset);
				if (!bytesRead) break;
				state.offset += bytesRead;
				const text = state.partial + state.decoder.write(buffer.subarray(0, bytesRead));
				const lines = text.split("\n");
				state.partial = lines.pop() ?? "";
				for (const line of lines) absorb(state, line);
			}
		} finally {
			await handle.close();
		}
	}
}

interface FileState {
	offset: number;
	inode: number;
	decoder: StringDecoder;
	partial: string;
	tokens: number | null;
	spend: number;
	sawCost: boolean;
}

function absorb(state: FileState, line: string): void {
	if (!line.trim()) return;
	let parsed: unknown;
	try { parsed = JSON.parse(line); }
	catch { return; }
	if (!isObject(parsed) || !isObject(parsed.message) || parsed.message.role !== "assistant") return;
	const usage = isObject(parsed.message.usage) ? parsed.message.usage : undefined;
	const total = numberValue(usage?.totalTokens);
	if (total !== undefined) state.tokens = total;
	const cost = isObject(usage?.cost) ? numberValue(usage.cost.total) : undefined;
	if (cost !== undefined) { state.spend += cost; state.sawCost = true; }
}

// The transcript carries no context window of its own: assistant entries hold role, content, api,
// provider, model, usage and stopReason, and nothing else. The window comes from the model registry
// or not at all, and a lookup miss shows "— ctx".
function statsOf(state: FileState, window: number | null): { contextPct: number | null; spendUsd: number | null } {
	return {
		contextPct: state.tokens !== null && window ? Math.round(state.tokens / window * 1_000) / 10 : null,
		spendUsd: state.sawCost ? Math.round(state.spend * 1000) / 1000 : null,
	};
}

export interface SampleOptions {
	root: string;
	cwd: string;
	parentId: string;
	watcher: SessionStatsWatcher;
	contextWindow?: (model: string) => number | null;
}

/**
 * Build the widget's lane views straight from the registry files plus the filesystem.
 * No subprocess runs here: statuses are whatever the last full delegate refresh wrote.
 */
export async function sampleLaneViews(options: SampleOptions): Promise<LaneView[]> {
	let entries;
	try { entries = await readdir(options.root, { withFileTypes: true }); }
	catch { return []; }
	const views: LaneView[] = [];
	const sessionFiles: string[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		for (const record of (await readRegistry(join(options.root, entry.name, "lanes.json"))).lanes) {
			if (record.closed || (record.cwd !== options.cwd && record.ownerSession !== options.parentId)) continue;
			const stats = record.sessionFile
				? await options.watcher.sample(record.sessionFile, options.contextWindow?.(record.model ?? "") ?? null)
				: { contextPct: null, spendUsd: null };
			if (record.sessionFile) sessionFiles.push(record.sessionFile);
			views.push({
				lane: record.lane,
				profile: record.profile,
				status: record.status ?? "pending",
				contextPct: stats.contextPct,
				spendUsd: stats.spendUsd,
				rang: Boolean(record.rang),
				unread: !record.read && await fileExists(record.handoff),
			});
		}
	}
	options.watcher.prune(sessionFiles);
	return sortLaneViews(views);
}

function fileExists(path: string): Promise<boolean> { return access(path, constants.F_OK).then(() => true, () => false); }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
