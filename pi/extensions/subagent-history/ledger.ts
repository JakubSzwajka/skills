import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { finite, isRecord, normalizeState, text } from "./artifacts.ts";
import type { ActivityRecord, AttemptRecord, LedgerSnapshot, LogicalChildRecord, SourceReference, WarningRecord, WorkflowRecord } from "./types.ts";

const ROOT = path.join(os.homedir(), ".pi", "agent", "subagent-history");
const MAX_LEDGER_BYTES = 8 * 1024 * 1024;

function key(sessionId: string): string { return encodeURIComponent(sessionId).replaceAll("%", "_").slice(0, 180) || "unknown"; }
export function ledgerPath(sessionId: string): string { return path.join(ROOT, key(sessionId), "ledger.json"); }

function readBoundedJson(file: string): unknown {
	let handle: number | undefined;
	try {
		handle = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
		const stat = fs.fstatSync(handle);
		if (!stat.isFile()) throw new Error("ledger is not a regular file");
		if (stat.size > MAX_LEDGER_BYTES) throw new Error(`ledger exceeds ${MAX_LEDGER_BYTES} byte limit`);
		const buffer = Buffer.alloc(stat.size);
		fs.readSync(handle, buffer, 0, stat.size, 0);
		return JSON.parse(buffer.toString("utf8")) as unknown;
	} finally { if (handle !== undefined) fs.closeSync(handle); }
}

function activity(value: unknown): ActivityRecord | undefined {
	if (!isRecord(value) || !text(value.type)) return undefined;
	return { type: value.type as string, ts: finite(value.ts), detail: text(value.detail), attention: typeof value.attention === "boolean" ? value.attention : undefined, runId: text(value.runId), workflowKey: text(value.workflowKey), stepIndex: finite(value.stepIndex) };
}
function stringArray(value: unknown): string[] | undefined { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined; }
function attempt(value: unknown, depth = 0): AttemptRecord | undefined {
	if (!isRecord(value) || !text(value.id) || depth > 8) return undefined;
	const recentTools = Array.isArray(value.recentTools) ? value.recentTools.filter(isRecord).map((tool) => ({ tool: text(tool.tool) ?? "unknown", args: text(tool.args), endMs: finite(tool.endMs) })) : undefined;
	const activities = Array.isArray(value.activities) ? value.activities.map(activity).filter((item): item is ActivityRecord => !!item) : undefined;
	return {
		id: value.id as string, runId: text(value.runId), state: normalizeState(value.state), agent: text(value.agent), model: text(value.model), thinking: text(value.thinking), context: ["fresh", "fork", "mixed"].includes(String(value.context)) ? value.context as AttemptRecord["context"] : undefined,
		startedAt: finite(value.startedAt), endedAt: finite(value.endedAt), durationMs: finite(value.durationMs), turnCount: finite(value.turnCount), toolCount: finite(value.toolCount), totalTokens: finite(value.totalTokens), costUsd: finite(value.costUsd), error: text(value.error), attention: value.attention === true, activities,
		currentTool: text(value.currentTool), recentTools, recentOutput: stringArray(value.recentOutput), sessionFile: text(value.sessionFile), transcriptPath: text(value.transcriptPath), outputPath: text(value.outputPath), trustedRoots: stringArray(value.trustedRoots), prompt: text(value.prompt),
		promptAttribution: ["exact", "best-effort", "unavailable"].includes(String(value.promptAttribution)) ? value.promptAttribution as AttemptRecord["promptAttribution"] : "unavailable", promptNote: text(value.promptNote), nested: Array.isArray(value.nested) ? value.nested.map((child) => attempt(child, depth + 1)).filter((item): item is AttemptRecord => !!item) : [], provisional: value.provisional === true,
	};
}
function logical(value: unknown): LogicalChildRecord | undefined {
	if (!isRecord(value) || !text(value.id) || !text(value.workflowKey) || !Array.isArray(value.attempts)) return undefined;
	return { id: value.id as string, workflowKey: value.workflowKey as string, label: text(value.label), phase: text(value.phase), agent: text(value.agent), requestedContext: value.requestedContext === "fresh" || value.requestedContext === "fork" ? value.requestedContext : undefined, resolvedContext: ["fresh", "fork", "mixed"].includes(String(value.resolvedContext)) ? value.resolvedContext as LogicalChildRecord["resolvedContext"] : undefined, attempts: value.attempts.map((item) => attempt(item)).filter((item): item is AttemptRecord => !!item), lineageAvailable: value.lineageAvailable === true };
}
function warning(value: unknown): WarningRecord | undefined { return isRecord(value) && text(value.kind) && text(value.message) ? { kind: value.kind as string, message: value.message as string, path: text(value.path) } : undefined; }
function workflow(value: unknown): WorkflowRecord | undefined {
	if (!isRecord(value) || !text(value.workflowRunId) || !Array.isArray(value.logicalChildren)) return undefined;
	const runId = value.workflowRunId as string;
	return { id: text(value.id) ?? `workflow:${runId}`, workflowRunId: runId, parentEntryId: text(value.parentEntryId), parentToolCallId: text(value.parentToolCallId), goal: text(value.goal), state: normalizeState(value.state), startedAt: finite(value.startedAt), endedAt: finite(value.endedAt), durationMs: finite(value.durationMs), totalTokens: finite(value.totalTokens), totalCostUsd: finite(value.totalCostUsd), error: text(value.error), activities: Array.isArray(value.activities) ? value.activities.map(activity).filter((item): item is ActivityRecord => !!item) : [], asyncDir: text(value.asyncDir), attributed: value.attributed === true, stale: value.stale !== false, logicalChildren: value.logicalChildren.map(logical).filter((item): item is LogicalChildRecord => !!item), warnings: Array.isArray(value.warnings) ? value.warnings.map(warning).filter((item): item is WarningRecord => !!item) : [] };
}
function source(value: unknown): SourceReference | undefined {
	if (!isRecord(value) || !text(value.workflowRunId) || finite(value.observedAt) === undefined) return undefined;
	return { workflowRunId: value.workflowRunId as string, asyncDir: text(value.asyncDir), toolCallId: text(value.toolCallId), parentEntryId: text(value.parentEntryId), goal: text(value.goal), observedAt: value.observedAt as number };
}

export function readLedger(sessionId: string, warnings: WarningRecord[]): LedgerSnapshot | undefined {
	const file = ledgerPath(sessionId);
	try {
		const value = readBoundedJson(file);
		if (!isRecord(value) || value.version !== 1 || value.sessionId !== sessionId || !Array.isArray(value.sources) || !Array.isArray(value.workflows)) throw new Error("unsupported or malformed ledger snapshot");
		return { version: 1, sessionId, sessionFile: text(value.sessionFile), updatedAt: finite(value.updatedAt) ?? 0, sources: value.sources.map(source).filter((item): item is SourceReference => !!item), workflows: value.workflows.map(workflow).filter((item): item is WorkflowRecord => !!item) };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") warnings.push({ kind: "ledger", path: file, message: error instanceof Error ? error.message : String(error) });
		return undefined;
	}
}

function withoutChunks(record: WorkflowRecord): WorkflowRecord {
	const trimAttempt = (item: AttemptRecord): AttemptRecord => ({ ...item, recentOutput: undefined, recentTools: item.recentTools?.slice(-12), activities: item.activities?.slice(-100), nested: item.nested.map(trimAttempt) });
	return { ...record, activities: record.activities?.slice(-100), logicalChildren: record.logicalChildren.map((child) => ({ ...child, attempts: child.attempts.map(trimAttempt) })) };
}
export function writeLedger(snapshot: LedgerSnapshot): void {
	const file = ledgerPath(snapshot.sessionId); const dir = path.dirname(file);
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	const compact: LedgerSnapshot = { ...snapshot, workflows: snapshot.workflows.map(withoutChunks) };
	try {
		const previous = readBoundedJson(file) as LedgerSnapshot;
		if (previous.version === compact.version && previous.sessionId === compact.sessionId && previous.sessionFile === compact.sessionFile && JSON.stringify(previous.sources) === JSON.stringify(compact.sources) && JSON.stringify(previous.workflows) === JSON.stringify(compact.workflows)) return;
	} catch { /* missing/corrupt snapshots are atomically replaced */ }
	const serialized = JSON.stringify(compact);
	if (Buffer.byteLength(serialized) > MAX_LEDGER_BYTES) throw new Error(`ledger exceeds ${MAX_LEDGER_BYTES} byte limit`);
	const temp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(temp, serialized, { mode: 0o600 }); fs.renameSync(temp, file);
}
export function upsertSource(sessionId: string, sessionFile: string | undefined, next: SourceReference): void {
	const warnings: WarningRecord[] = []; const previous = readLedger(sessionId, warnings);
	const sources = [...(previous?.sources ?? []).filter((item) => item.workflowRunId !== next.workflowRunId), next];
	writeLedger({ version: 1, sessionId, sessionFile, updatedAt: Date.now(), sources, workflows: previous?.workflows ?? [] });
}
