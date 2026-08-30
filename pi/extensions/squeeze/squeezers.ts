/**
 * Pure helpers. No pi imports and no I/O, so they stay unit-testable.
 */

/**
 * pi truncates bash output at 50KB using truncateTail, keeping the END and
 * dropping the start, then appends a pointer to the full log. For a search that
 * is backwards: the first hits are the ones that matter.
 *
 * Detect that marker so the caller can re-read the spill file and summarise the
 * original instead of the surviving tail.
 */
export function parseSpillPointer(text: string): { path: string; note: string } | undefined {
	const m = /\n\n\[Showing [^\]]*?Full output: (\S+?)\]\s*$/.exec(text);
	if (!m) return undefined;
	return { path: m[1], note: m[0].trim() };
}

export function buildSummaryPrompt(command: string, text: string, budget: number): string {
	return [
		"You are compressing a shell command's output so it can stay in an AI coding agent's context window.",
		"The agent already read the full output once. You are producing the version it will carry from now on.",
		"",
		`Command that produced it:\n  ${command}`,
		"",
		`Rewrite the output in under ${budget} characters. Rules:`,
		"- Preserve concrete facts: names, paths, ids, counts, versions, error text, exact values.",
		"- Preserve anything that looks like a decision input or a failure.",
		"- Drop repetition, progress noise, decoration, and successful-step chatter.",
		"- For search output, list each matching file with its hit count and one representative match,",
		"  keeping the original file order. Do not reorder by frequency.",
		"- For build or test logs, keep the failures and the final summary; drop passing steps.",
		"- Never invent a path, symbol, or value that is not in the output.",
		"- If you are unsure whether a detail matters, keep it.",
		"- Output only the compressed content. No preamble, no commentary, no advice.",
		"",
		"OUTPUT:",
		text,
	].join("\n");
}
