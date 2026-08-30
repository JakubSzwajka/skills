import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { readTextPreview, readTranscriptPreview } from "./artifacts.ts";
import { collectHistory } from "./collector.ts";
import { aggregate, attemptSummary, fit, formatDuration, formatTimelineTime, sanitizeDisplayText, visibleRows, wrap, type TreeRow } from "./render.ts";
import type { AttemptRecord, HistorySnapshot } from "./types.ts";

type DetailTab = "summary" | "prompt" | "transcript" | "activity" | "output";
const ACTIVE = new Set(["queued", "running"]);
export const HISTORY_OVERLAY_OPTIONS = {
	overlay: true,
	overlayOptions: { anchor: "center", width: "90%", minWidth: 48, maxHeight: "85%", margin: 1 },
} as const;
const activeViewClosers = new Set<() => void>();
export function disposeHistoryViews(): void { for (const close of [...activeViewClosers]) close(); activeViewClosers.clear(); }

function terminalRows(tui: TUI): number {
	const rows = (tui as unknown as { terminal?: { rows?: number } }).terminal?.rows;
	return typeof rows === "number" && Number.isFinite(rows) ? Math.max(8, Math.floor(rows * 0.85)) : 20;
}
function stateIcon(state?: string): string { return ({ pending: "○", queued: "◌", running: "●", complete: "✓", failed: "✗", paused: "■", stopped: "■", rejected: "⊘" } as Record<string, string>)[state ?? ""] ?? "?"; }
function isAttempt(row: TreeRow | undefined): row is TreeRow & { attempt: AttemptRecord } { return !!row?.attempt; }
function framedRule(width: number, label = "", left = "├", right = "┤"): string {
	if (width <= 0) return "";
	if (width === 1) return left;
	const prefix = label ? `${left}─ ${sanitizeDisplayText(label)} ` : left;
	const clipped = truncateToWidth(prefix, width - 1, "");
	return `${clipped}${"─".repeat(Math.max(0, width - visibleWidth(clipped) - 1))}${right}`;
}
function framedContent(width: number, value = "", padding = 2): string {
	if (width <= 0) return "";
	if (width === 1) return "│";
	const innerWidth = width - 2; const sidePadding = Math.min(padding, Math.floor(innerWidth / 2)); const contentWidth = Math.max(0, innerWidth - sidePadding * 2);
	const content = fit(sanitizeDisplayText(value), contentWidth); const remaining = Math.max(0, contentWidth - visibleWidth(content));
	return `│${" ".repeat(sidePadding)}${content}${" ".repeat(remaining + sidePadding)}│`;
}

export class HistoryComponent implements Component {
	private snapshot: HistorySnapshot;
	private expanded = new Set<string>();
	private selectedId?: string;
	private selectedIndex = 0;
	private treeOffset = 0;
	private detailOffset = 0;
	private detailTab: DetailTab = "summary";
	private inlineDetail = false;
	private notice?: string;
	private disposed = false;
	private timer?: NodeJS.Timeout;
	private refreshing = false;
	private lastWidth = 0;
	private lastHeight = 24;

	constructor(private readonly tui: TUI, private readonly theme: Theme, snapshot: HistorySnapshot, private readonly reload: (scope: "branch" | "session") => Promise<HistorySnapshot>, private readonly close: () => void) {
		this.snapshot = snapshot;
		for (const workflow of snapshot.workflows) { this.expanded.add(workflow.id); for (const child of workflow.logicalChildren) this.expanded.add(child.id); }
		this.reconcileSelection(); this.updatePolling();
	}

	private rows(): TreeRow[] { return visibleRows(this.snapshot, this.expanded); }
	private selected(): TreeRow | undefined { return this.rows()[this.selectedIndex]; }
	private reconcileSelection(): void {
		const rows = this.rows();
		if (!rows.length) { this.selectedIndex = 0; this.selectedId = undefined; return; }
		const found = this.selectedId ? rows.findIndex((row) => row.id === this.selectedId) : -1;
		this.selectedIndex = found >= 0 ? found : Math.min(this.selectedIndex, rows.length - 1);
		this.selectedId = rows[this.selectedIndex]?.id;
	}
	private anyActive(): boolean { return this.snapshot.workflows.some((workflow) => ACTIVE.has(workflow.state)); }
	private updatePolling(): void {
		if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
		if (!this.disposed && this.anyActive()) { this.timer = setInterval(() => void this.refresh(), 750); this.timer.unref?.(); }
	}
	async refresh(): Promise<void> {
		if (this.disposed || this.refreshing) return;
		this.refreshing = true;
		try { this.snapshot = await this.reload(this.snapshot.scope); this.reconcileSelection(); this.updatePolling(); if (!this.disposed) this.tui.requestRender(); }
		catch (error) { this.notice = `Refresh failed: ${error instanceof Error ? error.message : String(error)}`; if (!this.disposed) this.tui.requestRender(); }
		finally { this.refreshing = false; }
	}
	private move(delta: number): void { const rows = this.rows(); if (!rows.length) return; this.selectedIndex = Math.max(0, Math.min(rows.length - 1, this.selectedIndex + delta)); this.selectedId = rows[this.selectedIndex]?.id; this.detailOffset = 0; this.keepVisible(); }
	private keepVisible(): void { this.tui.requestRender(); }
	private toggle(row = this.selected()): void { if (!row?.hasChildren) return; this.expanded.has(row.id) ? this.expanded.delete(row.id) : this.expanded.add(row.id); this.reconcileSelection(); this.tui.requestRender(); }
	private openTab(tab: DetailTab): void { const row = this.selected(); if (!isAttempt(row)) { this.notice = "Select an attempt."; this.tui.requestRender(); return; } this.detailTab = tab; this.detailOffset = 0; this.inlineDetail = true; this.notice = undefined; this.tui.requestRender(); }

	private detailLines(attempt: AttemptRecord, width: number): string[] {
		let lines: string[];
		if (this.detailTab === "prompt") lines = [attempt.promptNote ?? "Unavailable", "", ...(attempt.prompt ? wrap(attempt.prompt, width, 80) : ["Prompt unavailable."])];
		else if (this.detailTab === "transcript") { const preview = readTranscriptPreview(attempt.transcriptPath ?? attempt.sessionFile, attempt.trustedRoots ?? []); lines = preview.unavailable ? [preview.unavailable] : [...(preview.warning ? [`⚠ ${preview.warning}`, ""] : []), ...(preview.truncated ? ["… transcript preview truncated", ""] : []), ...preview.lines]; }
		else if (this.detailTab === "activity") lines = [
			`Current tool  ${attempt.currentTool ?? "—"}`,
			...(attempt.attention ? ["Attention     needs attention"] : []),
			...(attempt.activities?.length ? ["", "Lifecycle events", ...attempt.activities.map((event) => `${event.ts ? new Date(event.ts).toLocaleTimeString() + " · " : ""}${event.type}${event.detail ? ` · ${event.detail}` : ""}`)] : []),
			"", ...(attempt.recentTools?.flatMap((tool) => [`${tool.tool}${tool.args ? ` · ${tool.args}` : ""}`]) ?? ["Activity/tools unavailable."]), ...(attempt.recentOutput?.length ? ["", "Recent output", ...attempt.recentOutput] : []),
		];
		else if (this.detailTab === "output") { const preview = readTextPreview(attempt.outputPath, attempt.trustedRoots ?? []); lines = preview.unavailable ? [preview.unavailable] : [...(preview.truncated ? ["… output preview truncated", ""] : []), ...preview.lines]; }
		else lines = [
			...attemptSummary(attempt),
			"",
			"Prompt",
			attempt.promptNote ?? "Unavailable",
			...(attempt.prompt ? wrap(attempt.prompt, width, 20) : ["Prompt unavailable."]),
		];
		return lines.flatMap((line) => wrap(line, Math.max(1, width), 200));
	}
	private detail(attempt: AttemptRecord, width: number, height: number): string[] {
		const title = `${attempt.agent ?? "Attempt"} · ${this.detailTab}`;
		const tabs = "[summary] [p prompt] [t transcript] [a activity] [o output]";
		const body = this.detailLines(attempt, width);
		const viewport = Math.max(1, height - 3);
		this.detailOffset = Math.max(0, Math.min(this.detailOffset, Math.max(0, body.length - viewport)));
		return [title, fit(tabs, width), "", ...body.slice(this.detailOffset, this.detailOffset + viewport)].map((line) => fit(line, width));
	}
	private tree(width: number, height: number): string[] {
		const now = Date.now(); const rows = visibleRows(this.snapshot, this.expanded, now); const viewport = Math.max(1, height);
		if (!rows.length) return [this.snapshot.scope === "branch" ? "No subagent workflows on this branch." : "No subagent workflows in this session."];
		const lines: string[] = []; const starts: number[] = []; const ends: number[] = [];
		for (const [index, row] of rows.entries()) {
			if (row.kind === "workflow" && index > 0) lines.push("");
			starts[index] = lines.length;
			const timed = row.attempt ?? row.workflow; const time = row.startedAt !== undefined ? formatTimelineTime(row.startedAt) : "--:--:--";
			const selected = index === this.selectedIndex ? ">" : " ";
			const marker = row.kind === "workflow" ? (row.hasChildren ? (this.expanded.has(row.id) ? "▾" : "▸") : "●") : row.kind === "nested" ? "↳" : row.hasChildren ? (this.expanded.has(row.id) ? "▾" : "▸") : "│";
			const warning = row.kind === "workflow" && row.workflow && !row.workflow.attributed ? "⚠ " : "";
			const suffix = fit(row.state ? `${stateIcon(row.state)} ${formatDuration(timed?.startedAt, timed?.endedAt, timed?.durationMs, now)}` : "", 12);
			const prefix = `${time} ${selected}${"  ".repeat(row.depth)}${marker} ${warning}${row.label}`; const suffixWidth = visibleWidth(suffix); const labelWidth = Math.max(1, width - suffixWidth - (suffix ? 1 : 0));
			const clipped = fit(prefix, labelWidth); lines.push(fit(`${clipped}${" ".repeat(Math.max(0, labelWidth - visibleWidth(clipped)))}${suffix ? ` ${suffix}` : ""}`, width));
			if (index === this.selectedIndex && this.inlineDetail && isAttempt(row)) {
				const indent = "           "; const detailWidth = Math.max(1, width - indent.length - 2); const previewHeight = Math.min(8, Math.max(4, Math.floor(viewport / 3)));
				lines.push(fit(`${indent}╭─ ${this.detailTab}`, width));
				for (const line of this.detail(row.attempt, detailWidth, previewHeight)) lines.push(fit(`${indent}│ ${line}`, width));
				lines.push(fit(`${indent}╰${"─".repeat(Math.max(1, detailWidth + 1))}`, width));
			}
			ends[index] = lines.length - 1;
		}
		const selectedStart = starts[this.selectedIndex] ?? 0; const selectedEnd = ends[this.selectedIndex] ?? selectedStart;
		if (selectedStart < this.treeOffset) this.treeOffset = selectedStart;
		else if (selectedEnd >= this.treeOffset + viewport) this.treeOffset = Math.max(selectedStart, selectedEnd - viewport + 1);
		this.treeOffset = Math.max(0, Math.min(this.treeOffset, Math.max(0, lines.length - viewport)));
		return lines.slice(this.treeOffset, this.treeOffset + viewport);
	}

	render(width: number): string[] {
		this.lastWidth = width; this.lastHeight = terminalRows(this.tui);
		if (width < 24) return [fit("Terminal too narrow", width), fit("r refresh · q close", width)];
		const count = aggregate(this.snapshot); const persist = this.snapshot.sessionFile ? "" : " · persistence unavailable";
		const title = `Subagent history · ${this.snapshot.sessionName ?? this.snapshot.sessionId.slice(0, 12)} · ${this.snapshot.scope === "branch" ? "Active branch" : "Whole session"}${persist}`;
		const stats = `${count.workflows} workflows · ${count.attempts} attempts · ${stateIcon("running")} ${count.active} running · ${stateIcon("failed")} ${count.failed} failed`;
		const timingLegend = "Chronological start order · oldest at top · --:--:-- means unknown";
		const header = [framedRule(width, title, "╭", "╮"), stats, timingLegend, framedRule(width)];
		const footer = "↑↓ select · Enter details · Space fold · p/t/a/o · b scope · r refresh · q close";
		const firstWarning = this.snapshot.warnings[0]; const warning = this.notice ?? (firstWarning ? `${firstWarning.kind}: ${firstWarning.message}` : undefined);
		const padding = 2; const contentWidth = Math.max(1, width - 2 - padding * 2); const usable = Math.max(1, this.lastHeight - header.length - 5 - (warning ? 1 : 0));
		const body = this.tree(contentWidth, usable);
		return [
			this.theme.fg("accent", truncateToWidth(sanitizeDisplayText(header[0]), width)),
			this.theme.fg("muted", framedContent(width, header[1], padding)),
			this.theme.fg("dim", framedContent(width, header[2], padding)),
			this.theme.fg("borderMuted", truncateToWidth(sanitizeDisplayText(header[3]), width)),
			...(warning ? [this.theme.fg("warning", framedContent(width, `⚠ ${warning}`, padding))] : []),
			framedContent(width, "", padding),
			...body.map((line) => framedContent(width, line, padding)),
			framedContent(width, "", padding),
			this.theme.fg("borderMuted", framedRule(width)),
			this.theme.fg("dim", framedContent(width, footer, padding)),
			this.theme.fg("accent", framedRule(width, "", "╰", "╯")),
		];
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || matchesKey(data, "q")) { this.close(); return; }
		if (this.lastWidth < 24) { if (matchesKey(data, "r")) void this.refresh(); return; }
		if ((matchesKey(data, Key.left) || matchesKey(data, Key.backspace)) && this.inlineDetail) { this.inlineDetail = false; this.tui.requestRender(); return; }
		if (matchesKey(data, Key.up) || matchesKey(data, "k")) this.move(-1);
		else if (matchesKey(data, Key.down) || matchesKey(data, "j")) this.move(1);
		else if (matchesKey(data, Key.home)) this.move(-this.rows().length);
		else if (matchesKey(data, Key.end)) this.move(this.rows().length);
		else if (matchesKey(data, Key.enter)) { const row = this.selected(); if (isAttempt(row)) { if (this.inlineDetail && this.detailTab === "summary") this.inlineDetail = false; else this.openTab("summary"); } else this.toggle(row); }
		else if (matchesKey(data, Key.space)) this.toggle();
		else if (matchesKey(data, "p")) this.openTab("prompt"); else if (matchesKey(data, "t")) this.openTab("transcript"); else if (matchesKey(data, "a")) this.openTab("activity"); else if (matchesKey(data, "o")) this.openTab("output");
		else if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.shift("k"))) { this.detailOffset = Math.max(0, this.detailOffset - Math.max(1, this.lastHeight - 8)); this.tui.requestRender(); }
		else if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.shift("j"))) { this.detailOffset += Math.max(1, this.lastHeight - 8); this.tui.requestRender(); }
		else if (matchesKey(data, "b")) { this.snapshot.scope = this.snapshot.scope === "branch" ? "session" : "branch"; void this.refresh(); }
		else if (matchesKey(data, "r")) void this.refresh();
		// Deliberately ignore s/R/D: v1 is observational and has no mutation adapter.
	}
	invalidate(): void { this.lastWidth = 0; }
	dispose(): void { if (this.disposed) return; this.disposed = true; if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}

export async function openHistory(ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
	let scope: "branch" | "session" = "branch";
	const load = async (next: "branch" | "session") => { scope = next; return collectHistory({ sessionManager: ctx.sessionManager, scope }); };
	const initial = await load(scope);
	await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
		let component: HistoryComponent | undefined; let finished = false;
		const unsubscribes = ["subagent:async-started", "subagent:async-complete", "subagent:child-status", "subagent:process-terminal"].map((event) => pi.events.on(event, () => void component?.refresh()));
		let cleanup = () => {};
		const finish = () => { if (finished) return; finished = true; cleanup(); done(); };
		component = new HistoryComponent(tui, theme, initial, load, finish);
		const dispose = component.dispose.bind(component);
		cleanup = () => { dispose(); for (const unsubscribe of unsubscribes.splice(0)) unsubscribe(); activeViewClosers.delete(finish); };
		component.dispose = cleanup;
		activeViewClosers.add(finish);
		return component;
	}, HISTORY_OVERLAY_OPTIONS);
}
