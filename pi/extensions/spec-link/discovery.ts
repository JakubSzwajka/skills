import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

export type SpecStatus = "pending" | "done";

export interface SpecMetadata {
	schemaVersion: 1;
	title: string;
	status: SpecStatus;
	completedAt?: string;
}

export interface SpecRecord extends SpecMetadata {
	kind: "spec";
	path: string;
	folder: string;
	metadataPath: string;
}

export interface InvalidSpec {
	kind: "invalid";
	path: string;
	folder: string;
	error: string;
}

export type DiscoveredSpec = SpecRecord | InvalidSpec;

const RECENT_DONE_MS = 72 * 60 * 60 * 1000;
const MAX_TITLE = 80;
const TITLE_COLUMN = 40;
const FOLDER_COLUMN = 42;
const SPEC_FOLDER = /^\d{4}-\d{2}-\d{2}_[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const defaultSpecRoot = (): string => join(homedir(), ".pi", "specs");

export function sanitizeDisplay(text: string, max = MAX_TITLE): string {
	// Control bytes can redraw or forge terminal output, so picker and status text always pass through this boundary.
	// eslint-disable-next-line no-control-regex
	const flat = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function directChild(root: string, folder: string): boolean {
	const rootPath = resolve(root);
	const folderPath = resolve(folder);
	return dirname(folderPath) === rootPath && relative(rootPath, folderPath) === basename(folderPath);
}

function invalid(folder: string, error: string): InvalidSpec {
	return { kind: "invalid", path: folder, folder: basename(folder), error };
}

function parseMetadata(value: unknown): SpecMetadata | string {
	if (!value || typeof value !== "object" || Array.isArray(value)) return "spec.json must contain an object";
	const data = value as Record<string, unknown>;
	if (data.schemaVersion !== 1) return "spec.json schemaVersion must be 1";
	if (typeof data.title !== "string" || sanitizeDisplay(data.title).length === 0) return "spec.json title must be a non-empty string";
	if (data.status !== "pending" && data.status !== "done") return 'spec.json status must be "pending" or "done"';
	if (data.status === "pending" && Object.hasOwn(data, "completedAt")) return "pending specs must not have completedAt";
	if (data.status === "done") {
		if (typeof data.completedAt !== "string") return "done specs must have a valid completedAt timestamp";
		const completedAt = new Date(data.completedAt);
		if (!Number.isFinite(completedAt.valueOf()) || completedAt.toISOString() !== data.completedAt) {
			return "done specs must have a canonical UTC completedAt timestamp";
		}
		return { schemaVersion: 1, title: data.title, status: "done", completedAt: data.completedAt };
	}
	return { schemaVersion: 1, title: data.title, status: "pending" };
}

export function describeSpec(folder: string, root: string): DiscoveredSpec {
	const folderPath = resolve(folder);
	if (!directChild(root, folderPath)) return invalid(folderPath, "spec folder must be a direct child of the spec root");
	if (!SPEC_FOLDER.test(basename(folderPath))) return invalid(folderPath, "folder name must match YYYY-MM-DD_feature-slug");
	try {
		if (!lstatSync(folderPath).isDirectory()) return invalid(folderPath, "spec path is not a directory");
	} catch {
		return invalid(folderPath, "spec folder cannot be read");
	}
	const metadataPath = join(folderPath, "spec.json");
	try {
		if (!lstatSync(metadataPath).isFile()) return invalid(folderPath, "spec.json must be a regular file");
		const parsed = parseMetadata(JSON.parse(readFileSync(metadataPath, "utf8")));
		if (typeof parsed === "string") return invalid(folderPath, parsed);
		return { kind: "spec", path: folderPath, folder: basename(folderPath), metadataPath, ...parsed };
	} catch (error) {
		const detail = error instanceof SyntaxError ? "spec.json is not valid JSON" : "spec.json cannot be read";
		return invalid(folderPath, detail);
	}
}

function entriesOf(root: string): ReturnType<typeof readdirSync> {
	try {
		return readdirSync(root, { withFileTypes: true });
	} catch {
		return [];
	}
}

export function discover(root: string, now = Date.now(), mountedPath?: string): DiscoveredSpec[] {
	const mounted = mountedPath ? resolve(mountedPath) : undefined;
	const found: DiscoveredSpec[] = [];
	for (const entry of entriesOf(root)) {
		if (!entry.isDirectory()) continue;
		const record = describeSpec(join(root, entry.name), root);
		if (
			record.kind === "invalid" ||
			record.status === "pending" ||
			resolve(record.path) === mounted ||
			(now - Date.parse(record.completedAt ?? "") <= RECENT_DONE_MS && now >= Date.parse(record.completedAt ?? ""))
		) {
			found.push(record);
		}
	}
	return found.sort((a, b) => b.folder.localeCompare(a.folder));
}

export function pickerLabels(records: DiscoveredSpec[]): string[] {
	const titles = records.map((record) => sanitizeDisplay(record.kind === "spec" ? record.title : record.folder, TITLE_COLUMN));
	const folders = records.map((record) => sanitizeDisplay(record.folder, FOLDER_COLUMN));
	const titleWidth = Math.max(0, ...titles.map((title) => title.length));
	const folderWidth = Math.max(0, ...folders.map((folder) => folder.length));
	const ordinalWidth = String(records.length).length;
	return records.map((record, index) => {
		const status = record.kind === "spec" ? record.status : "invalid";
		const detail = record.kind === "invalid" ? `  ·  ${sanitizeDisplay(record.error)}` : "";
		// The ordinal keeps truncated rows distinct and is the exact value resolved after selection.
		return `${String(index + 1).padStart(ordinalWidth)}.  ${titles[index].padEnd(titleWidth)}  ·  ${status.padEnd(7)}  ·  ${folders[index].padEnd(folderWidth)}${detail}`;
	});
}

export function renderNote(record: SpecRecord): string {
	return [
		`[spec-link] Mounted spec: "${sanitizeDisplay(record.title)}".`,
		`Status: ${record.status}`,
		`Folder: ${record.path}`,
		"Read files in this folder when needed. This note contains no file bodies.",
	].join("\n");
}
