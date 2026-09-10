import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

export type SpecKind = "spec" | "ticket";

export interface SpecCandidate {
	path: string;
	relativePath: string;
	title: string;
	kind: SpecKind;
	modifiedAt: number;
}

export interface SpecLink {
	path: string;
	title: string;
	kind: SpecKind;
}

const SKIP_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", "coverage", "out", ".next", ".venv", "__pycache__"]);
const MAX_DEPTH = 5;
const TITLE_SCAN_BYTES = 4096;
const MAX_TITLE = 80;

/** `<slug>/SPEC.md` anywhere, plus `.pi/SPEC.md`. Both precedents in this repo use that name. */
export const isSpecFileName = (name: string): boolean => name.toLowerCase() === "spec.md";

/** `/to-tickets` writes `issues/NN-slug.md`; the number keeps dependency order. */
export const isTicketFileName = (name: string): boolean => /^\d{1,3}-.+\.md$/i.test(name);

export function sanitizeDisplay(text: string, max = MAX_TITLE): string {
	// eslint-disable-next-line no-control-regex
	const flat = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** First Markdown heading, else the file name turned back into words. */
export function extractTitle(content: string, path: string): string {
	for (const line of content.split("\n", 60)) {
		const heading = /^\s{0,3}#{1,3}\s+(.*\S)/.exec(line);
		if (heading) return sanitizeDisplay(heading[1].replace(/#+\s*$/, ""));
	}
	const name = basename(path).replace(/\.md$/i, "");
	const words = name.replace(/^\d{1,3}-/, "").replace(/[-_]+/g, " ").trim();
	return sanitizeDisplay(words || name);
}

export function classify(path: string): SpecKind | undefined {
	const name = basename(path);
	if (isSpecFileName(name)) return "spec";
	if (isTicketFileName(name) && basename(join(path, "..")) === "issues") return "ticket";
	return undefined;
}

function walk(directory: string, depth: number, found: string[]): void {
	if (depth > MAX_DEPTH || found.length > 400) return;
	let entries: ReturnType<typeof readdirSync>;
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const full = join(directory, entry.name);
		if (entry.isDirectory()) {
			if (SKIP_DIRECTORIES.has(entry.name)) continue;
			if (entry.name.startsWith(".") && entry.name !== ".scratch" && entry.name !== ".pi") continue;
			walk(full, depth + 1, found);
		} else if (entry.isFile() && classify(full)) {
			found.push(full);
		}
	}
}

export function sortByRecency(candidates: SpecCandidate[]): SpecCandidate[] {
	return [...candidates].sort((a, b) => b.modifiedAt - a.modifiedAt || a.relativePath.localeCompare(b.relativePath));
}

export function describe(path: string, root: string): SpecCandidate | undefined {
	const kind = classify(path);
	if (!kind) return undefined;
	try {
		const stats = statSync(path);
		if (!stats.isFile()) return undefined;
		const head = readFileSync(path, "utf8").slice(0, TITLE_SCAN_BYTES);
		return { path, relativePath: relative(root, path) || basename(path), title: extractTitle(head, path), kind, modifiedAt: stats.mtimeMs };
	} catch {
		return undefined;
	}
}

/** Every spec and ticket under `root`, newest first. */
export function discover(root: string): SpecCandidate[] {
	const paths: string[] = [];
	walk(root, 0, paths);
	const candidates: SpecCandidate[] = [];
	for (const path of paths) {
		const candidate = describe(path, root);
		if (candidate) candidates.push(candidate);
	}
	return sortByRecency(candidates);
}

export function formatAge(modifiedAt: number, now: number): string {
	const minutes = Math.floor(Math.max(0, now - modifiedAt) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

export function pickerLabel(candidate: SpecCandidate, now: number): string {
	return `${candidate.title}  ·  ${sanitizeDisplay(candidate.relativePath, 60)}  ·  ${candidate.kind}, ${formatAge(candidate.modifiedAt, now)}`;
}

/** The whole per-turn cost. The link, never the body. */
export function renderNote(link: SpecLink): string {
	return [
		`[spec-link] The operator linked one ${link.kind} to this session: "${sanitizeDisplay(link.title)}".`,
		`Path: ${link.path}`,
		"It states what they want worked on. Read the file when you need its content; this note carries only the link.",
	].join("\n");
}
