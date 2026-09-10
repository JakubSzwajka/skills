export const TASK_STATUSES = ["active", "waiting", "paused", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const LOG_TYPES = ["decision", "context", "commit", "blocker", "next", "handoff"] as const;
export type LogType = (typeof LOG_TYPES)[number];

export interface Handoff {
	currentState: string;
	nextAction: string;
	blockers: string[];
	branchOrWorktree: string;
	latestCommit: string;
	validationState: string;
	references: string[];
}

export interface LogEntry {
	timestamp: string;
	session: string;
	type: string;
	text: string;
	handoff?: Handoff;
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

export type NewLogEntry =
	| { type: Exclude<LogType, "handoff">; text: string; session: string }
	| { type: "handoff"; text?: string; session: string; handoff: Handoff };

export class TaskCodecError extends Error {
	readonly path?: string;

	constructor(message: string, path?: string) {
		super(path ? `${message}: ${path}` : message);
		this.name = "TaskCodecError";
		this.path = path;
	}
}

const LOG_HEADING = "## Log";
const TASK_FORMAT = "task-log-v2";
export const ENCODED_LOG_HEADING = "## Encoded Log (task-log v2)";
const LEGACY_ENTRY_RE = /^### (\S+) · s:(\S+) · (\S+)\s*$/;
const V2_PREFIX = "<!-- task-log-entry:v2:";
const V2_RE = /^<!-- task-log-entry:v2:([A-Za-z0-9_-]+) -->$/;

function decodeScalar(value: string): string {
	if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
		try {
			const decoded = JSON.parse(value);
			if (typeof decoded === "string") return decoded;
		} catch {
			return value.slice(1, -1);
		}
	}
	if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
	return value;
}

export function quoteScalar(value: string): string {
	return /^[\w][\w .,/()#@+-]*$/.test(value) ? value : JSON.stringify(value);
}

interface Frontmatter {
	fields: Map<string, string>;
	refs: string[];
	body: string;
	headerLines?: string[];
}

function parseFrontmatter(text: string, path?: string): Frontmatter {
	const lines = text.split("\n");
	if (lines[0] !== "---") return { fields: new Map(), refs: [], body: text };
	const end = lines.indexOf("---", 1);
	if (end === -1) throw new TaskCodecError("Task frontmatter is not terminated", path);

	const fields = new Map<string, string>();
	const refs: string[] = [];
	const seenFields = new Set<string>();
	const headerLines = lines.slice(1, end);
	let inRefs = false;
	for (const line of headerLines) {
		const listItem = /^\s+-\s+(.*)$/.exec(line);
		if (inRefs && listItem) {
			refs.push(decodeScalar(listItem[1].trim()));
			continue;
		}
		const field = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
		if (!field) {
			if (/^\s*status\b/.test(line)) throw new TaskCodecError("Malformed task status field", path);
			inRefs = false;
			continue;
		}
		if (seenFields.has(field[1])) throw new TaskCodecError(`Duplicate task field "${field[1]}"`, path);
		seenFields.add(field[1]);
		inRefs = field[1] === "refs";
		if (inRefs) {
			const inline = field[2].trim();
			if (inline && inline !== "[]") refs.push(decodeScalar(inline));
		} else {
			fields.set(field[1], decodeScalar(field[2].trim()));
		}
	}

	return { fields, refs, body: lines.slice(end + 1).join("\n").replace(/^\n/, ""), headerLines };
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

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validateHandoff(value: unknown): Handoff {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new TaskCodecError("Handoff data must be an object");
	}
	const handoff = value as Record<string, unknown>;
	for (const field of ["currentState", "nextAction", "branchOrWorktree", "latestCommit", "validationState"] as const) {
		if (typeof handoff[field] !== "string") throw new TaskCodecError(`Handoff field "${field}" must be a string`);
	}
	for (const field of ["blockers", "references"] as const) {
		if (!isStringArray(handoff[field])) throw new TaskCodecError(`Handoff field "${field}" must be a string array`);
	}
	return {
		currentState: handoff.currentState as string,
		nextAction: handoff.nextAction as string,
		blockers: [...(handoff.blockers as string[])],
		branchOrWorktree: handoff.branchOrWorktree as string,
		latestCommit: handoff.latestCommit as string,
		validationState: handoff.validationState as string,
		references: [...(handoff.references as string[])],
	};
}

function decodeV2Entry(encoded: string, path?: string): LogEntry {
	try {
		const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;
		if (typeof parsed.timestamp !== "string" || typeof parsed.session !== "string" || typeof parsed.type !== "string" || typeof parsed.text !== "string") {
			throw new Error("required string fields are missing");
		}
		const entry: LogEntry = {
			timestamp: parsed.timestamp,
			session: parsed.session,
			type: parsed.type,
			text: parsed.text,
		};
		if (entry.type === "handoff") entry.handoff = validateHandoff(parsed.handoff);
		else if (parsed.handoff !== undefined) throw new Error("ordinary entries cannot contain handoff data");
		return entry;
	} catch (error) {
		if (error instanceof TaskCodecError) throw error;
		throw new TaskCodecError(`Malformed encoded log entry (${error instanceof Error ? error.message : String(error)})`, path);
	}
}

function parseLegacyEntries(lines: string[]): LogEntry[] {
	const entries: LogEntry[] = [];
	let current: LogEntry | undefined;
	let buffer: string[] = [];
	const flush = () => {
		if (!current) return;
		current.text = buffer.join("\n").trim();
		entries.push(current);
		current = undefined;
		buffer = [];
	};
	for (const line of lines) {
		const legacy = LEGACY_ENTRY_RE.exec(line);
		if (legacy) {
			flush();
			current = { timestamp: legacy[1], session: legacy[2], type: legacy[3], text: "" };
		} else if (current) {
			buffer.push(line);
		}
	}
	flush();
	return entries;
}

function encodedSectionIndex(lines: string[]): number {
	return lines.findLastIndex((line) => line === ENCODED_LOG_HEADING);
}

export function hasEncodedLogSection(raw: string): boolean {
	const parsed = parseFrontmatter(raw);
	if (parsed.fields.get("format") !== TASK_FORMAT) return false;
	const split = splitBody(parsed.body);
	return encodedSectionIndex(split.log.split("\n")) !== -1;
}

function parseEntries(log: string, path?: string): LogEntry[] {
	const lines = log.split("\n");
	const section = encodedSectionIndex(lines);
	if (section === -1) return parseLegacyEntries(lines);
	const entries = parseLegacyEntries(lines.slice(0, section));
	for (const line of lines.slice(section + 1)) {
		if (!line.trim()) continue;
		const match = V2_RE.exec(line);
		if (!match) throw new TaskCodecError("Malformed content in encoded log section", path);
		entries.push(decodeV2Entry(match[1], path));
	}
	return entries;
}

function parseStatus(value: string | undefined, path?: string): TaskStatus {
	if (value === undefined) return "active";
	if ((TASK_STATUSES as readonly string[]).includes(value)) return value as TaskStatus;
	throw new TaskCodecError(`Unknown task status "${value}"`, path);
}

export function decodeTask(raw: string, path: string): Task {
	const { fields, refs, body } = parseFrontmatter(raw, path);
	const split = splitBody(body);
	return {
		path,
		id: fields.get("id") ?? "",
		title: fields.get("title") ?? path.split("/").pop()?.replace(/\.md$/, "") ?? "untitled",
		status: parseStatus(fields.get("status"), path),
		created: fields.get("created") ?? "",
		refs,
		description: split.description,
		entries: fields.get("format") === TASK_FORMAT ? parseEntries(split.log, path) : parseLegacyEntries(split.log.split("\n")),
	};
}

export function encodeEntry(entry: LogEntry): string {
	const payload: Record<string, unknown> = {
		timestamp: entry.timestamp,
		session: entry.session,
		type: entry.type,
		text: entry.text,
	};
	if (entry.type === "handoff") payload.handoff = validateHandoff(entry.handoff);
	else if (entry.handoff !== undefined) throw new TaskCodecError("Ordinary entries cannot contain handoff data");
	return `${V2_PREFIX}${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")} -->`;
}

export function encodeNewTask(id: string, title: string, created: string, description: string): string {
	const normalizedDescription = description.trim();
	if (normalizedDescription.split("\n").some((line) => line.trim() === LOG_HEADING || line.trim() === ENCODED_LOG_HEADING)) {
		throw new TaskCodecError("Task description contains a reserved log boundary");
	}
	return [
		"---",
		`id: ${quoteScalar(id)}`,
		`title: ${quoteScalar(title)}`,
		"status: active",
		`created: ${quoteScalar(created)}`,
		`format: ${TASK_FORMAT}`,
		"refs: []",
		"---",
		"",
		normalizedDescription || "_No description yet._",
		"",
		LOG_HEADING,
		"",
		"",
	].join("\n");
}

export function upgradeTaskFormat(raw: string, path: string): string {
	const parsed = parseFrontmatter(raw, path);
	if (!parsed.headerLines) throw new TaskCodecError("Task format cannot be upgraded without frontmatter", path);
	if (parsed.fields.get("format") === TASK_FORMAT) return raw;
	return ["---", ...parsed.headerLines, `format: ${TASK_FORMAT}`, "---", "", parsed.body].join("\n");
}

export function updateTaskMetadata(raw: string, updates: { status?: TaskStatus; refs?: string[] }, path: string): string {
	const parsed = parseFrontmatter(raw, path);
	if (!parsed.headerLines) throw new TaskCodecError("Task metadata cannot be changed without frontmatter", path);
	parseStatus(parsed.fields.get("status"), path);
	const lines = [...parsed.headerLines];

	if (updates.status !== undefined) {
		if (!(TASK_STATUSES as readonly string[]).includes(updates.status)) throw new TaskCodecError(`Unknown task status "${updates.status}"`, path);
		const index = lines.findIndex((line) => /^status\s*:/.test(line));
		if (index === -1) lines.push(`status: ${updates.status}`);
		else lines[index] = `status: ${updates.status}`;
	}

	if (updates.refs !== undefined) {
		const index = lines.findIndex((line) => /^refs\s*:/.test(line));
		if (index !== -1) {
			let end = index + 1;
			while (end < lines.length && /^\s+-\s+/.test(lines[end])) end++;
			lines.splice(index, end - index);
		}
		const refs = updates.refs.length === 0 ? ["refs: []"] : ["refs:", ...updates.refs.map((ref) => `  - ${quoteScalar(ref)}`)];
		lines.splice(index === -1 ? lines.length : index, 0, ...refs);
	}

	return ["---", ...lines, "---", "", parsed.body].join("\n");
}
