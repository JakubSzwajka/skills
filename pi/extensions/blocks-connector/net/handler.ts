import { describe } from "../config.ts";
import type { InboundBroker } from "../inbound/broker.ts";
import { runDuplex } from "../conversation/duplex.ts";
import type { Envelope } from "./envelope.ts";
import { envelopeFromParts, formatEnvelope } from "./envelope.ts";

interface TaskLike {
	taskId: string;
	taskKind?: string;
	ownerId?: string;
	orgId?: string;
	requestParts?: Array<{ partId?: string; text?: string }>;
	deadlineAt?: number | string;
	expiresAt?: number | string;
}

interface StreamLike {
	write(data: unknown): void;
	events<T = unknown>(): AsyncIterable<T>;
	end(): Promise<void>;
}

interface TaskContextLike {
	reportStatus(message: string): void;
	createStream(options?: Record<string, unknown>): Promise<StreamLike>;
	readonly isCancelled: boolean;
	readonly isExpired: boolean;
	readonly deadlineAt?: number | string;
	readonly expiresAt?: number | string;
}

interface HandlerResultLike {
	artifacts?: Array<{ data: string; mimeType: string; fileName?: string; outputId?: string }>;
}

export interface HandlerDeps {
	broker: InboundBroker;
	streamKey: string;
	maxConcurrent: number;
	replyTimeoutMs: number;
	notify(message: string, level?: "info" | "warning" | "error"): void;
	now?: () => number;
}

export function createHandler(deps: HandlerDeps) {
	let active = 0;
	return async function handleTask(task: TaskLike, ctx?: TaskContextLike): Promise<HandlerResultLike> {
		const peer = describePeer(task);
		const isPipe = task.taskKind === "pipe";
		if (active >= deps.maxConcurrent) {
			deps.notify(`declined a ${isPipe ? "pipe" : "request"} from ${peer} — concurrency cap reached`, "warning");
			return reply(`This agent is already handling ${deps.maxConcurrent} concurrent tasks. Please try again later.`);
		}
		active += 1; // Admission is reserved before the first await.
		try {
			const opening = envelopeFromParts(task.requestParts);
			if (!isPipe) return await handleRequest(deps, task, ctx, peer, opening);
			if (!ctx) return reply("Internal error: no task context, so no stream could be opened.");
			return await handlePipe(deps, task, ctx, peer, opening);
		} finally {
			// A task/stream is not resumable. Ensure no capability belonging to it
			// survives normal closure or an exceptional transport exit.
			deps.broker.cancelTask(task.taskId);
			active -= 1;
		}
	};
}

async function handleRequest(
	deps: HandlerDeps,
	task: TaskLike,
	ctx: TaskContextLike | undefined,
	peer: string,
	opening: Envelope | undefined,
): Promise<HandlerResultLike> {
	if (!opening) return reply("I received an empty message, so there is nothing to answer.");
	deps.notify(`request from ${peer}`, "info");
	try {
		ctx?.reportStatus("waiting for the main session to reply");
		return reply(await deliver(deps, task, ctx, peer, "request", opening));
	} catch (error) {
		deps.notify(`request from ${peer} failed: ${describe(error)}`, "error");
		return reply("I could not process this request. Please try again later.");
	}
}

async function handlePipe(
	deps: HandlerDeps,
	task: TaskLike,
	ctx: TaskContextLike,
	peer: string,
	opening: Envelope | undefined,
): Promise<HandlerResultLike> {
	deps.notify(`${peer} opened an inbound pipe (${task.taskId.slice(0, 8)})`, "info");
	let stream: StreamLike | undefined;
	let turns = 0;
	try {
		stream = await ctx.createStream({ direction: "bidirectional", format: "events", declaredStream: deps.streamKey });
		if (opening) {
			stream.write(formatEnvelope({ text: await deliver(deps, task, ctx, peer, "pipe", opening) }));
			turns += 1;
		}
		const result = await runDuplex(stream, {
			deliverAndWait: (inbound) => deliver(deps, task, ctx, peer, "pipe", inbound),
			report: (status) => ctx.reportStatus(status),
			shouldStop: () => ctx.isCancelled || ctx.isExpired,
			onError: (error) => deps.notify(`pipe with ${peer} errored: ${describe(error)}`, "error"),
		});
		turns += result.turns;
		return {
			artifacts: [{
				data: formatEnvelope({ text: `Pipe closed after ${turns} turn(s).`, meta: { turns, stopped: result.stopped, taskId: task.taskId } }),
				mimeType: "application/json",
				fileName: "conversation.json",
				outputId: "reply",
			}],
		};
	} catch (error) {
		deps.notify(`pipe with ${peer} failed: ${describe(error)}`, "error");
		return reply("I could not hold that pipe open. Please try again later.");
	} finally {
		try { await stream?.end(); } catch { /* The task is already closing. */ }
	}
}

async function deliver(
	deps: HandlerDeps,
	task: TaskLike,
	ctx: TaskContextLike | undefined,
	peer: string,
	kind: "request" | "pipe",
	envelope: Envelope,
): Promise<string> {
	const now = deps.now ?? Date.now;
	const localDeadline = now() + deps.replyTimeoutMs;
	const hardDeadline = earliestDeadline(task.deadlineAt, task.expiresAt, ctx?.deadlineAt, ctx?.expiresAt);
	const deadlineAt = hardDeadline ? Math.min(localDeadline, hardDeadline - 5_000) : localDeadline;
	const controller = new AbortController();
	const poll = ctx
		? setInterval(() => {
				if (ctx.isCancelled || ctx.isExpired) controller.abort();
			}, 100)
		: undefined;
	poll?.unref?.();
	try {
		return await deps.broker.requestReply(
			{ taskId: task.taskId, peer, kind, text: envelope.text, meta: envelope.meta },
			{ deadlineAt, signal: controller.signal },
		);
	} finally {
		if (poll) clearInterval(poll);
	}
}

function earliestDeadline(...values: Array<number | string | undefined>): number | undefined {
	const deadlines = values.flatMap((value) => {
		if (typeof value === "number" && Number.isFinite(value)) return [value];
		if (typeof value === "string") {
			const parsed = Date.parse(value);
			if (Number.isFinite(parsed)) return [parsed];
		}
		return [];
	});
	return deadlines.length > 0 ? Math.min(...deadlines) : undefined;
}

export function describePeer(task: TaskLike): string {
	const owner = task.ownerId?.trim();
	const org = task.orgId?.trim();
	if (owner && org) return `${owner} (org ${org})`;
	if (owner) return owner;
	if (org) return `org ${org}`;
	return "an unidentified caller";
}

function reply(text: string): HandlerResultLike {
	return { artifacts: [{ data: formatEnvelope({ text }), mimeType: "application/json", fileName: "reply.json", outputId: "reply" }] };
}
