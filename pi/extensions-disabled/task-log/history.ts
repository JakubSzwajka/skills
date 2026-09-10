import { createHash } from "node:crypto";
import { renderEntry, sanitizeTaskOutput, type LogEntry, type Task } from "./store.ts";

export const DEFAULT_READ_COUNT = 50;
export const MAX_READ_COUNT = 200;
export const DEFAULT_READ_CHARS = 12_000;
export const MAX_READ_CHARS = 20_000;
export const TASK_CONTEXT_CHARS = 6_000;

export interface TaskReadOptions {
	count: number;
	maxChars: number;
	cursor?: string;
	type?: string;
	session?: string;
	text?: string;
}

export interface TaskReadPage {
	text: string;
	shown: number;
	total: number;
	totalMatches: number;
	nextCursor?: string;
	characters: number;
	truncated: boolean;
}

interface CursorData {
	v: 1;
	taskId: string;
	before: number;
	filter: string;
}

function clip(text: string, maxChars: number, notice = "… [omitted]"): string {
	if (text.length <= maxChars) return text;
	if (maxChars <= 0) return "";
	if (maxChars <= notice.length) return notice.slice(0, maxChars);
	return `${text.slice(0, maxChars - notice.length)}${notice}`;
}

function filterKey(options: Pick<TaskReadOptions, "type" | "session" | "text">): string {
	return JSON.stringify({
		type: options.type ?? "",
		session: options.session ?? "",
		text: options.text?.toLocaleLowerCase() ?? "",
	});
}

function encodeCursor(data: CursorData): string {
	return Buffer.from(JSON.stringify(data), "utf8").toString("base64url");
}

function decodeCursor(cursor: string, task: Task, filter: string): number {
	try {
		const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<CursorData>;
		if (parsed.v !== 1 || parsed.taskId !== task.id || parsed.filter !== filter || !Number.isInteger(parsed.before)) {
			throw new Error("identity, filter, or position does not match");
		}
		if ((parsed.before as number) < 0 || (parsed.before as number) > task.entries.length) throw new Error("position is out of range");
		return parsed.before as number;
	} catch (error) {
		throw new Error(`Invalid task_read cursor (${error instanceof Error ? error.message : String(error)}).`);
	}
}

function searchableText(entry: LogEntry): string {
	return `${entry.text}\n${entry.handoff ? JSON.stringify(entry.handoff) : ""}`.toLocaleLowerCase();
}

function matches(entry: LogEntry, options: TaskReadOptions): boolean {
	if (options.type && entry.type !== options.type) return false;
	if (options.session && entry.session !== options.session) return false;
	if (options.text && !searchableText(entry).includes(options.text.toLocaleLowerCase())) return false;
	return true;
}

export function readTaskPage(task: Task, options: TaskReadOptions): TaskReadPage {
	const filter = filterKey(options);
	const before = options.cursor ? decodeCursor(options.cursor, task, filter) : task.entries.length;
	const candidates: Array<{ index: number; entry: LogEntry }> = [];
	let totalMatches = 0;
	for (let index = 0; index < task.entries.length; index++) {
		if (!matches(task.entries[index], options)) continue;
		totalMatches += 1;
		if (index < before) candidates.push({ index, entry: task.entries[index] });
	}
	candidates.reverse();

	const referenceText = task.refs.length ? task.refs.map((reference) => `- ${sanitizeTaskOutput(reference)}`).join("\n") : "_None._";
	const overview = [
		`# ${sanitizeTaskOutput(task.title)}`,
		`id: ${sanitizeTaskOutput(task.id)} · status: ${task.status} · file: ${sanitizeTaskOutput(task.path)}`,
		sanitizeTaskOutput(task.description),
		"",
		"## References",
		referenceText,
		"",
		`## Log (newest first; ${totalMatches} matching of ${task.entries.length})`,
	].join("\n");
	const overviewBudget = candidates.length > 0
		? Math.min(overview.length, Math.floor(options.maxChars * 0.4), Math.max(0, options.maxChars - 3))
		: Math.min(overview.length, options.maxChars);
	let output = clip(overview, overviewBudget);
	const selected = candidates.slice(0, options.count);
	let shown = 0;
	let lastIndex = before;
	let truncated = overview.length > overviewBudget;

	for (const candidate of selected) {
		const prefix = output ? "\n\n" : "";
		const available = options.maxChars - output.length - prefix.length;
		if (available <= 0) break;
		const rendered = renderEntry(candidate.entry);
		const visible = clip(rendered, available, "… [entry omitted]");
		output += `${prefix}${visible}`;
		shown += 1;
		lastIndex = candidate.index;
		if (visible.length < rendered.length) {
			truncated = true;
			break;
		}
	}

	if (selected.length === 0) {
		const empty = "\n\n_No matching log entries._";
		output = clip(`${output}${empty}`, options.maxChars);
	}
	const hasMore = shown < candidates.length;
	const nextCursor = hasMore
		? encodeCursor({ v: 1, taskId: task.id, before: shown > 0 ? lastIndex : before, filter })
		: undefined;
	truncated ||= hasMore;
	return {
		text: clip(output, options.maxChars),
		shown,
		total: task.entries.length,
		totalMatches,
		...(nextCursor ? { nextCursor } : {}),
		characters: Math.min(output.length, options.maxChars),
		truncated,
	};
}

function latestHandoffIndex(task: Task): number {
	for (let index = task.entries.length - 1; index >= 0; index--) {
		if (task.entries[index].type === "handoff" && task.entries[index].handoff) return index;
	}
	return -1;
}

function renderCompactHandoff(entry: LogEntry): string {
	const handoff = entry.handoff;
	if (!handoff) return "_No structured handoff. Reconstruct state and log one before stopping._";
	return [
		`Handoff ${clip(sanitizeTaskOutput(entry.timestamp), 40)} · s:${clip(sanitizeTaskOutput(entry.session), 40)}`,
		`Current state: ${clip(sanitizeTaskOutput(handoff.currentState), 450)}`,
		`Next action: ${clip(sanitizeTaskOutput(handoff.nextAction), 450)}`,
		`Blockers: ${clip(sanitizeTaskOutput(handoff.blockers.join(", ") || "none"), 300)}`,
		`Branch/worktree: ${clip(sanitizeTaskOutput(handoff.branchOrWorktree), 200)}`,
		`Latest commit: ${clip(sanitizeTaskOutput(handoff.latestCommit), 200)}`,
		`Validation: ${clip(sanitizeTaskOutput(handoff.validationState), 350)}`,
		`References: ${clip(sanitizeTaskOutput(handoff.references.join(", ") || "none"), 300)}`,
	].join("\n");
}

export function renderCompactTaskContext(task: Task, maxChars = TASK_CONTEXT_CHARS): { text: string; fingerprint: string } {
	const handoffIndex = latestHandoffIndex(task);
	const handoff = handoffIndex >= 0 ? task.entries[handoffIndex] : undefined;
	const references = task.refs.length ? task.refs.map((reference) => `- ${sanitizeTaskOutput(reference)}`).join("\n") : "_None._";
	const required = [
		"# Current saved task",
		`Title: ${clip(sanitizeTaskOutput(task.title), 500)}`,
		`ID: ${clip(sanitizeTaskOutput(task.id), 200)}`,
		`Status: ${task.status}`,
		"",
		"## Objective",
		clip(sanitizeTaskOutput(task.description), 1_000),
		"",
		"## References",
		clip(references, 1_000),
		"",
		"## Latest handoff",
		handoff ? renderCompactHandoff(handoff) : "_No structured handoff. Reconstruct state and log one before stopping._",
	].join("\n");
	let text = clip(required, maxChars);
	if (text.length < maxChars && handoffIndex + 1 < task.entries.length) {
		const newer = task.entries.slice(handoffIndex + 1);
		const recent: string[] = [];
		let omitted = 0;
		for (let index = newer.length - 1; index >= 0; index--) {
			const rendered = renderEntry(newer[index]);
			const projected = recent.length ? `${rendered}\n\n${recent.join("\n\n")}` : rendered;
			const heading = `\n\n## Changes after handoff${omitted ? ` (${omitted} changes omitted)` : ""}\n\n`;
			if (text.length + heading.length + projected.length > maxChars) {
				omitted += 1;
				continue;
			}
			recent.unshift(rendered);
		}
		const heading = `\n\n## Changes after handoff${omitted ? ` (${omitted} changes omitted)` : ""}`;
		text = clip(`${text}${heading}\n\n${recent.join("\n\n")}`, maxChars);
	}
	const fingerprint = createHash("sha256").update(JSON.stringify({
		id: task.id,
		status: task.status,
		description: task.description,
		refs: task.refs,
		entries: task.entries,
	})).digest("hex").slice(0, 16);
	return { text, fingerprint };
}
