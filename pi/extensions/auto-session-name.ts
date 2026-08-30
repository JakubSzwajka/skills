import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

const TITLE_MODELS = [
	{ provider: "openai-codex", id: "gpt-5.6-luna" },
	{ provider: "anthropic", id: "claude-haiku-4-5" },
] as const;
const MAX_TITLE_CHARS = 28;
const MAX_TITLE_WORDS = 4;
const MAX_SOURCE_CHARS = 4_000;

const TITLE_PROMPT = `Name this conversation for a narrow sidebar.

Rules:
- Return only the title, with no quotes, label, or punctuation.
- Use 2 to 4 specific words.
- Use at most ${MAX_TITLE_CHARS} characters including spaces.
- Describe the user's actual task or question.
- Use the same language as the user.
- Avoid generic titles such as "New conversation", "Help request", or "Coding task".`;

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";

	return content
		.filter(
			(part): part is { type: "text"; text: string } =>
				typeof part === "object" && part !== null && part.type === "text" && typeof part.text === "string",
		)
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function firstUserPrompt(entries: SessionEntry[]): string {
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		const text = textFromContent(entry.message.content);
		if (text) return text;
	}
	return "";
}

function truncateAtWordBoundary(value: string, maxChars: number): string {
	const characters = [...value];
	if (characters.length <= maxChars) return value;

	const clipped = characters.slice(0, maxChars + 1).join("");
	const boundary = clipped.lastIndexOf(" ");
	return (boundary > 0 ? clipped.slice(0, boundary) : characters.slice(0, maxChars).join("")).trim();
}

export function cleanSessionTitle(raw: string): string {
	let title = raw
		.split(/\r?\n/, 1)[0]
		.replace(/^\s*#+\s*/, "")
		.replace(/^\s*(?:title|name)\s*:\s*/i, "")
		.replace(/^[\s`"'“”‘’]+|[\s`"'“”‘’]+$/gu, "")
		.replace(/[.!?,;:]+$/u, "")
		.replace(/\s+/g, " ")
		.trim();

	title = title.split(" ").slice(0, MAX_TITLE_WORDS).join(" ");
	return truncateAtWordBoundary(title, MAX_TITLE_CHARS);
}

function canNameSession(ctx: ExtensionContext): boolean {
	return ctx.mode !== "print" && ctx.mode !== "json" && ctx.sessionManager.getSessionFile() !== undefined;
}

export default function (pi: ExtensionAPI) {
	let attempted = false;
	let generation = 0;
	let request: AbortController | undefined;

	const generateName = (source: string, ctx: ExtensionContext) => {
		if (attempted || pi.getSessionName() || !canNameSession(ctx)) return;

		const prompt = source.trim().slice(0, MAX_SOURCE_CHARS);
		if (!prompt) return;

		attempted = true;
		const currentGeneration = generation;
		request = new AbortController();

		void (async () => {
			for (const candidate of TITLE_MODELS) {
				if (generation !== currentGeneration || request?.signal.aborted || pi.getSessionName()) return;

				const model = ctx.modelRegistry.find(candidate.provider, candidate.id);
				if (!model || !ctx.modelRegistry.hasConfiguredAuth(model)) continue;

				try {
					const response = await ctx.modelRegistry.complete(
						model,
						{
							systemPrompt: TITLE_PROMPT,
							messages: [
								{
									role: "user",
									content: [{ type: "text", text: prompt }],
									timestamp: Date.now(),
								},
							],
						},
						{
							signal: request.signal,
							maxTokens: 32,
							temperature: 0,
							cacheRetention: "none",
							sessionId: randomUUID(),
							timeoutMs: 15_000,
							maxRetries: 0,
						},
					);

					if (generation !== currentGeneration || request?.signal.aborted || pi.getSessionName()) return;

					const title = cleanSessionTitle(
						response.content
							.filter((part): part is { type: "text"; text: string } => part.type === "text")
							.map((part) => part.text)
							.join("\n"),
					);

					if (title) {
						pi.setSessionName(title);
						return;
					}
				} catch {
					// Try the next configured naming model.
				}
			}
		})().finally(() => {
			if (generation === currentGeneration) request = undefined;
		});
	};

	pi.on("session_start", (_event, ctx) => {
		generation += 1;
		request?.abort();
		request = undefined;
		attempted = false;

		if (pi.getSessionName() || !canNameSession(ctx)) return;
		generateName(firstUserPrompt(ctx.sessionManager.getBranch()), ctx);
	});

	pi.on("before_agent_start", (event, ctx) => {
		generateName(event.prompt, ctx);
	});

	pi.on("session_info_changed", (event) => {
		if (event.name) request?.abort();
	});

	pi.on("session_shutdown", () => {
		generation += 1;
		request?.abort();
		request = undefined;
	});
}
