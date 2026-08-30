import type { AttemptRecord, HistorySnapshot, WorkflowRecord } from "./types.ts";

export interface TreeRow { id: string; depth: number; kind: "workflow" | "attempt" | "nested"; label: string; state?: string; startedAt?: number; attempt?: AttemptRecord; workflow?: WorkflowRecord; hasChildren: boolean }

export function formatTimelineTime(value: number): string {
	return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function visibleRows(snapshot: HistorySnapshot, expanded: Set<string>, _now = Date.now()): TreeRow[] {
	const rows: Array<TreeRow & { startedAt?: number; stable: number }> = []; let stable = 0;
	const addNested = (attempts: AttemptRecord[], workflowNumber: number, key: string, depth: number) => {
		for (const [index, attempt] of attempts.entries()) {
			rows.push({ id: attempt.id, depth, kind: "nested", label: `W${workflowNumber} / ${key} ↳ #${index + 1} ${attempt.agent ?? "nested"}`, state: attempt.state, attempt, hasChildren: attempt.nested.length > 0, startedAt: attempt.startedAt, stable: stable++ });
			if (expanded.has(attempt.id)) addNested(attempt.nested, workflowNumber, key, depth + 1);
		}
	};
	const workflows = [...snapshot.workflows].map((workflow, index) => {
		const earliestChild = workflow.logicalChildren.flatMap((child) => child.attempts).map((attempt) => attempt.startedAt).filter((value): value is number => value !== undefined && Number.isFinite(value)).sort((a, b) => a - b)[0];
		return { workflow, index, effectiveStart: workflow.startedAt ?? earliestChild };
	}).sort((a, b) => {
		const aKnown = a.effectiveStart !== undefined && Number.isFinite(a.effectiveStart); const bKnown = b.effectiveStart !== undefined && Number.isFinite(b.effectiveStart);
		if (aKnown !== bKnown) return aKnown ? -1 : 1;
		if (aKnown && bKnown && a.effectiveStart !== b.effectiveStart) return a.effectiveStart! - b.effectiveStart!;
		return a.index - b.index;
	});
	for (const [workflowIndex, { workflow, effectiveStart }] of workflows.entries()) {
		rows.push({ id: workflow.id, depth: 0, kind: "workflow", label: `W${workflowIndex + 1}  ${workflow.goal ?? `Workflow ${workflow.workflowRunId.slice(0, 8)}`}${workflow.error ? ` · error: ${workflow.error}` : ""}`, state: workflow.state, workflow, hasChildren: workflow.logicalChildren.some((child) => child.attempts.length > 0), startedAt: effectiveStart, stable: stable++ });
		if (!expanded.has(workflow.id)) continue;
		for (const child of workflow.logicalChildren) {
			for (const [attemptIndex, attempt] of child.attempts.entries()) {
				rows.push({ id: attempt.id, depth: 1, kind: "attempt", label: `W${workflowIndex + 1} / ${child.workflowKey} · #${attemptIndex + 1} ${attempt.agent ?? "attempt"}${attempt.attention ? " · ⚠" : ""}`, state: attempt.state, attempt, hasChildren: attempt.nested.length > 0, startedAt: attempt.startedAt, stable: stable++ });
				if (expanded.has(attempt.id)) addNested(attempt.nested, workflowIndex + 1, child.workflowKey, 2);
			}
		}
	}
	rows.sort((a, b) => {
		const aKnown = a.startedAt !== undefined && Number.isFinite(a.startedAt); const bKnown = b.startedAt !== undefined && Number.isFinite(b.startedAt);
		if (aKnown !== bKnown) return aKnown ? -1 : 1;
		return aKnown && bKnown && a.startedAt !== b.startedAt ? a.startedAt! - b.startedAt! : a.stable - b.stable;
	});
	return rows.map(({ stable: _stable, ...row }) => row);
}

export function aggregate(snapshot: HistorySnapshot): { workflows: number; logical: number; attempts: number; tokens?: number; cost?: number; active: number; failed: number } {
	const attemptIds = new Set<string>();
	let logical = 0, active = 0, failed = 0, tokens = 0, cost = 0, tokenKnown = false, costKnown = false;
	const countAttempt = (attempt: AttemptRecord) => {
		if (!attemptIds.has(attempt.id)) { attemptIds.add(attempt.id); if (attempt.state === "queued" || attempt.state === "running") active++; if (attempt.state === "failed") failed++; }
		for (const child of attempt.nested) countAttempt(child);
	};
	for (const workflow of snapshot.workflows) {
		logical += workflow.logicalChildren.length;
		if (workflow.totalTokens !== undefined) { tokens += workflow.totalTokens; tokenKnown = true; }
		else { const values = workflow.logicalChildren.flatMap((child) => child.attempts).map((attempt) => attempt.totalTokens).filter((value): value is number => value !== undefined); if (values.length) { tokens += values.reduce((sum, value) => sum + value, 0); tokenKnown = true; } }
		if (workflow.totalCostUsd !== undefined) { cost += workflow.totalCostUsd; costKnown = true; }
		else { const values = workflow.logicalChildren.flatMap((child) => child.attempts).map((attempt) => attempt.costUsd).filter((value): value is number => value !== undefined); if (values.length) { cost += values.reduce((sum, value) => sum + value, 0); costKnown = true; } }
		for (const child of workflow.logicalChildren) for (const attempt of child.attempts) countAttempt(attempt);
	}
	return { workflows: snapshot.workflows.length, logical, attempts: attemptIds.size, tokens: tokenKnown ? tokens : undefined, cost: costKnown ? cost : undefined, active, failed };
}

export function formatDuration(startedAt?: number, endedAt?: number, durationMs?: number, now = Date.now()): string {
	const ms = durationMs ?? (startedAt !== undefined ? Math.max(0, (endedAt ?? now) - startedAt) : undefined);
	if (ms === undefined) return "—";
	const seconds = Math.floor(ms / 1000); const minutes = Math.floor(seconds / 60); const hours = Math.floor(minutes / 60);
	if (hours) return `${hours}h ${minutes % 60}m`; if (minutes) return `${minutes}m ${seconds % 60}s`; return `${seconds}s`;
}
export function formatNumber(value?: number): string { return value === undefined ? "—" : Intl.NumberFormat("en", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value); }
export function formatCost(value?: number): string { return value === undefined ? "—" : `$${value.toFixed(2)}`; }

export function attemptSummary(attempt: AttemptRecord, now = Date.now()): string[] {
	return [
		`State       ${attempt.state}${attempt.attention ? " · ⚠ needs attention" : ""}`,
		`Agent       ${attempt.agent ?? "—"}`,
		`Model       ${attempt.model ?? "—"}`,
		`Thinking    ${attempt.thinking ?? "—"}`,
		`Context     ${attempt.context ?? "—"}`,
		`Started     ${attempt.startedAt === undefined ? "—" : new Date(attempt.startedAt).toLocaleString()}`,
		`Duration    ${formatDuration(attempt.startedAt, attempt.endedAt, attempt.durationMs, now)}`,
		`Usage       ${formatNumber(attempt.totalTokens)} tokens · ${formatCost(attempt.costUsd)}`,
		`Turns       ${formatNumber(attempt.turnCount)}`,
		`Tools       ${formatNumber(attempt.toolCount)}`,
		`Run ID      ${attempt.runId ?? "—"}`,
		...(attempt.error ? [`Error        ${attempt.error}`] : []),
	];
}

function charWidth(char: string): number { const cp = char.codePointAt(0) ?? 0; return cp >= 0x1100 && (cp <= 0x115f || cp >= 0x2e80) ? 2 : 1; }
/** Remove terminal escape/control sequences from all artifact-derived display text. */
export function sanitizeDisplayText(value: unknown): string {
	return String(value ?? "")
		.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b[P_X^][\s\S]*?\x1b\\/g, "")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/\x1b[@-_]/g, "")
		.replace(/\t/g, "    ")
		.replace(/\r\n?|\n/g, " ")
		.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}
export function fit(text: string, width: number): string {
	if (width <= 0) return "";
	let used = 0, out = "";
	for (const char of sanitizeDisplayText(text)) { const next = charWidth(char); if (used + next > width) break; out += char; used += next; }
	return out;
}
export function wrap(text: string, width: number, maxLines = 200): string[] {
	if (width <= 0) return [""];
	const result: string[] = [];
	for (const rawParagraph of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
		const paragraph = sanitizeDisplayText(rawParagraph);
		let rest = paragraph;
		while (rest && result.length < maxLines) { const line = fit(rest, width); result.push(line); rest = rest.slice(line.length); }
		if (!paragraph) result.push("");
		if (result.length >= maxLines) break;
	}
	return result.slice(0, maxLines);
}

export function workflowFor(snapshot: HistorySnapshot, rowId: string): WorkflowRecord | undefined {
	return snapshot.workflows.find((workflow) => workflow.id === rowId || workflow.logicalChildren.some((child) => child.id === rowId || child.attempts.some((attempt) => attempt.id === rowId)));
}
