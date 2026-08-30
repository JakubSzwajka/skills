import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

export const LOG_TYPES = ["decision", "context", "commit", "blocker", "next"] as const;
export type LogType = (typeof LOG_TYPES)[number];

export type TaskStatus = "active" | "done";

export interface LogEntry {
	timestamp: string;
	session: string;
	type: string;
	text: string;
}

export interface Task {
	path: string;
	id: string;
	title: string;
	status: TaskStatus;
	created: string;
	refs: string[];
	description: string;
	entries: LogEntry[];
}

const LOG_HEADING = "## Log";
const ENTRY_RE = /^### (\S+) · s:(\S+) · (\S+)\s*$/;
const NO_SESSION = "nosess";

export function tasksDir(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, "tasks");
}

export function isTaskPath(cwd: string, path: string): boolean {
	const dir = tasksDir(cwd);
	return path === dir || path.startsWith(`${dir}/`);
}

export function nowStamp(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function sessionTag(sessionId: string | undefined): string {
	return sessionId ? sessionId.replace(/-/g, "").slice(0, 8) : NO_SESSION;
}

function slugify(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48)
		.replace(/-+$/g, "");
	return slug || "task";
}

function parseFrontmatter(text: string): { fields: Map<string, string>; refs: string[]; body: string } {
	const fields = new Map<string, string>();
	const refs: string[] = [];

	if (!text.startsWith("---\n")) return { fields, refs, body: text };
	const end = text.indexOf("\n---", 3);
	if (end === -1) return { fields, refs, body: text };

	const header = text.slice(4, end);
	const body = text.slice(end + 4).replace(/^\n/, "");

	let inRefs = false;
	for (const line of header.split("\n")) {
		const listItem = /^\s+-\s+(.*)$/.exec(line);
		if (inRefs && listItem) {
			refs.push(unquote(listItem[1].trim()));
			continue;
		}
		const field = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
		if (!field) continue;
		inRefs = field[1] === "refs";
		if (inRefs) {
			const inline = field[2].trim();
			if (inline && inline !== "[]") refs.push(unquote(inline));
			continue;
		}
		fields.set(field[1], unquote(field[2].trim()));
	}

	return { fields, refs, body };
}

function unquote(value: string): string {
	if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'")) && value.endsWith(value[0])) {
		return value.slice(1, -1);
	}
	return value;
}

function quote(value: string): string {
	return /^[\w][\w .,/()#@+-]*$/.test(value) ? value : JSON.stringify(value);
}

function splitBody(body: string): { description: string; log: string } {
	const lines = body.split("\n");
	const index = lines.findIndex((line) => line.trim() === LOG_HEADING);
	if (index === -1) return { description: body.trim(), log: "" };
	return {
		description: lines.slice(0, index).join("\n").trim(),
		log: lines.slice(index + 1).join("\n"),
	};
}

function parseEntries(log: string): LogEntry[] {
	const entries: LogEntry[] = [];
	let current: LogEntry | undefined;
	let buffer: string[] = [];

	const flush = () => {
		if (!current) return;
		current.text = buffer.join("\n").trim();
		entries.push(current);
		buffer = [];
	};

	for (const line of log.split("\n")) {
		const match = ENTRY_RE.exec(line);
		if (match) {
			flush();
			current = { timestamp: match[1], session: match[2], type: match[3], text: "" };
			continue;
		}
		if (current) buffer.push(line);
	}
	flush();
	return entries;
}

export function readTask(path: string): Task | undefined {
	if (!existsSync(path)) return undefined;
	const raw = readFileSync(path, "utf8");
	const { fields, refs, body } = parseFrontmatter(raw);
	const { description, log } = splitBody(body);
	const status = fields.get("status") === "done" ? "done" : "active";

	return {
		path,
		id: fields.get("id") ?? "",
		title: fields.get("title") ?? path.split("/").pop()?.replace(/\.md$/, "") ?? "untitled",
		status,
		created: fields.get("created") ?? "",
		refs,
		description,
		entries: parseEntries(log),
	};
}

export function listTasks(cwd: string): Task[] {
	const dir = tasksDir(cwd);
	if (!existsSync(dir)) return [];

	const tasks: Task[] = [];
	for (const name of readdirSync(dir)) {
		if (!name.endsWith(".md")) continue;
		const task = readTask(join(dir, name));
		if (task) tasks.push(task);
	}

	return tasks.sort((a, b) => lastActivity(b) - lastActivity(a));
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
	const dir = tasksDir(cwd);
	mkdirSync(dir, { recursive: true });

	const id = `t-${Math.random().toString(16).slice(2, 8)}`;
	const base = slugify(title);
	let path = join(dir, `${base}.md`);
	if (existsSync(path)) path = join(dir, `${base}-${id.slice(2)}.md`);

	const header = [
		"---",
		`id: ${id}`,
		`title: ${quote(title)}`,
		"status: active",
		`created: ${nowStamp()}`,
		"refs: []",
		"---",
		"",
		description.trim() || "_No description yet._",
		"",
		LOG_HEADING,
		"",
		"",
	].join("\n");

	writeFileSync(path, header, "utf8");
	return readTask(path)!;
}

export function appendEntry(path: string, entry: { type: string; text: string; session: string }): void {
	const raw = existsSync(path) ? readFileSync(path, "utf8") : "";
	if (!raw) throw new Error(`Task file is missing: ${path}`);

	const prefix = raw.includes(`\n${LOG_HEADING}`) || raw.startsWith(LOG_HEADING) ? "" : `\n${LOG_HEADING}\n`;
	const separator = raw.endsWith("\n") ? "" : "\n";
	const block = `### ${nowStamp()} · s:${entry.session} · ${entry.type}\n${entry.text.trim()}\n\n`;

	appendFileSync(path, `${separator}${prefix}${block}`, "utf8");
}

export function setStatus(path: string, status: TaskStatus): void {
	const raw = readFileSync(path, "utf8");
	const updated = raw.replace(/^status:.*$/m, `status: ${status}`);
	writeFileSync(path, updated, "utf8");
}

export function renderEntry(entry: LogEntry): string {
	return `### ${entry.timestamp} · s:${entry.session} · ${entry.type}\n${entry.text}`;
}

/** Task header plus its log, oldest entries dropped first when over the char budget. */
export function renderTask(task: Task, maxChars: number): { text: string; dropped: number } {
	const head = [
		`# ${task.title}`,
		"",
		`id: ${task.id} · status: ${task.status} · created: ${task.created} · file: ${task.path}`,
		...(task.refs.length ? [`refs: ${task.refs.join(", ")}`] : []),
		"",
		task.description,
		"",
		`## Log (${task.entries.length} entries, ${sessionCount(task)} sessions)`,
		"",
		"",
	].join("\n");

	const rendered = task.entries.map(renderEntry);
	let dropped = 0;
	while (rendered.length > 0 && head.length + rendered.join("\n\n").length > maxChars) {
		rendered.shift();
		dropped += 1;
	}

	const notice = dropped > 0 ? `_${dropped} older entries omitted. Use task_read for the full log._\n\n` : "";
	const body = rendered.length > 0 ? rendered.join("\n\n") : "_Log is empty._";
	return { text: `${head}${notice}${body}\n`, dropped };
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
