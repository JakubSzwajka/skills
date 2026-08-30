import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import { finite, isRecord, normalizeState, readEventTimeline, readFreshPrompt, readSessionUsage, safeJsonFile, text } from "./artifacts.ts";
import { readLedger, writeLedger } from "./ledger.ts";
import type { ActivityRecord, AttemptRecord, HistorySnapshot, LogicalChildRecord, SourceReference, WarningRecord, WorkflowRecord } from "./types.ts";

type SessionReader = Pick<SessionManager, "getSessionId" | "getSessionFile" | "getSessionName" | "getEntries" | "getBranch">;
interface CollectOptions { sessionManager: SessionReader; scope: "branch" | "session"; now?: number }
interface ReceiptEntry { key: string; agent?: string; requestedContext?: "fresh" | "fork"; resolvedContext?: "fresh" | "fork" | "mixed"; outputReference?: string; runIds: string[] }

function normalizedPath(value: string): string { return path.resolve(value); }
function exactOwner(statusOwner: unknown, sessionId: string, sessionFile?: string): boolean {
	if (typeof statusOwner !== "string") return false;
	return sessionFile ? normalizedPath(statusOwner) === normalizedPath(sessionFile) : statusOwner === sessionId;
}
function parts(entry: SessionEntry): Array<Record<string, unknown>> {
	if (entry.type !== "message" || !isRecord(entry.message)) return [];
	return Array.isArray(entry.message.content) ? entry.message.content.filter(isRecord) : [];
}
function entrySources(entries: SessionEntry[]): { sources: SourceReference[]; toolEntry: Map<string, string>; calls: Set<string> } {
	const sources: SourceReference[] = []; const toolEntry = new Map<string, string>(); const calls = new Set<string>();
	for (const entry of entries) {
		for (const part of parts(entry)) if (part.type === "toolCall" && part.name === "subagent" && typeof part.id === "string") { calls.add(part.id); toolEntry.set(part.id, entry.id); }
		if (entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "toolResult") continue;
		const message = entry.message as Record<string, unknown>; const details = isRecord(message.details) ? message.details : undefined; const toolCallId = text(message.toolCallId);
		if (message.toolName === "subagent" && toolCallId) calls.add(toolCallId);
		const runId = text(details?.runId) ?? text(details?.asyncId) ?? text(details?.id); const asyncDir = text(details?.asyncDir);
		if (!runId || !asyncDir) continue;
		const entryTime = Date.parse(entry.timestamp);
		sources.push({ workflowRunId: runId, asyncDir, toolCallId, parentEntryId: toolCallId ? (toolEntry.get(toolCallId) ?? entry.id) : undefined, observedAt: Number.isFinite(entryTime) ? entryTime : 0 });
	}
	return { sources, toolEntry, calls };
}
function uniqueWarnings(warnings: WarningRecord[]): WarningRecord[] {
	const seen = new Set<string>();
	return warnings.filter((warning) => { const key = `${warning.kind}\0${warning.path ?? ""}\0${warning.message}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
function statusFile(asyncDir: string, warnings: WarningRecord[]): string | undefined {
	try {
		const stat = fs.lstatSync(asyncDir); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("run source is not a regular non-symlink directory");
		const realDir = fs.realpathSync(asyncDir); const file = path.join(realDir, "status.json"); const fileStat = fs.lstatSync(file);
		if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error("status is not a regular non-symlink file");
		if (path.dirname(fs.realpathSync(file)) !== realDir) throw new Error("status escapes its run directory");
		return file;
	} catch (error) { warnings.push({ kind: "status", path: path.join(asyncDir, "status.json"), message: error instanceof Error ? error.message : String(error) }); return undefined; }
}

/** Used by ownerless process-local event hints before they may enter a session ledger. */
export function sourceMatchesSession(source: SourceReference, sessionId: string, sessionFile?: string): boolean {
	if (!source.asyncDir) return false;
	const warnings: WarningRecord[] = []; const file = statusFile(source.asyncDir, warnings); const value = file ? safeJsonFile(file, warnings, "status") : undefined;
	return isRecord(value) && value.runId === source.workflowRunId && exactOwner(value.sessionId, sessionId, sessionFile);
}

function readReceipt(asyncDir: string, workflowRunId: string, warnings: WarningRecord[]): ReceiptEntry[] | undefined {
	const file = path.join(asyncDir, "workflow-receipt.json"); if (!fs.existsSync(file)) return undefined;
	const value = safeJsonFile(file, warnings, "receipt", 1024 * 1024);
	if (!isRecord(value) || value.version !== 1 || value.workflowRunId !== workflowRunId || !["complete", "failed", "paused", "stopped"].includes(String(value.state)) || finite(value.createdAt) === undefined || !isRecord(value.entries)) { warnings.push({ kind: "receipt", path: file, message: "unsupported or malformed workflow receipt" }); return undefined; }
	const result: ReceiptEntry[] = [];
	for (const [key, raw] of Object.entries(value.entries)) {
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(key) || !isRecord(raw) || raw.key !== key || !isRecord(raw.continuation) || !Array.isArray(raw.continuation.runIds)) { warnings.push({ kind: "receipt", path: file, message: `invalid entry '${key}'` }); return undefined; }
		if (raw.continuation.runIds.some((id) => typeof id !== "string" || !id.trim())) { warnings.push({ kind: "receipt", path: file, message: `invalid lineage '${key}'` }); return undefined; }
		const runIds = [...new Set(raw.continuation.runIds as string[])];
		if (raw.latestRunId !== undefined && raw.latestRunId !== runIds.at(-1)) { warnings.push({ kind: "receipt", path: file, message: `stale lineage '${key}'` }); return undefined; }
		if (!isRecord(raw.resumability) || !["resumable", "not-resumable"].includes(String(raw.resumability.state)) || (raw.resumability.state === "resumable" && !raw.latestRunId) || (raw.resumability.state === "not-resumable" && !text(raw.resumability.reason))) { warnings.push({ kind: "receipt", path: file, message: `invalid resumability '${key}'` }); return undefined; }
		result.push({ key, agent: text(raw.agent), requestedContext: raw.requestedContext === "fresh" || raw.requestedContext === "fork" ? raw.requestedContext : undefined, resolvedContext: ["fresh", "fork", "mixed"].includes(String(raw.resolvedContext)) ? raw.resolvedContext as ReceiptEntry["resolvedContext"] : undefined, outputReference: text(raw.outputReference), runIds });
	}
	return result;
}
function usageTotal(value: unknown): number | undefined { return isRecord(value) ? finite(value.total) : undefined; }
function costUsd(value: unknown): number | undefined { return isRecord(value) ? finite(value.costUsd) : undefined; }
function outputPath(reference: string | undefined, status: Record<string, unknown>, asyncDir: string): string | undefined {
	if (!reference) return undefined;
	if (path.isAbsolute(reference)) return path.normalize(reference);
	const cwd = text(status.cwd); return path.resolve(cwd ?? asyncDir, reference);
}
function definedMerge(previous: AttemptRecord | undefined, current: AttemptRecord): AttemptRecord {
	if (!previous) return current;
	const defined = Object.fromEntries(Object.entries(current).filter(([, value]) => value !== undefined));
	return { ...previous, ...defined, nested: current.nested.length ? current.nested : previous.nested, activities: current.activities?.length ? current.activities : previous.activities };
}

function nestedAttempt(raw: Record<string, unknown>, roots: string[], outputRoot: string): AttemptRecord {
	const id = text(raw.id) ?? "nested-unknown";
	const nestedSteps = Array.isArray(raw.steps) ? raw.steps.filter(isRecord).map((step, index) => {
		const runId = text(step.runId); const stepId = runId ?? `${id}:step:${index}`;
		return { id: `attempt:${stepId}`, runId, provisional: !runId, state: normalizeState(step.status), agent: text(step.agent), model: text(step.model), thinking: text(step.thinking), startedAt: finite(step.startedAt), endedAt: finite(step.endedAt), durationMs: finite(step.durationMs), turnCount: finite(step.turnCount), toolCount: finite(step.toolCount), totalTokens: usageTotal(step.tokens), costUsd: costUsd(step.totalCost), error: text(step.error), currentTool: text(step.currentTool), sessionFile: text(step.sessionFile), transcriptPath: text(step.transcriptPath) ?? text(step.sessionFile), trustedRoots: [...roots, outputRoot], promptAttribution: "unavailable" as const, promptNote: "Prompt unavailable: nested launch evidence is not retained by this adapter.", nested: Array.isArray(step.children) ? step.children.filter(isRecord).map((child) => nestedAttempt(child, roots, outputRoot)) : [] };
	}) : [];
	const childRuns = Array.isArray(raw.children) ? raw.children.filter(isRecord).map((child) => nestedAttempt(child, roots, outputRoot)) : [];
	return { id: `attempt:${id}`, runId: text(raw.id), state: normalizeState(raw.state), agent: text(raw.agent), model: text(raw.model), thinking: text(raw.thinking), startedAt: finite(raw.startedAt), endedAt: finite(raw.endedAt), turnCount: finite(raw.turnCount), toolCount: finite(raw.toolCount), totalTokens: usageTotal(raw.totalTokens), costUsd: costUsd(raw.totalCost), error: text(raw.error), currentTool: text(raw.currentTool), sessionFile: text(raw.sessionFile), transcriptPath: text(raw.sessionFile), trustedRoots: [...roots, outputRoot], promptAttribution: "unavailable", promptNote: "Prompt unavailable: nested launch evidence is not retained by this adapter.", nested: [...nestedSteps, ...childRuns] };
}

function attemptFromStep(step: Record<string, unknown>, index: number, status: Record<string, unknown>, asyncDir: string, receipt: ReceiptEntry | undefined, warnings: WarningRecord[]): AttemptRecord {
	const runId = text(step.runId); const sessionFile = text(step.sessionFile); const transcriptPath = text(step.transcriptPath) ?? sessionFile;
	const roots = [text(status.sessionRoot), text(status.sessionDir), text(status.cwd), asyncDir].filter((item): item is string => !!item);
	const statusContext = step.context === "fresh" || step.context === "fork" ? step.context : (status.context === "fresh" || status.context === "fork" || status.context === "mixed" ? status.context : undefined);
	const context = receipt?.resolvedContext ?? statusContext;
	const freshRunZero = context === "fresh" && !!transcriptPath && path.basename(path.dirname(transcriptPath)) === "run-0";
	const prompt = readFreshPrompt(transcriptPath, roots, freshRunZero ? "fresh" : context === "fork" ? "fork" : undefined);
	if (prompt.warning) warnings.push({ kind: "transcript", path: transcriptPath, message: prompt.warning });
	const sessionUsage = readSessionUsage(transcriptPath, roots); if (sessionUsage.warning) warnings.push({ kind: "session", path: transcriptPath, message: sessionUsage.warning });
	const recentTools = Array.isArray(step.recentTools) ? step.recentTools.filter(isRecord).map((tool) => ({ tool: text(tool.tool) ?? "unknown", args: text(tool.args), endMs: finite(tool.endMs) })) : undefined;
	return {
		id: `attempt:${runId ?? `pending:${index}`}`, runId, provisional: !runId, state: normalizeState(step.status), agent: text(step.agent) ?? receipt?.agent, model: sessionUsage.model ?? text(step.model), thinking: text(step.thinking) ?? sessionUsage.thinking, context,
		startedAt: finite(step.startedAt), endedAt: finite(step.endedAt), durationMs: finite(step.durationMs), turnCount: finite(step.turnCount), toolCount: finite(step.toolCount), totalTokens: usageTotal(step.tokens) ?? sessionUsage.totalTokens, costUsd: costUsd(step.totalCost) ?? sessionUsage.costUsd, error: text(step.error), currentTool: text(step.currentTool), recentTools,
		recentOutput: Array.isArray(step.recentOutput) ? step.recentOutput.filter((line): line is string => typeof line === "string").slice(-50) : undefined, sessionFile, transcriptPath, outputPath: text(step.structuredOutputPath) ?? outputPath(receipt?.outputReference, status, asyncDir) ?? (status.mode !== "workflow" && index === 0 ? text(status.outputFile) : undefined), trustedRoots: roots,
		prompt: prompt.text, promptAttribution: prompt.attribution, promptNote: `${prompt.note}${prompt.truncated ? " · truncated" : ""}`, nested: Array.isArray(step.children) ? step.children.filter(isRecord).map((child) => nestedAttempt(child, roots, asyncDir)) : [],
	};
}
function assignActivities(attempts: AttemptRecord[], steps: Record<string, unknown>[], activities: ActivityRecord[], workflowRunId: string): ActivityRecord[] {
	const root: ActivityRecord[] = [];
	for (const activity of activities) {
		let index = activity.stepIndex;
		if (index === undefined && activity.workflowKey) index = steps.findIndex((step) => step.workflowKey === activity.workflowKey);
		if ((index === undefined || index < 0) && activity.runId && activity.runId !== workflowRunId) index = attempts.findIndex((attempt) => attempt.runId === activity.runId);
		const target = index !== undefined && index >= 0 ? attempts[index] : undefined;
		if (target) { (target.activities ??= []).push(activity); if (activity.attention !== undefined) target.attention = activity.attention; } else root.push(activity);
	}
	return root;
}
function historical(workflow: WorkflowRecord): WorkflowRecord { return { ...workflow, stale: true, warnings: [...(workflow.warnings ?? []), { kind: "status", message: "Live lifecycle detail unavailable; showing companion ledger history." }] }; }
function sourceOnly(source: SourceReference, warnings: WarningRecord[]): WorkflowRecord { return { id: `workflow:${source.workflowRunId}`, workflowRunId: source.workflowRunId, parentEntryId: source.parentEntryId, parentToolCallId: source.toolCallId, goal: source.goal, state: "unknown", asyncDir: source.asyncDir, attributed: !!source.parentEntryId, stale: true, logicalChildren: [], warnings }; }

function collectOne(source: SourceReference, sessionId: string, sessionFile: string | undefined, prior: WorkflowRecord | undefined, priorAttempts: Map<string, AttemptRecord>): WorkflowRecord | undefined {
	const warnings: WarningRecord[] = [];
	if (!source.asyncDir) return prior ? historical(prior) : sourceOnly(source, [{ kind: "status", message: "Lifecycle source unavailable." }]);
	const file = statusFile(source.asyncDir, warnings); if (!file) return prior ? { ...historical(prior), warnings: uniqueWarnings([...(prior.warnings ?? []), ...warnings]) } : sourceOnly(source, warnings);
	const value = safeJsonFile(file, warnings, "status"); if (!isRecord(value)) return prior ? { ...historical(prior), warnings: uniqueWarnings([...(prior.warnings ?? []), ...warnings]) } : sourceOnly(source, warnings);
	if (finite(value.lifecycleArtifactVersion) !== undefined && (value.lifecycleArtifactVersion as number) > 3) { warnings.push({ kind: "status", path: file, message: "unsupported lifecycle artifact version" }); return prior ? historical(prior) : sourceOnly(source, warnings); }
	if (typeof value.sessionId === "string" && !exactOwner(value.sessionId, sessionId, sessionFile)) return undefined;
	if (!text(value.runId) || !["single", "parallel", "chain", "workflow"].includes(String(value.mode)) || finite(value.startedAt) === undefined || !exactOwner(value.sessionId, sessionId, sessionFile)) { warnings.push({ kind: "status", path: file, message: "malformed lifecycle status" }); return prior ? historical(prior) : sourceOnly(source, warnings); }
	const workflowRunId = value.runId as string; if (workflowRunId !== source.workflowRunId) { warnings.push({ kind: "status", path: file, message: "run identity conflicts with its parent source" }); return prior ? historical(prior) : undefined; }
	const steps = Array.isArray(value.steps) ? value.steps.filter(isRecord) : []; const receipt = readReceipt(source.asyncDir, workflowRunId, warnings);
	const receiptByRun = new Map<string, ReceiptEntry>(); for (const entry of receipt ?? []) for (const runId of entry.runIds) receiptByRun.set(runId, entry);
	const current = steps.map((step, index) => attemptFromStep(step, index, value, source.asyncDir!, text(step.runId) ? receiptByRun.get(step.runId as string) : receipt?.find((entry) => entry.key === step.workflowKey), warnings));
	const attempts = current.map((item) => definedMerge(item.runId ? priorAttempts.get(item.runId) : undefined, item));
	const timeline = readEventTimeline(path.join(source.asyncDir, "events.jsonl"), [source.asyncDir]); if (timeline.warning && fs.existsSync(path.join(source.asyncDir, "events.jsonl"))) warnings.push({ kind: "events", path: path.join(source.asyncDir, "events.jsonl"), message: timeline.warning });
	if (timeline.truncated) warnings.push({ kind: "events", path: path.join(source.asyncDir, "events.jsonl"), message: "event history preview is truncated" });
	const activities = assignActivities(attempts, steps, timeline.activities, workflowRunId);
	const byRun = new Map(attempts.filter((item) => item.runId).map((item) => [item.runId!, item]));
	let logicalChildren: LogicalChildRecord[];
	if (receipt) {
		const used = new Set<string>();
		logicalChildren = receipt.map((entry) => ({ id: `logical:${workflowRunId}:${entry.key}`, workflowKey: entry.key, agent: entry.agent, requestedContext: entry.requestedContext, resolvedContext: entry.resolvedContext, lineageAvailable: true, attempts: entry.runIds.map((runId) => { used.add(runId); const found = byRun.get(runId) ?? priorAttempts.get(runId); return found ?? { id: `attempt:${runId}`, runId, state: "unknown", context: entry.resolvedContext, outputPath: outputPath(entry.outputReference, value, source.asyncDir!), trustedRoots: [text(value.sessionRoot), text(value.sessionDir), text(value.cwd), source.asyncDir!].filter((item): item is string => !!item), promptAttribution: "unavailable", promptNote: "Attempt artifacts unavailable.", nested: [] }; }) }));
		for (const [index, item] of attempts.entries()) if (!item.runId || !used.has(item.runId)) { const step = steps[index]; const key = text(step.workflowKey) ?? `status-${index + 1}`; logicalChildren.push({ id: `logical:${workflowRunId}:${key}`, workflowKey: key, label: text(step.label), phase: text(step.phase), agent: item.agent, lineageAvailable: false, attempts: [item] }); }
	} else {
		logicalChildren = attempts.map((item, index) => { const step = steps[index]; const key = text(step.workflowKey) ?? text(step.childId) ?? `step-${index + 1}`; return { id: `logical:${workflowRunId}:${key}`, workflowKey: key, label: text(step.label), phase: text(step.phase), agent: item.agent, requestedContext: step.context === "fresh" || step.context === "fork" ? step.context : undefined, lineageAvailable: false, attempts: [item] }; });
		if (logicalChildren.length) warnings.push({ kind: "receipt", path: path.join(source.asyncDir, "workflow-receipt.json"), message: "lineage unavailable" });
	}
	return { id: `workflow:${workflowRunId}`, workflowRunId, parentEntryId: source.parentEntryId, parentToolCallId: text(value.toolCallId) ?? source.toolCallId, goal: source.goal, state: normalizeState(value.state), startedAt: finite(value.startedAt), endedAt: finite(value.endedAt), durationMs: finite(value.durationMs), totalTokens: usageTotal(value.totalTokens), totalCostUsd: costUsd(value.totalCost), error: text(value.error), activities, asyncDir: source.asyncDir, attributed: !!source.parentEntryId, stale: false, logicalChildren, warnings: uniqueWarnings(warnings) };
}

export function collectHistory(options: CollectOptions): HistorySnapshot {
	const now = options.now ?? Date.now(); const manager = options.sessionManager; const sessionId = manager.getSessionId(); const sessionFile = manager.getSessionFile(); const warnings: WarningRecord[] = [];
	const ledger = readLedger(sessionId, warnings); const all = entrySources(manager.getEntries()); const branch = entrySources(manager.getBranch()); const visibleCalls = options.scope === "branch" ? branch.calls : all.calls; const entry = options.scope === "branch" ? branch : all;
	const merged = new Map<string, SourceReference>();
	for (const candidate of [...(ledger?.sources ?? []), ...all.sources, ...entry.sources]) {
		let source = candidate;
		if (!source.toolCallId && source.asyncDir) { const file = statusFile(source.asyncDir, warnings); const status = file ? safeJsonFile(file, warnings, "status") : undefined; if (isRecord(status) && status.runId === source.workflowRunId && exactOwner(status.sessionId, sessionId, sessionFile) && text(status.toolCallId)) source = { ...source, toolCallId: status.toolCallId as string }; }
		const parentEntryId = source.toolCallId ? (entry.toolEntry.get(source.toolCallId) ?? source.parentEntryId) : source.parentEntryId; const attributed = !!source.toolCallId && visibleCalls.has(source.toolCallId);
		if (options.scope === "branch" && !attributed) continue;
		if (options.scope === "session" && source.toolCallId && !all.calls.has(source.toolCallId) && source.parentEntryId) continue;
		merged.set(source.workflowRunId, { ...merged.get(source.workflowRunId), ...source, parentEntryId: attributed ? parentEntryId : undefined });
	}
	const prior = new Map((ledger?.workflows ?? []).map((workflow) => [workflow.workflowRunId, workflow])); const priorAttempts = new Map<string, AttemptRecord>();
	for (const workflow of ledger?.workflows ?? []) for (const child of workflow.logicalChildren) for (const attempt of child.attempts) if (attempt.runId) priorAttempts.set(attempt.runId, attempt);
	const workflows = [...merged.values()].map((source) => collectOne(source, sessionId, sessionFile, prior.get(source.workflowRunId), priorAttempts)).filter((workflow): workflow is WorkflowRecord => !!workflow);
	for (const workflow of workflows) if (options.scope === "session" && !workflow.parentEntryId) { workflow.attributed = false; workflow.warnings.push({ kind: "attribution", message: "Unattributed current-session workflow." }); }
	workflows.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
	const persistedSourceMap = new Map<string, SourceReference>(); for (const source of [...(ledger?.sources ?? []), ...all.sources, ...merged.values()]) persistedSourceMap.set(source.workflowRunId, { ...persistedSourceMap.get(source.workflowRunId), ...source });
	const persistedWorkflowMap = new Map<string, WorkflowRecord>((ledger?.workflows ?? []).map((workflow) => [workflow.workflowRunId, workflow])); for (const workflow of workflows) persistedWorkflowMap.set(workflow.workflowRunId, workflow);
	try { writeLedger({ version: 1, sessionId, sessionFile, updatedAt: now, sources: [...persistedSourceMap.values()], workflows: [...persistedWorkflowMap.values()] }); } catch (error) { warnings.push({ kind: "ledger", message: error instanceof Error ? error.message : String(error) }); }
	return { sessionId, sessionFile, sessionName: manager.getSessionName(), scope: options.scope, workflows, warnings: uniqueWarnings([...warnings, ...workflows.flatMap((workflow) => workflow.warnings)]), loadedAt: now };
}
export function sourceFromEvent(value: unknown): SourceReference | undefined {
	if (!isRecord(value)) return undefined; const workflowRunId = text(value.id) ?? text(value.runId); const asyncDir = text(value.asyncDir); if (!workflowRunId || !asyncDir) return undefined;
	return { workflowRunId, asyncDir, goal: text(value.goal), observedAt: Date.now() };
}
