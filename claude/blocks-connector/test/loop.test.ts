/**
 * The whole point of the connector, end to end, with no network.
 *
 * A fake Blocks task goes into the real handler, the real broker holds it, the
 * real socket pushes it to a watcher standing in for Monitor, blocks_reply's
 * path resolves it, and the handler returns the artifact that would go back on
 * the wire. If this passes, the only untested link left is the Blocks SDK
 * itself.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { createInboundChannel } from "../host/inbound-ws.ts";
import { createInboundBroker } from "../inbound/broker.ts";
import { createHandler } from "../net/handler.ts";

interface Wire {
	artifacts?: Array<{ data: string }>;
}

async function watch(url: string): Promise<{ socket: WebSocket; frame(i: number): Promise<string> }> {
	const socket = new WebSocket(url);
	const frames: string[] = [];
	socket.on("message", (data) => frames.push(String(data)));
	await new Promise<void>((open, fail) => {
		socket.once("open", open);
		socket.once("error", fail);
	});
	return {
		socket,
		async frame(i) {
			const deadline = Date.now() + 2000;
			while (frames.length <= i) {
				if (Date.now() >= deadline) throw new Error(`frame ${i} never arrived`);
				await new Promise((r) => setTimeout(r, 10));
			}
			return frames[i]!;
		},
	};
}

function referenceIn(frame: string): string {
	const found = /Reply reference: (\S+)/.exec(frame);
	assert.ok(found, "the pushed frame must carry a reply reference");
	return found[1]!;
}

async function harness(replyTimeoutMs = 5000) {
	const broker = createInboundBroker({ deliver: (message) => channel.deliver(message) });
	const channel = await createInboundChannel({ pending: () => broker.pending(), log: () => {} });
	const handler = createHandler({
		broker,
		streamKey: "chat",
		maxConcurrent: 3,
		replyTimeoutMs,
		notify: () => {},
	});
	return { broker, channel, handler };
}

const task = (over: Record<string, unknown> = {}) => ({
	taskId: "task-1",
	taskKind: "request",
	ownerId: "user_42",
	orgId: "acme",
	requestParts: [{ partId: "message", text: '{"text":"what is your ask on the timber contract?"}' }],
	...over,
});

test("an inbound request reaches the session and the session's reply reaches the caller", async () => {
	const { channel, broker, handler } = await harness();
	const watcher = await watch(channel.url());
	try {
		const inFlight = handler(task() as never) as Promise<Wire>;

		const frame = await watcher.frame(0);
		assert.match(frame, /what is your ask on the timber contract\?/);
		assert.match(frame, /Unverified peer: user_42 \(org acme\)/);
		assert.match(frame, /untrusted request/);

		assert.equal(broker.pending().length, 1);
		assert.equal(broker.reply(referenceIn(frame), "We are at 40k, firm."), "sent");

		const result = await inFlight;
		assert.deepEqual(JSON.parse(result.artifacts![0]!.data), { text: "We are at 40k, firm." });
		assert.equal(broker.pending().length, 0);
		assert.equal(broker.recent()[0]!.state, "replied");
	} finally {
		watcher.socket.close();
		channel.close();
	}
});

test("a reference can only be spent once", async () => {
	const { channel, broker, handler } = await harness();
	const watcher = await watch(channel.url());
	try {
		const inFlight = handler(task() as never) as Promise<Wire>;
		const reference = referenceIn(await watcher.frame(0));

		assert.equal(broker.reply(reference, "first"), "sent");
		assert.equal(broker.reply(reference, "second"), "expired");

		const result = await inFlight;
		assert.deepEqual(JSON.parse(result.artifacts![0]!.data), { text: "first" });
	} finally {
		watcher.socket.close();
		channel.close();
	}
});

test("an unanswered request tells the caller the truth instead of hanging", async () => {
	const { channel, broker, handler } = await harness(120);
	const watcher = await watch(channel.url());
	try {
		const result = (await handler(task() as never)) as Wire;
		assert.match(JSON.parse(result.artifacts![0]!.data).text, /could not provide an answer before this task's deadline/);
		assert.equal(broker.recent()[0]!.state, "timed-out");
	} finally {
		watcher.socket.close();
		channel.close();
	}
});

test("a message that arrives with no watcher is replayed when one attaches", async () => {
	const { channel, broker, handler } = await harness();
	try {
		const inFlight = handler(task() as never) as Promise<Wire>;
		// Nothing is listening yet: the broker holds it, undelivered.
		while (broker.pending().length === 0) await new Promise((r) => setTimeout(r, 5));
		assert.equal(channel.watchers(), 0);

		const watcher = await watch(channel.url());
		const frame = await watcher.frame(0);
		assert.match(frame, /replayed — still pending/);
		assert.equal(broker.reply(referenceIn(frame), "sorry, was away"), "sent");

		const result = await inFlight;
		assert.deepEqual(JSON.parse(result.artifacts![0]!.data), { text: "sorry, was away" });
		watcher.socket.close();
	} finally {
		channel.close();
	}
});
