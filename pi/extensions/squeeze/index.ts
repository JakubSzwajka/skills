/**
 * squeeze - keep oversized bash output out of the *repeated* context cost.
 *
 * A tool result is not a one-time cost. It is re-sent on every subsequent LLM
 * call until compaction. Measured over 28 sessions in one repo, 5% of bash calls
 * produced 54% of all bash context.
 *
 * Design:
 *   tool_result  -> untouched. The agent asked for that output, it gets all of it.
 *   context      -> older bash results are replaced with a model-written summary.
 *
 * The summary is produced by a background call to a small model. Until it is
 * ready the original stays in place, so nothing is ever mechanically mangled and
 * nothing blocks a request.
 *
 * The session file is never modified. `context` receives a structuredClone and
 * its return value is used for the outgoing request only, so /resume, scrollback
 * and later analysis still see the original bytes.
 *
 * Modes:  off | llm
 * Toggle: /squeeze [off|llm]
 * Debug:  PI_SQUEEZE_LOG=/path/to/log
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildSummaryPrompt, parseSpillPointer } from "./squeezers.ts";

type Mode = "off" | "llm";

/** Results at or under this are left alone. */
const SQUEEZE_OVER = 8_000;
/** Target size for a summarised result. */
const BUDGET = 2_000;
/** How many of the most recent oversized results keep full fidelity. */
const KEEP_RECENT = 2;

const SUMMARY_MODEL = { provider: "anthropic", id: "claude-haiku-4-5" };

/** Set PI_SQUEEZE_LOG=/path/to/log to record every squeeze. Off when unset. */
const LOG_PATH = process.env.PI_SQUEEZE_LOG;

const log = (line: string) => {
	if (!LOG_PATH) return;
	try {
		appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`, "utf8");
	} catch {
		// Observability must never break the request.
	}
};

const DEFAULT_MODE: Mode = (() => {
	const raw = process.env.PI_SQUEEZE?.toLowerCase();
	return raw === "0" || raw === "off" ? "off" : "llm";
})();

type Entry = { text: string; from: number; to: number };

export default function (pi: ExtensionAPI) {
	let mode: Mode = DEFAULT_MODE;

	/** toolCallId -> summarised form. Stable once written, so the prompt cache re-settles. */
	const cache = new Map<string, Entry>();
	/** toolCallId currently being summarised. */
	const inFlight = new Set<string>();
	/** toolCallId that failed summarisation; do not retry in a loop. */
	const failed = new Set<string>();
	/** toolCallId -> spill file on disk. */
	const spills = new Map<string, string>();

	let spillDir: string | undefined;

	const spill = (id: string, text: string): string => {
		const existing = spills.get(id);
		if (existing) return existing;
		spillDir ??= mkdtempSync(join(tmpdir(), "pi-squeeze-"));
		const file = join(spillDir, `${id.replace(/[^\w-]/g, "_").slice(-40)}.txt`);
		writeFileSync(file, text, "utf8");
		spills.set(id, file);
		return file;
	};

	const stats = () => {
		let from = 0;
		let to = 0;
		for (const e of cache.values()) {
			from += e.from;
			to += e.to;
		}
		return { from, to, saved: from - to, n: cache.size };
	};

	const showStatus = (ctx: ExtensionContext) => {
		if (mode === "off") {
			ctx.ui.setStatus("squeeze", "");
			return;
		}
		const { saved, n } = stats();
		ctx.ui.setStatus("squeeze", n === 0 ? "squeeze:llm" : `squeeze:llm -${Math.round(saved / 1000)}k`);
	};

	/**
	 * Summarise in the background. Never blocks a request; the result lands in the
	 * cache and is picked up on a later turn. Until then the original stays whole.
	 */
	const summarise = (id: string, command: string, text: string, recovered: boolean, ctx: ExtensionContext) => {
		if (inFlight.has(id) || failed.has(id)) return;

		const model = ctx.modelRegistry.find(SUMMARY_MODEL.provider, SUMMARY_MODEL.id);
		if (!model || !ctx.modelRegistry.hasConfiguredAuth(model)) {
			failed.add(id);
			log(`no auth for ${SUMMARY_MODEL.provider}/${SUMMARY_MODEL.id}, leaving output whole`);
			return;
		}

		inFlight.add(id);
		void (async () => {
			try {
				const response = await ctx.modelRegistry.complete(
					model,
					{
						messages: [
							{
								role: "user" as const,
								content: [{ type: "text" as const, text: buildSummaryPrompt(command, text, BUDGET) }],
								timestamp: Date.now(),
							},
						],
					},
					{ reasoningEffort: "low", cacheRetention: "none", sessionId: randomUUID() },
				);

				const summary = response.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("\n")
					.trim();

				if (summary.length === 0 || summary.length >= text.length) {
					failed.add(id);
					log(`summary not smaller, keeping original :: ${command.slice(0, 80)}`);
					return;
				}

				const note = [
					`[squeezed by ${SUMMARY_MODEL.id}: ${text.length} -> ${summary.length} chars`,
					recovered ? "; recovered from pi's 50KB truncation, so this covers the full output" : "",
					`. Full output: ${spill(id, text)}]`,
				].join("");

				cache.set(id, { text: `${summary}\n\n${note}`, from: text.length, to: summary.length });
				log(
					`squeezed${recovered ? "+recovered" : ""} ${text.length}->${summary.length} (${Math.round((100 * summary.length) / text.length)}%) :: ${command.replace(/\s+/g, " ").slice(0, 90)}`,
				);
			} catch (err) {
				failed.add(id);
				log(`summary failed: ${err instanceof Error ? err.message : String(err)}`);
			} finally {
				inFlight.delete(id);
			}
		})();
	};

	pi.on("context", async (event, ctx) => {
		if (mode === "off") return;

		const messages = event.messages as Array<Record<string, any>>;

		// Map toolCallId -> the bash command that produced it.
		const commands = new Map<string, string>();
		for (const m of messages) {
			if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
			for (const part of m.content) {
				if (part?.type === "toolCall" && part.name === "bash" && typeof part.id === "string") {
					commands.set(part.id, String(part.arguments?.command ?? ""));
				}
			}
		}

		// Indices of oversized bash results, oldest first.
		const candidates: number[] = [];
		for (let i = 0; i < messages.length; i++) {
			const m = messages[i];
			if (m.role !== "toolResult" || m.toolName !== "bash" || !Array.isArray(m.content)) continue;
			const len = m.content.reduce((n: number, c: any) => n + (c?.type === "text" ? c.text.length : 0), 0);
			if (len > SQUEEZE_OVER) candidates.push(i);
		}

		// The newest few stay whole. This also keeps any rewrite near the tail of
		// the conversation, so the prompt cache prefix survives.
		const eligible = candidates.slice(0, Math.max(0, candidates.length - KEEP_RECENT));
		if (eligible.length === 0) return;

		let replaced = 0;

		for (const i of eligible) {
			const m = messages[i];
			const id: string = m.toolCallId;
			const cached = cache.get(id);

			if (cached) {
				messages[i] = {
					...m,
					content: [{ type: "text", text: cached.text }, ...m.content.filter((c: any) => c?.type !== "text")],
				};
				replaced++;
				continue;
			}

			// Not summarised yet. Kick it off and leave the original in place.
			let original = m.content
				.filter((c: any) => c?.type === "text")
				.map((c: any) => c.text)
				.join("");

			// If pi already truncated this at 50KB it kept the tail and dropped the
			// start. Recover the original so we summarise the whole thing.
			let recovered = false;
			const pointer = parseSpillPointer(original);
			if (pointer && existsSync(pointer.path)) {
				try {
					const full = readFileSync(pointer.path, "utf8");
					if (full.length > original.length) {
						spills.set(id, pointer.path);
						original = full;
						recovered = true;
					}
				} catch {
					// Keep the truncated text.
				}
			}

			summarise(id, commands.get(id) ?? "", original, recovered, ctx);
		}

		if (replaced === 0) return;
		const { from, to } = stats();
		log(`context: ${replaced} replaced, ${candidates.length - replaced} whole, running total ${from}->${to}`);
		showStatus(ctx);
		return { messages };
	});

	pi.registerCommand("squeeze", {
		description: "Toggle bash-output squeezing (off | llm)",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();

			if (arg === "off" || arg === "llm") {
				mode = arg;
			} else if (arg === "") {
				mode = mode === "off" ? "llm" : "off";
			} else {
				const { from, to, saved, n } = stats();
				ctx.ui.notify(
					n === 0
						? `squeeze: ${mode}, nothing squeezed yet${inFlight.size > 0 ? `, ${inFlight.size} in flight` : ""}`
						: `squeeze: ${mode}, ${n} results, ${from.toLocaleString()} -> ${to.toLocaleString()} chars (saved ${saved.toLocaleString()})`,
					"info",
				);
				return;
			}

			showStatus(ctx);
			ctx.ui.notify(`squeeze: ${mode}`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => showStatus(ctx));
}
