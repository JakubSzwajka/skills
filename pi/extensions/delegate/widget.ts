import { access, open, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { readRegistry } from "./registry.ts";
import type { LaneStatus } from "./types.ts";
import { statusRank } from "./types.ts";

/** What the widget needs to know about one lane. */
export interface LaneView {
	lane: string;
	profile: string;
	status: LaneStatus | string;
	/** The lane's model id, joined as `provider/id[:thinking]`, or null when the record has none. */
	model: string | null;
	contextPct: number | null;
	spendUsd: number | null;
	rang: boolean;
	unread: boolean;
	/** Whether the handoff has been read. Only a finished lane shows it, as `read` or `no handoff`. */
	read?: boolean;
	/** A lane this session has finished with: stopped, or closed by the refresh. Dimmed, kept on screen. */
	finished?: boolean;
	/** When the lane closed, ISO, used only to order the finished group. */
	finishedAt?: string;
}

export type Tone = "label" | "text" | "muted" | "dim" | "attention" | "notice" | "ok";
export interface Cell { text: string; tone: Tone; bold?: boolean; align?: "right" }
export interface Row { cells: Cell[]; indent: number }

/** Paints one cell. The extension passes a theme-backed painter; tests pass identity. */
export type Paint = (text: string, tone: Tone, bold: boolean) => string;

const CHUNK_BYTES = 4 * 1024 * 1024;
const NAME_LIMIT = 24;
const PROFILE_LIMIT = 10;
// Model ids run long and none of them is validated, so the column is clipped exactly as the lane
// name column is: no id can push the status and note columns sideways.
const MODEL_LIMIT = 24;
const GAP = 2;
const RULE_CHAR = "\u2500";

export function laneRows(lanes: readonly LaneView[]): Row[] {
	const sorted = sortLaneViews(lanes);
	const live = sorted.filter((lane) => !lane.finished);
	const finished = sorted.filter((lane) => lane.finished);
	const header: Row = { indent: 0, cells: [{ text: "delegate", tone: "label", bold: true }, { text: headerSummary(live, finished, sorted), tone: "dim" }] };
	return [header, ...sorted.map((lane) => ({ indent: 2, cells: laneCells(lane) }))];
}

/**
 * `1 live · 3 done · $12.40`, with the count of lanes that still need the operator kept in the
 * middle when there is one. Spend is the session total across live and finished lanes, so closing a
 * lane never makes the bill look smaller than it is.
 */
function headerSummary(live: readonly LaneView[], finished: readonly LaneView[], all: readonly LaneView[]): string {
	const needing = all.filter(needsOperator).length;
	const spend = sessionSpend(all);
	return [
		`${live.length} live`,
		...(finished.length ? [`${finished.length} done`] : []),
		...(needing ? [`${needing} need${needing === 1 ? "s" : ""} you`] : []),
		...(spend === null ? [] : [`$${spend.toFixed(2)}`]),
	].join(" · ");
}

export function sessionSpend(lanes: readonly LaneView[]): number | null {
	const reported = lanes.filter((lane) => lane.spendUsd !== null);
	if (!reported.length) return null;
	return Math.round(reported.reduce((total, lane) => total + Number(lane.spendUsd), 0) * 100) / 100;
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
	return sortLaneViews(lanes).map((lane) => [lane.lane, lane.profile, lane.model ?? "", lane.status, lane.contextPct ?? "", lane.spendUsd ?? "", lane.rang ? 1 : 0, lane.unread ? 1 : 0, lane.read ? 1 : 0, lane.finished ? 1 : 0].join("\u0001")).join("\u0002");
}

/**
 * Live lanes first, in the order that puts what needs the operator on top. Finished lanes below
 * them, oldest first, so a lane that closes appends to the bottom of the list instead of pushing
 * the finished rows already on screen down by one every time.
 */
export function sortLaneViews(lanes: readonly LaneView[]): LaneView[] {
	return [...lanes].sort((left, right) => Number(Boolean(left.finished)) - Number(Boolean(right.finished))
		|| (left.finished
			? (left.finishedAt ?? "").localeCompare(right.finishedAt ?? "")
			: statusRank(left.status) - statusRank(right.status))
		|| left.lane.localeCompare(right.lane));
}

function laneCells(lane: LaneView): Cell[] {
	if (lane.finished) return finishedCells(lane);
	const blocked = lane.status === "blocked";
	return [
		{ text: blocked ? "!" : lane.unread ? "•" : " ", tone: blocked ? "attention" : lane.unread ? "notice" : "dim", bold: blocked },
		{ text: clip(lane.lane, NAME_LIMIT), tone: "text", bold: blocked },
		{ text: clip(lane.profile, PROFILE_LIMIT), tone: "muted" },
		{ text: shortModel(lane.model), tone: "muted" },
		statusCell(lane.status),
		{ text: lane.contextPct === null ? "— ctx" : `${trimNumber(lane.contextPct)}% ctx`, tone: "muted", align: "right" },
		{ text: spendText(lane.spendUsd), tone: "muted", align: "right" },
		noteCell(lane),
	];
}

/**
 * A lane this session finished with. Everything is dim except an uncollected handoff, which stays
 * loud: the lane is over, but the work still has not reached the operator.
 */
function finishedCells(lane: LaneView): Cell[] {
	return [
		{ text: lane.unread ? "•" : " ", tone: lane.unread ? "notice" : "dim" },
		{ text: clip(lane.lane, NAME_LIMIT), tone: "dim" },
		{ text: clip(lane.profile, PROFILE_LIMIT), tone: "dim" },
		{ text: shortModel(lane.model), tone: "dim" },
		{ text: "done", tone: "dim" },
		// A closed lane's context use is history nobody can act on, so the column carries the group's
		// dash instead of a frozen percentage. Left in its column, because a dash pushed to the right
		// edge of a `28% ctx` column reads as a gap. Its final spend stays, because the bill does not.
		{ text: "—", tone: "dim" },
		{ text: spendText(lane.spendUsd), tone: "dim", align: "right" },
		finishedNote(lane),
	];
}

/**
 * A finished lane's one useful fact: whether the operator collected it. `no handoff` is its own word
 * because a lane that was stopped before it wrote anything did not produce work to read.
 */
function finishedNote(lane: LaneView): Cell {
	if (lane.unread) return { text: "unread handoff", tone: "notice" };
	return { text: lane.read ? "read" : "no handoff", tone: "dim" };
}

/**
 * The provider prefix is the same on every lane an orchestrator runs, so it costs a column and says
 * nothing. `openai-codex/gpt-5.6-sol:high` reads as `gpt-5.6-sol:high`, and a bare dotted id such as
 * `global.anthropic.claude-opus-5` survives whole until it hits the limit.
 */
export function shortModel(model: string | null | undefined): string {
	if (!model) return "—";
	const bare = model.slice(model.lastIndexOf("/") + 1).trim();
	return clip(bare || model.trim(), MODEL_LIMIT);
}

function spendText(spend: number | null): string { return spend === null ? "—" : `$${Number(spend).toFixed(2)}`; }

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
	/** Session-scoped memory of finished lanes, so retention pruning cannot erase this session's history. */
	finished?: ClosedLaneMemory;
	contextWindow?: (model: string) => number | null;
}

/**
 * Remembers the lanes this session finished with, for as long as the session lives.
 *
 * The registry drops a closed record 24 hours after it closed, and a long session would watch its
 * own history disappear mid-run. Keying on lane name plus start time keeps a later lane that reuses
 * a name from inheriting the old one's row.
 */
export class ClosedLaneMemory {
	private readonly lanes = new Map<string, { view: LaneView; handoff: string }>();

	static key(lane: string, started: string): string { return `${lane}\u0000${started}`; }

	/** Records a finished lane, keeping the last spend figure it ever reported. */
	remember(key: string, view: LaneView, handoff: string): LaneView {
		const previous = this.lanes.get(key);
		const merged: LaneView = { ...view, spendUsd: view.spendUsd ?? previous?.view.spendUsd ?? null };
		this.lanes.set(key, { view: merged, handoff });
		return merged;
	}

	/** The remembered lanes whose keys the registry no longer carries. */
	forgottenBy(present: ReadonlySet<string>): Array<{ key: string; view: LaneView; handoff: string }> {
		return [...this.lanes].filter(([key]) => !present.has(key)).map(([key, entry]) => ({ key, ...entry }));
	}

	update(key: string, view: LaneView, handoff: string): void { this.lanes.set(key, { view, handoff }); }
	get size(): number { return this.lanes.size; }
}

/**
 * Build the widget's lane views straight from the registry files plus the filesystem.
 * No subprocess runs here: statuses are whatever the last full delegate refresh wrote.
 *
 * A closed lane stays visible, but only when this session owns it. Ownership, not the working
 * directory, is the test: another parent working in the same checkout would otherwise leave dimmed
 * rows for lanes this session never ran. An adopted lane has had its ownership rewritten to this
 * session, so it counts as ours once we are the one who closed it.
 */
export async function sampleLaneViews(options: SampleOptions): Promise<LaneView[]> {
	let entries;
	try { entries = await readdir(options.root, { withFileTypes: true }); }
	catch { return []; }
	const views: LaneView[] = [];
	const sessionFiles: string[] = [];
	const present = new Set<string>();
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		for (const record of (await readRegistry(join(options.root, entry.name, "lanes.json"))).lanes) {
			const ours = record.ownerSession === options.parentId;
			if (record.closed ? !ours : !(ours || record.cwd === options.cwd)) continue;
			const stats = record.sessionFile
				? await options.watcher.sample(record.sessionFile, options.contextWindow?.(record.model ?? "") ?? null)
				: { contextPct: null, spendUsd: null };
			if (record.sessionFile) sessionFiles.push(record.sessionFile);
			const view: LaneView = {
				lane: record.lane,
				profile: record.profile,
				status: record.status ?? "pending",
				model: record.model ?? null,
				contextPct: stats.contextPct,
				spendUsd: stats.spendUsd,
				rang: Boolean(record.rang),
				unread: !record.read && await fileExists(record.handoff),
				read: record.read,
				...(record.closed ? { finished: true, finishedAt: record.closedAt ?? record.started } : {}),
			};
			const key = ClosedLaneMemory.key(record.lane, record.started);
			present.add(key);
			views.push(record.closed && options.finished ? options.finished.remember(key, view, record.handoff) : view);
		}
	}
	// A record the retention window pruned is still work this session did, so its remembered row stays.
	// Only the handoff is re-checked, because that is the one part of it that can still change.
	for (const { key, view, handoff } of options.finished?.forgottenBy(present) ?? []) {
		const refreshed: LaneView = { ...view, unread: view.unread && await fileExists(handoff) };
		options.finished?.update(key, refreshed, handoff);
		views.push(refreshed);
	}
	options.watcher.prune(sessionFiles);
	return sortLaneViews(views);
}

function fileExists(path: string): Promise<boolean> { return access(path, constants.F_OK).then(() => true, () => false); }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
