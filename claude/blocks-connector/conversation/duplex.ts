import type { Envelope } from "../net/envelope.ts";
import { formatEnvelope, parseEnvelope } from "../net/envelope.ts";

export interface DuplexStream {
	write(data: unknown): void;
	events<T = unknown>(): AsyncIterable<T>;
}

export interface DuplexHooks {
	deliverAndWait(inbound: Envelope): Promise<string>;
	report?(status: string): void;
	onError?(error: unknown): void;
	shouldStop?(): boolean;
}

export interface DuplexResult {
	turns: number;
	stopped: "stream-ended" | "cancelled" | "error";
}

/** Sequential by design: each inbound frame is answered before the next is read. */
export async function runDuplex(stream: DuplexStream, hooks: DuplexHooks): Promise<DuplexResult> {
	let turns = 0;
	try {
		for await (const raw of stream.events()) {
			if (hooks.shouldStop?.()) return { turns, stopped: "cancelled" };
			const inbound = parseEnvelope(raw);
			if (!inbound) continue;
			hooks.report?.("waiting for the main session to reply");
			let replyText: string;
			try {
				replyText = await hooks.deliverAndWait(inbound);
			} catch (error) {
				hooks.onError?.(error);
				replyText = "I could not process this message. Please try again later.";
			}
			stream.write(formatEnvelope({ text: replyText }));
			turns += 1;
			if (hooks.shouldStop?.()) return { turns, stopped: "cancelled" };
		}
		return { turns, stopped: "stream-ended" };
	} catch (error) {
		hooks.onError?.(error);
		return { turns, stopped: "error" };
	}
}
