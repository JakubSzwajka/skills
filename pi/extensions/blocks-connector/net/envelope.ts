/**
 * The wire shape, both directions: `{ text, meta? }`.
 *
 * `text` is the message. `meta` is the additive escape hatch, so a domain
 * payload (a contract id, a conversation label) can ride along without a card
 * version bump. The connector never interprets `meta` — it passes it through
 * to the answering session as context and copies nothing back automatically.
 *
 * Parsing is deliberately tolerant. The same agent is reachable three ways
 * that each format the payload differently:
 *   - the SDK / another connector, sending JSON `{"text":"..."}`
 *   - Blocks' MCP `send_task`, which drops a bare `message` string into the
 *     first text-like input
 *   - the browser form generated from the card, which may send either
 * A stranger's badly-shaped message is still a message; refusing to parse it
 * would just look like an offline agent.
 */

export interface Envelope {
	readonly text: string;
	readonly meta?: Record<string, unknown>;
}

/** A request part as it arrives on StartTask, narrowed to what we read. */
export interface TextPart {
	partId?: string;
	text?: string;
	contentType?: string;
}

/**
 * Coerce one raw value (a JSON string, an already-parsed object, or plain
 * text) into an Envelope. Returns undefined only when there is no text at all.
 */
export function parseEnvelope(raw: unknown): Envelope | undefined {
	if (raw === null || raw === undefined) return undefined;

	if (typeof raw === "string") {
		const trimmed = raw.trim();
		if (trimmed === "") return undefined;
		if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
			try {
				const parsed = JSON.parse(trimmed) as unknown;
				const fromObject = parseEnvelope(parsed);
				if (fromObject) return fromObject;
			} catch {
				// Not JSON after all — fall through and treat it as prose.
			}
		}
		return { text: trimmed };
	}

	if (typeof raw !== "object") return { text: String(raw) };
	if (Array.isArray(raw)) {
		for (const item of raw) {
			const found = parseEnvelope(item);
			if (found) return found;
		}
		return undefined;
	}

	const obj = raw as Record<string, unknown>;
	// `message` and `reply` are accepted aliases: callers that never read our
	// card still tend to pick one of the three.
	const text = firstString(obj.text, obj.message, obj.reply);
	if (text === undefined) return undefined;
	const meta = isPlainObject(obj.meta) ? obj.meta : undefined;
	return meta ? { text, meta } : { text };
}

/** Pull the message out of a StartTask's request parts. */
export function envelopeFromParts(parts: readonly TextPart[] | undefined): Envelope | undefined {
	if (!parts || parts.length === 0) return undefined;

	// Prefer the input we declare in the card, then anything else with text.
	const preferred = parts.find((p) => p.partId === "message" && p.text !== undefined);
	const candidates = preferred ? [preferred, ...parts] : [...parts];
	for (const part of candidates) {
		const found = parseEnvelope(part.text);
		if (found) return found;
	}
	return undefined;
}

/** What we put on the wire. Always JSON, always both fields' contract. */
export function formatEnvelope(envelope: Envelope): string {
	return JSON.stringify(
		envelope.meta ? { text: envelope.text, meta: envelope.meta } : { text: envelope.text },
	);
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.trim() !== "") return value.trim();
	}
	return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
