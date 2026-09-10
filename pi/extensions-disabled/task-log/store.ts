import { existsSync, readFileSync, statSync } from "node:fs";
import {
	decodeTask,
	ENCODED_LOG_HEADING,
	encodeEntry,
	hasEncodedLogSection,
	LOG_TYPES,
	TASK_STATUSES,
	updateTaskMetadata,
	upgradeTaskFormat,
	validateHandoff,
	type Handoff,
	type LogEntry,
	type LogType,
	type NewLogEntry,
	type Task,
	type TaskStatus,
} from "./codec.ts";
import { atomicWriteFile, withFileLock } from "./locking.ts";
import {
	canonicalTasksDir,
	createCanonicalTask,
	isRepositoryTaskPath,
	repositoryTasks,
	taskMutationLockPath,
} from "./storage.ts";

export { LOG_TYPES, TASK_STATUSES, validateHandoff };
export type { Handoff, LogEntry, LogType, NewLogEntry, Task, TaskStatus };

const LOG_HEADING = "## Log";
const NO_SESSION = "nosess";

export function tasksDir(cwd: string): string {
	return canonicalTasksDir(cwd);
}

export function isTaskPath(cwd: string, path: string): boolean {
	return isRepositoryTaskPath(cwd, path);
}

export function nowStamp(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function sessionTag(sessionId: string | undefined): string {
	return sessionId ? sessionId.replace(/-/g, "").slice(0, 8) : NO_SESSION;
}

export function readTask(path: string): Task | undefined {
	if (!existsSync(path)) return undefined;
	return decodeTask(readFileSync(path, "utf8"), path);
}

export function listTasks(cwd: string): Task[] {
	return repositoryTasks(cwd).tasks.sort((a, b) => lastActivity(b) - lastActivity(a));
}

export function lastActivity(task: Task): number {
	const last = task.entries.at(-1);
	const stamp = last ? Date.parse(last.timestamp) : Date.parse(task.created);
	if (!Number.isNaN(stamp)) return stamp;
	try {
		return statSync(task.path).mtimeMs;
	} catch {
		return 0;
	}
}

export function sessionCount(task: Task): number {
	return new Set(task.entries.map((entry) => entry.session)).size;
}

export function createTask(cwd: string, title: string, description: string): Task {
	return createCanonicalTask(cwd, title, description, nowStamp());
}

function newEntry(input: NewLogEntry): LogEntry {
	const text = input.text?.trim() ?? "";
	if (input.type !== "handoff" && !text) throw new Error("Entry text is empty.");
	return {
		timestamp: nowStamp(),
		session: input.session,
		type: input.type,
		text,
		...(input.type === "handoff" ? { handoff: validateHandoff(input.handoff) } : {}),
	};
}

export function appendEntry(path: string, input: NewLogEntry): void {
	const entry = newEntry(input);
	withFileLock(taskMutationLockPath(path), () => {
		const raw = existsSync(path) ? readFileSync(path, "utf8") : "";
		if (!raw) throw new Error(`Task file is missing: ${path}`);
		const before = decodeTask(raw, path);
		const alreadyEncoded = hasEncodedLogSection(raw);
		const upgraded = upgradeTaskFormat(raw, path);
		const logPrefix = upgraded.includes(`\n${LOG_HEADING}`) || upgraded.startsWith(LOG_HEADING) ? "" : `\n${LOG_HEADING}\n`;
		const encodedPrefix = alreadyEncoded ? "" : `\n${ENCODED_LOG_HEADING}\n`;
		const separator = upgraded.endsWith("\n") ? "" : "\n";
		atomicWriteFile(path, `${upgraded}${separator}${logPrefix}${encodedPrefix}${encodeEntry(entry)}\n\n`);
		const persisted = decodeTask(readFileSync(path, "utf8"), path);
		const actual = persisted.entries.at(-1);
		if (persisted.entries.length !== before.entries.length + 1 || !actual || encodeEntry(actual) !== encodeEntry(entry)) {
			throw new Error(`Task entry could not be verified after persistence: ${path}`);
		}
	});
}

export function setStatus(path: string, status: TaskStatus): void {
	withFileLock(taskMutationLockPath(path), () => {
		const raw = readFileSync(path, "utf8");
		const updated = updateTaskMetadata(raw, { status }, path);
		atomicWriteFile(path, updated);
		if (decodeTask(readFileSync(path, "utf8"), path).status !== status) {
			throw new Error(`Task status could not be verified after persistence: ${path}`);
		}
	});
}

export function mutateReferences(path: string, mutate: (refs: string[]) => string[]): string[] {
	return withFileLock(taskMutationLockPath(path), () => {
		const raw = readFileSync(path, "utf8");
		const current = decodeTask(raw, path);
		const normalized = mutate([...current.refs]).map((ref) => ref.trim());
		if (normalized.some((ref) => !ref)) throw new Error("Task references cannot be empty.");
		const updated = updateTaskMetadata(raw, { refs: normalized }, path);
		atomicWriteFile(path, updated);
		const persisted = decodeTask(readFileSync(path, "utf8"), path).refs;
		if (persisted.length !== normalized.length || persisted.some((ref, index) => ref !== normalized[index])) {
			throw new Error(`Task references could not be verified after persistence: ${path}`);
		}
		return persisted;
	});
}

export function readActiveTaskForContinuation(path: string): Task | undefined {
	return withFileLock(taskMutationLockPath(path), () => {
		const task = readTask(path);
		return task?.status === "active" ? task : undefined;
	});
}

export function sanitizeTaskOutput(value: unknown): string {
	return String(value ?? "")
		.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b[P_X^][\s\S]*?\x1b\\/g, "")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/\x1b[@-_]/g, "")
		.replace(/\u009d[^\u0007\u009c]*(?:\u0007|\u009c)/g, "")
		.replace(/[\u0090\u0098\u009e\u009f][\s\S]*?\u009c/g, "")
		.replace(/\u009b[0-?]*[ -/]*[@-~]/g, "")
		.replace(/\t/g, "    ")
		.replace(/\r\n?/g, "\n")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
}

export function renderEntry(entry: LogEntry): string {
	const heading = `### ${sanitizeTaskOutput(entry.timestamp)} · s:${sanitizeTaskOutput(entry.session)} · ${sanitizeTaskOutput(entry.type)}`;
	if (entry.type !== "handoff" || !entry.handoff) return `${heading}\n${sanitizeTaskOutput(entry.text)}`;
	const handoff = entry.handoff;
	return [
		heading,
		`Current state: ${sanitizeTaskOutput(handoff.currentState)}`,
		`Next action: ${sanitizeTaskOutput(handoff.nextAction)}`,
		`Blockers: ${sanitizeTaskOutput(handoff.blockers.join(", ") || "none")}`,
		`Branch/worktree: ${sanitizeTaskOutput(handoff.branchOrWorktree)}`,
		`Latest commit: ${sanitizeTaskOutput(handoff.latestCommit)}`,
		`Validation: ${sanitizeTaskOutput(handoff.validationState)}`,
		`References: ${sanitizeTaskOutput(handoff.references.join(", ") || "none")}`,
		...(entry.text ? ["", sanitizeTaskOutput(entry.text)] : []),
	].join("\n");
}

export function relativeTime(timestamp: number): string {
	if (!timestamp) return "unknown";
	const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
	if (seconds < 60) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
}
