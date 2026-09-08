import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
export const DEFAULT_REPLY_TIMEOUT_MS = 25 * 60 * 1000;
export const MAX_REPLY_TIMEOUT_MS = 1_790_000;

export interface ConnectorCard {
	identity: {
		agentName: string;
		displayName: string;
		description: string;
		version: string;
		provider: { organization: string };
	};
	capabilities: { taskKinds: Array<"request" | "pipe"> };
	streams?: Record<string, { direction: string; format: string }>;
	runtime?: {
		concurrency?: number;
		expectedInstances?: number;
		maxPendingBacklog?: number;
		maxRunningTimeSec?: number;
	};
	[key: string]: unknown;
}

export interface ConnectorConfig {
	apiKey: string;
	card: ConnectorCard;
	cardPath: string;
	cdmUrl: string | undefined;
	streamKey: string;
	maxConcurrent: number;
	replyTimeoutMs: number;
}

export type ConfigResult = { ok: true; config: ConnectorConfig } | { ok: false; reason: string };

export function loadConfig(configDir: string, env: NodeJS.ProcessEnv = process.env): ConfigResult {
	const localEnv = loadDotEnv(resolve(configDir, ".env"));
	const setting = (name: string): string | undefined => env[name] !== undefined ? env[name] : localEnv[name];
	const apiKey = setting("BLOCKS_API_KEY")?.trim();
	if (!apiKey) return { ok: false, reason: `BLOCKS_API_KEY is not set. Put it in ${resolve(configDir, ".env")} or export it before starting Claude Code.` };

	const cardPath = resolvePath(configDir, setting("PI_BLOCKS_CARD") ?? "agent-card.json");
	if (!existsSync(cardPath)) return { ok: false, reason: `No agent card at ${cardPath}. Copy agent-card.example.json into the current directory and choose a globally unique identity.agentName.` };

	let card: ConnectorCard;
	try { card = JSON.parse(readFileSync(cardPath, "utf-8")) as ConnectorCard; }
	catch (error) { return { ok: false, reason: `${cardPath} is not valid JSON: ${describe(error)}` }; }
	const invalid = validateCard(card);
	if (invalid) return { ok: false, reason: `${cardPath}: ${invalid}` };
	const streamKey = pickStreamKey(card);
	if (!streamKey) return { ok: false, reason: `${cardPath}: no bidirectional events stream declared for pipe tasks.` };

	return { ok: true, config: {
		apiKey,
		card,
		cardPath,
		cdmUrl: setting("BLOCKS_CDM_URL")?.trim() || undefined,
		streamKey,
		maxConcurrent: positiveInt(setting("PI_BLOCKS_MAX_CONCURRENT"), card.runtime?.concurrency ?? 3),
		replyTimeoutMs: Math.min(
			boundedReplyTimeout(setting("PI_BLOCKS_REPLY_TIMEOUT_MS")),
			Math.max(1, (card.runtime?.maxRunningTimeSec ?? 1800) * 1000 - 5_000),
		),
	} };
}

function validateCard(card: ConnectorCard): string | undefined {
	const name = card?.identity?.agentName;
	if (typeof name !== "string" || name === "") return "identity.agentName is required";
	if (!/^[a-zA-Z0-9_]+$/.test(name)) return `identity.agentName "${name}" must match ^[a-zA-Z0-9_]+$ and be globally unique`;
	if (name.startsWith("rename_me")) return "identity.agentName is still the placeholder";
	const kinds = card?.capabilities?.taskKinds;
	if (!Array.isArray(kinds) || !kinds.includes("request") || !kinds.includes("pipe")) return 'capabilities.taskKinds must include "request" and "pipe"';
	return undefined;
}

function pickStreamKey(card: ConnectorCard): string | undefined {
	for (const [key, declared] of Object.entries(card.streams ?? {})) {
		if (declared?.direction === "bidirectional" && declared?.format === "events") return key;
	}
	return undefined;
}

function loadDotEnv(file: string): NodeJS.ProcessEnv {
	const values: NodeJS.ProcessEnv = {};
	if (!existsSync(file)) return values;
	try {
		for (const rawLine of readFileSync(file, "utf-8").split("\n")) {
			const line = rawLine.trim();
			if (!line || line.startsWith("#")) continue;
			const eq = line.indexOf("=");
			if (eq <= 0) continue;
			const key = line.slice(0, eq).trim();
			let value = line.slice(eq + 1).trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
			values[key] = value;
		}
	} catch { /* Missing or unreadable local config is reported as a missing key. */ }
	return values;
}

function resolvePath(configDir: string, value: string): string { return isAbsolute(value) ? value : resolve(configDir, value); }
function positiveInt(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function boundedReplyTimeout(value: string | undefined): number {
	return Math.min(positiveInt(value, DEFAULT_REPLY_TIMEOUT_MS), MAX_REPLY_TIMEOUT_MS);
}
export function describe(error: unknown): string { return error instanceof Error ? error.message : String(error); }
