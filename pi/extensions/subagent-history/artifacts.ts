import * as fs from "node:fs";
import * as path from "node:path";
import type { ActivityRecord, PromptAttribution, WarningRecord } from "./types.ts";

export const MAX_PREVIEW_BYTES = 64 * 1024;
export const MAX_JSON_BYTES = 4 * 1024 * 1024;
export const MAX_SESSION_USAGE_BYTES = 1024 * 1024;
export const MAX_EVENTS_BYTES = 256 * 1024;
export const MAX_PREVIEW_LINES = 200;

export function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export function finite(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

export function normalizeState(value: unknown): import("./types.ts").LifecycleState {
	if (value === "completed") return "complete";
	if (["pending", "queued", "running", "complete", "failed", "paused", "stopped", "rejected"].includes(String(value))) return value as import("./types.ts").LifecycleState;
	return "unknown";
}

export function safeJsonFile(file: string, warnings: WarningRecord[], kind: string, maxBytes = MAX_JSON_BYTES): unknown | undefined {
	let handle: number | undefined;
	try {
		handle = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
		const stat = fs.fstatSync(handle);
		if (!stat.isFile()) throw new Error("not a regular non-symlink file");
		if (stat.size > maxBytes) throw new Error(`file exceeds ${maxBytes} byte limit`);
		const buffer = Buffer.alloc(stat.size);
		fs.readSync(handle, buffer, 0, stat.size, 0);
		return JSON.parse(buffer.toString("utf8")) as unknown;
	} catch (error) {
		warnings.push({ kind, path: file, message: error instanceof Error ? error.message : String(error) });
		return undefined;
	} finally { if (handle !== undefined) fs.closeSync(handle); }
}

/** Refuse symlinks and require the real file to remain under a recorded trusted root. */
export function trustedFile(file: string, roots: Array<string | undefined>): string | undefined {
	try {
		const allowed = roots.filter((root): root is string => !!root).map((root) => fs.realpathSync(root));
		if (allowed.length === 0) return undefined;
		const stat = fs.lstatSync(file);
		if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
		const real = fs.realpathSync(file);
		if (!allowed.some((root) => real === root || real.startsWith(root + path.sep))) return undefined;
		return real;
	} catch {
		return undefined;
	}
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : "").filter(Boolean).join("\n");
}

export interface PromptPreview { text?: string; attribution: PromptAttribution; note: string; truncated: boolean; warning?: string }

export function readFreshPrompt(file: string | undefined, roots: Array<string | undefined>, context: unknown): PromptPreview {
	if (context !== "fresh") return { attribution: "unavailable", note: context === "fork" ? "Fork launch boundary is not durably correlated." : "Launch context is unknown.", truncated: false };
	if (!file) return { attribution: "unavailable", note: "Child session is unavailable.", truncated: false };
	const safe = trustedFile(file, roots);
	if (!safe) return { attribution: "unavailable", note: "Child session is outside its trusted root or unavailable.", truncated: false };
	let handle: number | undefined;
	try {
		handle = fs.openSync(safe, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
		const stat = fs.fstatSync(handle);
		const size = Math.min(stat.size, MAX_PREVIEW_BYTES);
		const buffer = Buffer.alloc(size);
		fs.readSync(handle, buffer, 0, size, 0);
		const raw = buffer.toString("utf8");
		const lines = raw.split(/\r?\n/).slice(0, MAX_PREVIEW_LINES);
		let malformed = 0;
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const value = JSON.parse(line) as unknown;
				if (!isRecord(value)) continue;
				const envelope = value.type === "message" && isRecord(value.message) ? value.message : value;
				if (envelope.role !== "user") continue;
				const prompt = contentText(envelope.content).trim();
				if (prompt) return { text: prompt, attribution: "exact", note: "Exact · fresh launch task", truncated: stat.size > size || lines.length >= MAX_PREVIEW_LINES, ...(malformed ? { warning: `transcript: ${file}: skipped ${malformed} malformed line(s)` } : {}) };
			} catch { malformed++; }
		}
		return { attribution: "unavailable", note: stat.size > size ? "Prompt unavailable: truncated read window." : "Prompt unavailable: no attributable user task.", truncated: stat.size > size, ...(malformed ? { warning: `transcript: ${file}: skipped ${malformed} malformed line(s)` } : {}) };
	} catch {
		return { attribution: "unavailable", note: "Prompt unavailable: transcript could not be read.", truncated: false };
	} finally { if (handle !== undefined) fs.closeSync(handle); }
}

export interface TextPreview { lines: string[]; unavailable?: string; truncated: boolean; warning?: string }

export function readTextPreview(file: string | undefined, roots: Array<string | undefined>, fromEnd = true): TextPreview {
	if (!file) return { lines: [], unavailable: "Preview unavailable: no path was recorded.", truncated: false };
	const safe = trustedFile(file, roots);
	if (!safe) return { lines: [], unavailable: "Preview unavailable: path is missing or outside its trusted root.", truncated: false };
	let handle: number | undefined;
	try {
		handle = fs.openSync(safe, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
		const stat = fs.fstatSync(handle);
		const size = Math.min(stat.size, MAX_PREVIEW_BYTES);
		const start = fromEnd ? Math.max(0, stat.size - size) : 0;
		const buffer = Buffer.alloc(size);
		fs.readSync(handle, buffer, 0, size, start);
		let lines = buffer.toString("utf8").split(/\r?\n/);
		if (fromEnd && start > 0) lines.shift();
		if (lines.length > MAX_PREVIEW_LINES) lines = fromEnd ? lines.slice(-MAX_PREVIEW_LINES) : lines.slice(0, MAX_PREVIEW_LINES);
		return { lines, truncated: stat.size > size || lines.length >= MAX_PREVIEW_LINES };
	} catch {
		return { lines: [], unavailable: "Preview unavailable: file could not be read.", truncated: false };
	} finally { if (handle !== undefined) fs.closeSync(handle); }
}

export function readTranscriptPreview(file: string | undefined, roots: Array<string | undefined>): TextPreview {
	const preview = readTextPreview(file, roots, true);
	if (preview.unavailable) return preview;
	const lines: string[] = [];
	let malformed = 0;
	for (const line of preview.lines) {
		if (!line.trim()) continue;
		try {
			const value = JSON.parse(line) as unknown;
			if (!isRecord(value)) continue;
			const message = value.type === "message" && isRecord(value.message) ? value.message : undefined;
			if (message) {
				const role = typeof message.role === "string" ? message.role : "message";
				const rendered: string[] = [];
				if (typeof message.content === "string") rendered.push(message.content);
				else if (Array.isArray(message.content)) for (const part of message.content) {
					if (!isRecord(part)) continue;
					if (part.type === "text" && typeof part.text === "string") rendered.push(part.text);
					else if (part.type === "toolCall") rendered.push(`[tool] ${text(part.name) ?? "unknown"} ${JSON.stringify(part.arguments ?? {}).slice(0, 2000)}`);
					else if (part.type === "image") rendered.push("[image omitted]");
				}
				if (rendered.length) lines.push(`${role}: ${rendered.join("\n")}`);
			} else if (value.type === "model_change") lines.push(`model: ${text(value.provider) ? `${value.provider}/` : ""}${text(value.modelId) ?? "unknown"}`);
			else if (value.type === "thinking_level_change") lines.push(`thinking: ${text(value.thinkingLevel) ?? "unknown"}`);
		} catch { malformed++; }
	}
	return { lines, truncated: preview.truncated, ...(malformed ? { warning: `transcript: ${file}: skipped ${malformed} malformed line(s)` } : {}) };
}

export interface SessionUsage {
	totalTokens?: number;
	costUsd?: number;
	model?: string;
	thinking?: string;
	warning?: string;
}

/** Aggregate complete, reasonably sized child sessions only; truncated sums would be misleading. */
export function readSessionUsage(file: string | undefined, roots: Array<string | undefined>): SessionUsage {
	if (!file) return {};
	const safe = trustedFile(file, roots);
	if (!safe) return {};
	let handle: number | undefined;
	try {
		handle = fs.openSync(safe, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
		const stat = fs.fstatSync(handle);
		if (!stat.isFile() || stat.size > MAX_SESSION_USAGE_BYTES) return { warning: stat.size > MAX_SESSION_USAGE_BYTES ? `session usage unavailable: ${file} exceeds ${MAX_SESSION_USAGE_BYTES} byte limit` : undefined };
		const buffer = Buffer.alloc(stat.size);
		fs.readSync(handle, buffer, 0, stat.size, 0);
		let total = 0, cost = 0, tokenKnown = false, costKnown = false, malformed = 0;
		let model: string | undefined, thinking: string | undefined;
		for (const line of buffer.toString("utf8").split(/\r?\n/)) {
			if (!line.trim()) continue;
			try {
				const value = JSON.parse(line) as unknown;
				if (!isRecord(value)) continue;
				if (value.type === "model_change") { const id = text(value.modelId); const provider = text(value.provider); if (id) model = provider ? `${provider}/${id}` : id; }
				if (value.type === "thinking_level_change") thinking = text(value.thinkingLevel) ?? thinking;
				const message = value.type === "message" && isRecord(value.message) ? value.message : undefined;
				if (!message || message.role !== "assistant") continue;
				const assistantModel = text(message.model); if (assistantModel && (!model || assistantModel.includes("/"))) model = assistantModel;
				if (isRecord(message.usage)) {
					const usage = message.usage;
					const tokens = finite(usage.totalTokens) ?? finite(usage.total);
					if (tokens !== undefined) { total += tokens; tokenKnown = true; }
					if (isRecord(usage.cost)) { const amount = finite(usage.cost.total) ?? finite(usage.cost.costUsd); if (amount !== undefined) { cost += amount; costKnown = true; } }
				}
			} catch { malformed++; }
		}
		return { totalTokens: tokenKnown ? total : undefined, costUsd: costKnown ? cost : undefined, model, thinking, ...(malformed ? { warning: `session: ${file}: skipped ${malformed} malformed line(s)` } : {}) };
	} catch (error) {
		return { warning: `session usage unavailable: ${file}: ${error instanceof Error ? error.message : String(error)}` };
	} finally { if (handle !== undefined) fs.closeSync(handle); }
}

export interface EventTimeline { activities: ActivityRecord[]; warning?: string; truncated: boolean }

/** Read a bounded tail of best-effort lifecycle events without treating unknown types as fatal. */
export function readEventTimeline(file: string, roots: Array<string | undefined>): EventTimeline {
	const safe = trustedFile(file, roots);
	if (!safe) return { activities: [], warning: `events unavailable: ${file}`, truncated: false };
	let handle: number | undefined;
	try {
		handle = fs.openSync(safe, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
		const stat = fs.fstatSync(handle);
		const size = Math.min(stat.size, MAX_EVENTS_BYTES);
		const start = Math.max(0, stat.size - size);
		const buffer = Buffer.alloc(size);
		fs.readSync(handle, buffer, 0, size, start);
		let lines = buffer.toString("utf8").split(/\r?\n/);
		if (start > 0) lines.shift();
		lines = lines.slice(-1000);
		let malformed = 0;
		const activities: ActivityRecord[] = [];
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const value = JSON.parse(line) as unknown;
				if (!isRecord(value)) continue;
				const type = text(value.type) ?? "unknown";
				const detail = text(value.reason) ?? text(value.error) ?? text(value.message) ?? text(value.currentTool);
				const attention = /attention|needs.?attention|supervisor/i.test(type) ? true : /recover|resolve|acknowledge|clear/i.test(type) ? false : undefined;
				activities.push({ ts: finite(value.ts) ?? finite(value.timestamp), type, detail, attention, runId: text(value.childRunId) ?? text(value.runId), workflowKey: text(value.workflowKey), stepIndex: finite(value.stepIndex) });
			} catch { malformed++; }
		}
		const truncated = stat.size > size || lines.length >= 1000;
		return { activities, truncated, ...(malformed ? { warning: `events: ${file}: skipped ${malformed} malformed line(s)` } : {}) };
	} catch (error) {
		return { activities: [], warning: `events unavailable: ${file}: ${error instanceof Error ? error.message : String(error)}`, truncated: false };
	} finally { if (handle !== undefined) fs.closeSync(handle); }
}
