import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type FragmentPlacement = "before" | "after";
export type FragmentScope = "global" | "project";

export interface PromptFragment {
	filename: string;
	title: string;
	description: string;
	placement: FragmentPlacement;
	order: number;
	body: string;
	scope: FragmentScope;
}

interface FragmentMetadata extends Record<string, unknown> {
	placement?: unknown;
	title?: unknown;
	description?: unknown;
	order?: unknown;
}

export interface DiscoveryOptions {
	globalDir: string;
	projectDir: string;
	includeProject: boolean;
}

export interface DiscoveryResult {
	fragments: PromptFragment[];
	warnings: string[];
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function compareFragments(left: PromptFragment, right: PromptFragment): number {
	return left.order - right.order || compareText(left.title, right.title) || compareText(left.filename, right.filename);
}

export function parseFragment(content: string, filename: string, scope: FragmentScope): PromptFragment {
	const { frontmatter, body } = parseFrontmatter<FragmentMetadata>(content);
	if (frontmatter.placement !== "before" && frontmatter.placement !== "after") {
		throw new Error('"placement" must be "before" or "after"');
	}
	if (frontmatter.title !== undefined && typeof frontmatter.title !== "string") {
		throw new Error('"title" must be a string');
	}
	if (frontmatter.description !== undefined && typeof frontmatter.description !== "string") {
		throw new Error('"description" must be a string');
	}
	if (frontmatter.order !== undefined && (typeof frontmatter.order !== "number" || !Number.isFinite(frontmatter.order))) {
		throw new Error('"order" must be a finite number');
	}

	return {
		filename,
		title: frontmatter.title ?? filename.replace(/\.md$/, ""),
		description: frontmatter.description ?? "",
		placement: frontmatter.placement,
		order: frontmatter.order ?? 0,
		body,
		scope,
	};
}

function fragmentFiles(dir: string, warnings: string[]): string[] {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
			.map((entry) => entry.name)
			.sort(compareText);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") warnings.push(`${dir}: ${error instanceof Error ? error.message : String(error)}`);
		return [];
	}
}

/** Discover direct Markdown children. Project filenames replace global filenames before parsing. */
export function discoverFragments(options: DiscoveryOptions): DiscoveryResult {
	const warnings: string[] = [];
	const candidates = new Map<string, { path: string; scope: FragmentScope }>();

	for (const filename of fragmentFiles(options.globalDir, warnings)) {
		candidates.set(filename, { path: join(options.globalDir, filename), scope: "global" });
	}
	if (options.includeProject) {
		for (const filename of fragmentFiles(options.projectDir, warnings)) {
			candidates.set(filename, { path: join(options.projectDir, filename), scope: "project" });
		}
	}

	const fragments: PromptFragment[] = [];
	for (const [filename, candidate] of candidates) {
		try {
			fragments.push(parseFragment(readFileSync(candidate.path, "utf8"), filename, candidate.scope));
		} catch (error) {
			warnings.push(`${candidate.scope} fragment ${filename}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	return { fragments: fragments.sort(compareFragments), warnings };
}

function joinWithBlankLines(parts: readonly string[]): string {
	return parts.reduce((result, part) => {
		if (!result) return part;
		const trailing = result.match(/\n*$/)?.[0].length ?? 0;
		const leading = part.match(/^\n*/)?.[0].length ?? 0;
		return result + "\n".repeat(Math.max(0, 2 - trailing - leading)) + part;
	}, "");
}

export function composePrompt(editorText: string, selected: readonly PromptFragment[]): string {
	if (selected.length === 0) return editorText;
	const before = selected.filter((fragment) => fragment.placement === "before").sort(compareFragments);
	const after = selected.filter((fragment) => fragment.placement === "after").sort(compareFragments);
	return joinWithBlankLines(
		[...before.map((fragment) => fragment.body), editorText, ...after.map((fragment) => fragment.body)]
			.filter((part) => part.length > 0),
	);
}
