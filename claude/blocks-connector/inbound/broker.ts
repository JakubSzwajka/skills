import { randomUUID } from "node:crypto";

export const DEADLINE_FALLBACK =
	"I could not provide an answer before this task's deadline. Please try again later.";
export const DELIVERY_FALLBACK =
	"I could not deliver this message to the answering session. Please try again later.";

export interface InboundMessage {
	taskId: string;
	peer: string;
	kind: "request" | "pipe";
	text: string;
	meta?: Record<string, unknown>;
}

export interface DeliveredMessage extends InboundMessage {
	/** Opaque reply capability. It is never a list position or task id. */
	reference: string;
	deadlineAt: number;
}

export interface MainSessionHost {
	deliver(message: DeliveredMessage): void | Promise<void>;
}

export type ReplyResult = "sent" | "expired" | "unknown";
export type RecentState = "replied" | "timed-out" | "cancelled" | "delivery-failed";

export interface PendingSnapshot extends DeliveredMessage {
	createdAt: number;
}

export interface RecentSnapshot extends PendingSnapshot {
	finishedAt: number;
	state: RecentState;
}

interface Pending extends PendingSnapshot {
	resolve(text: string): void;
	timer: ReturnType<typeof setTimeout>;
	removeAbort?: () => void;
}

export interface InboundBroker {
	requestReply(
		message: InboundMessage,
		options: { deadlineAt: number; signal?: AbortSignal },
	): Promise<string>;
	reply(reference: string, text: string): ReplyResult;
	pending(): PendingSnapshot[];
	recent(): RecentSnapshot[];
	cancelTask(taskId: string): void;
	cancelAll(): void;
	onChange(listener: () => void): () => void;
}

export function createInboundBroker(host: MainSessionHost, now = Date.now): InboundBroker {
	const waiting = new Map<string, Pending>();
	const finished = new Map<string, RecentSnapshot>();
	const listeners = new Set<() => void>();

	function changed(): void {
		for (const listener of listeners) listener();
	}

	function remember(entry: Pending, state: RecentState): void {
		finished.set(entry.reference, { ...snapshot(entry), state, finishedAt: now() });
		while (finished.size > 20) finished.delete(finished.keys().next().value as string);
	}

	function claim(reference: string, state: RecentState, text: string): boolean {
		const entry = waiting.get(reference);
		if (!entry) return false;
		// Delete before any callback or promise continuation can run. This is the
		// atomic capability claim that prevents a second caller winning the reply.
		waiting.delete(reference);
		clearTimeout(entry.timer);
		entry.removeAbort?.();
		remember(entry, state);
		entry.resolve(text);
		changed();
		return true;
	}

	async function requestReply(
		message: InboundMessage,
		options: { deadlineAt: number; signal?: AbortSignal },
	): Promise<string> {
		if (options.signal?.aborted || options.deadlineAt <= now()) return DEADLINE_FALLBACK;

		const reference = randomUUID();
		let resolve!: (text: string) => void;
		const answer = new Promise<string>((settle) => {
			resolve = settle;
		});
		const entry: Pending = {
			...message,
			reference,
			deadlineAt: options.deadlineAt,
			createdAt: now(),
			resolve,
			timer: setTimeout(
				() => claim(reference, "timed-out", DEADLINE_FALLBACK),
				Math.max(0, options.deadlineAt - now()),
			),
		};
		waiting.set(reference, entry);
		if (options.signal) {
			const abort = () => claim(reference, "cancelled", DEADLINE_FALLBACK);
			options.signal.addEventListener("abort", abort, { once: true });
			entry.removeAbort = () => options.signal?.removeEventListener("abort", abort);
			// Close the race where the signal aborts after the early check but
			// before its listener is attached.
			if (options.signal.aborted) abort();
		}
		if (!waiting.has(reference)) return answer;
		changed();

		try {
			// Delivery is deliberately not awaited. A host adapter may schedule work
			// asynchronously, but cancellation and shutdown must still settle this
			// request even if that scheduling promise never does.
			void Promise.resolve(host.deliver(snapshot(entry))).catch(() => {
				claim(reference, "delivery-failed", DELIVERY_FALLBACK);
			});
		} catch {
			claim(reference, "delivery-failed", DELIVERY_FALLBACK);
		}
		return answer;
	}

	return {
		requestReply,
		reply(reference, text) {
			if (claim(reference, "replied", text)) return "sent";
			return finished.has(reference) ? "expired" : "unknown";
		},
		pending: () => [...waiting.values()].map(snapshot),
		recent: () => [...finished.values()].reverse(),
		cancelTask(taskId) {
			for (const entry of [...waiting.values()]) {
				if (entry.taskId === taskId) claim(entry.reference, "cancelled", DEADLINE_FALLBACK);
			}
		},
		cancelAll() {
			for (const reference of [...waiting.keys()]) {
				claim(reference, "cancelled", DEADLINE_FALLBACK);
			}
		},
		onChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

function snapshot(entry: Pending): PendingSnapshot {
	return {
		taskId: entry.taskId,
		peer: entry.peer,
		kind: entry.kind,
		text: entry.text,
		meta: entry.meta,
		reference: entry.reference,
		deadlineAt: entry.deadlineAt,
		createdAt: entry.createdAt,
	};
}
