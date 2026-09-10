import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { formatProgressLine, formatTally, type Progress, readProgress } from "./progress.ts";

/**
 * A feature is one folder of record: the spec, the tickets, or both.
 * `/spec` lists features, never single files, because naming the work is the
 * operator's job and sequencing the slices is the orchestrator's.
 */
export interface Feature {
	/** The feature folder itself. */
	path: string;
	relativePath: string;
	title: string;
	specPath?: string;
	ticketsPath?: string;
	ticketCount: number;
	/** Derived from the tickets themselves, so the picker cannot show a stale claim. */
	progress?: Progress;
	/** Newest modification among the records the folder holds. */
	modifiedAt: number;
}

/** What the session stores. The folder is the identity; the rest is re-derived. */
export interface FeatureLink {
	path: string;
	title: string;
	specPath?: string;
	ticketsPath?: string;
	ticketCount: number;
}

const SKIP_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", "coverage", "out", ".next", ".venv", "__pycache__"]);
const MAX_DEPTH = 5;
const TITLE_SCAN_BYTES = 4096;
const MAX_TITLE = 80;
const TITLE_COLUMN = 34;
const PATH_COLUMN = 44;

/** `<slug>/SPEC.md` anywhere, plus `.pi/SPEC.md`. Both precedents in this repo use that name. */
export const isSpecFileName = (name: string): boolean => name.toLowerCase() === "spec.md";

/** `/to-tickets` writes `issues/NN-slug.md`; the number keeps dependency order. */
export const isTicketFileName = (name: string): boolean => /^\d{1,3}-.+\.md$/i.test(name);

export function sanitizeDisplay(text: string, max = MAX_TITLE): string {
	// eslint-disable-next-line no-control-regex
	const flat = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** First Markdown heading, else the file or folder name turned back into words. */
export function extractTitle(content: string, path: string): string {
	for (const line of content.split("\n", 60)) {
		const heading = /^\s{0,3}#{1,3}\s+(.*\S)/.exec(line);
		if (heading) return sanitizeDisplay(heading[1].replace(/#+\s*$/, ""));
	}
	return nameAsWords(path);
}

export function nameAsWords(path: string): string {
	const name = basename(path).replace(/\.md$/i, "");
	const words = name.replace(/^\d{1,3}-/, "").replace(/[-_]+/g, " ").trim();
	return sanitizeDisplay(words || name);
}

/**
 * One rule, stated from the record's side: a record lives directly in its
 * feature folder, or one level down in that folder's `issues/` or `.pi/`
 * container. `.pi` is tooling storage inside a module, not the feature's name,
 * so the module is the folder a human would call the feature.
 */
export function featureFolderOf(recordPath: string): string {
	let folder = dirname(recordPath);
	if (basename(folder) === "issues") folder = dirname(folder);
	if (basename(folder) === ".pi") folder = dirname(folder);
	return folder;
}

const entriesOf = (directory: string): ReturnType<typeof readdirSync> => {
	try {
		return readdirSync(directory, { withFileTypes: true });
	} catch {
		return [];
	}
};

const isRecord = (path: string): boolean => {
	const name = basename(path);
	if (isSpecFileName(name)) return true;
	return isTicketFileName(name) && basename(dirname(path)) === "issues";
};

function walk(directory: string, depth: number, found: Set<string>): void {
	if (depth > MAX_DEPTH || found.size > 200) return;
	for (const entry of entriesOf(directory)) {
		const full = join(directory, entry.name);
		if (entry.isDirectory()) {
			if (SKIP_DIRECTORIES.has(entry.name)) continue;
			if (entry.name.startsWith(".") && entry.name !== ".scratch" && entry.name !== ".pi") continue;
			walk(full, depth + 1, found);
		} else if (entry.isFile() && isRecord(full)) {
			found.add(featureFolderOf(full));
		}
	}
}

const mtimeOf = (path: string): number | undefined => {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return undefined;
	}
};

/** The spec, if the folder or its `.pi` container holds one. */
function findSpec(folder: string): string | undefined {
	for (const directory of [folder, join(folder, ".pi")]) {
		for (const entry of entriesOf(directory)) {
			if (entry.isFile() && isSpecFileName(entry.name)) return join(directory, entry.name);
		}
	}
	return undefined;
}

function findTickets(folder: string): { path: string; files: string[] } | undefined {
	for (const directory of [join(folder, "issues"), join(folder, ".pi", "issues")]) {
		const files = ticketFilesOf(directory);
		if (files.length > 0) return { path: directory, files };
	}
	return undefined;
}

/** Reads one feature folder. Returns nothing when the folder holds no record. */
export function describeFeature(folder: string, root: string): Feature | undefined {
	const specPath = findSpec(folder);
	const tickets = findTickets(folder);
	if (!specPath && !tickets) return undefined;
	const stamps = [specPath, ...(tickets?.files ?? [])].map((path) => (path ? mtimeOf(path) : undefined));
	const modifiedAt = Math.max(0, ...stamps.filter((stamp): stamp is number => stamp !== undefined));
	let title = nameAsWords(folder);
	if (specPath) {
		try {
			title = extractTitle(readFileSync(specPath, "utf8").slice(0, TITLE_SCAN_BYTES), specPath);
		} catch {
			// An unreadable spec still leaves a feature worth listing.
		}
	}
	return {
		path: folder,
		relativePath: relative(root, folder) || basename(folder),
		title,
		specPath,
		ticketsPath: tickets?.path,
		ticketCount: tickets?.files.length ?? 0,
		progress: tickets ? readProgress(tickets.files) : undefined,
		modifiedAt,
	};
}

export function sortByRecency(features: Feature[]): Feature[] {
	return [...features].sort((a, b) => b.modifiedAt - a.modifiedAt || a.relativePath.localeCompare(b.relativePath));
}

/** Every feature under `root`, newest first, one row per folder of record. */
export function discover(root: string): Feature[] {
	const folders = new Set<string>();
	walk(root, 0, folders);
	const features: Feature[] = [];
	for (const folder of folders) {
		const feature = describeFeature(folder, root);
		if (feature) features.push(feature);
	}
	return sortByRecency(features);
}

export function formatAge(modifiedAt: number, now: number): string {
	const minutes = Math.floor(Math.max(0, now - modifiedAt) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

/**
 * What the folder holds, in the operator's words. Tickets report progress
 * rather than a bare count, because the count alone answers nothing. A missing
 * `spec` token is how a spec-less feature reads; a feature with neither record
 * is not a feature at all.
 */
export function contents(feature: Pick<Feature, "specPath" | "ticketCount" | "progress">): string {
	const parts: string[] = [];
	if (feature.progress && feature.ticketCount > 0) parts.push(formatTally(feature.progress));
	if (feature.specPath) parts.push("spec");
	if (parts.length === 0) parts.push("no records");
	return parts.join(", ");
}

/** Aligned columns: title, folder, contents and age. */
export function pickerLabels(features: Feature[], now: number): string[] {
	const titles = features.map((feature) => sanitizeDisplay(feature.title, TITLE_COLUMN));
	const paths = features.map((feature) => sanitizeDisplay(feature.relativePath, PATH_COLUMN));
	const titleWidth = Math.max(0, ...titles.map((title) => title.length));
	const pathWidth = Math.max(0, ...paths.map((path) => path.length));
	return features.map(
		(feature, index) =>
			`${titles[index].padEnd(titleWidth)}  ·  ${paths[index].padEnd(pathWidth)}  ·  ${contents(feature)}, ${formatAge(feature.modifiedAt, now)}`,
	);
}

/** Every ticket file in an `issues/` directory, in number order. */
function ticketFilesOf(ticketsPath: string): string[] {
	return entriesOf(ticketsPath)
		.filter((entry) => entry.isFile() && isTicketFileName(entry.name))
		.map((entry) => join(ticketsPath, entry.name))
		.sort();
}

/**
 * The whole per-turn cost. The link, never the body.
 *
 * Progress is re-derived on every turn, so ticking a box shows up on the next
 * turn without a timer, a cache or a write.
 */
export function renderNote(link: FeatureLink): string {
	const lines = [`[spec-link] The operator linked this feature: "${sanitizeDisplay(link.title)}".`, `Folder: ${link.path}`];
	lines.push(link.specPath ? `Spec: ${link.specPath}` : "Spec: none written yet, so the intent lives only in the tickets.");
	if (link.ticketsPath) {
		const files = ticketFilesOf(link.ticketsPath);
		if (files.length > 0) {
			lines.push(formatProgressLine(readProgress(files)));
			lines.push(`Ticket files: ${link.ticketsPath}`);
		}
	}
	lines.push("Read the files when you need them; this note carries only the link.");
	return lines.join("\n");
}
