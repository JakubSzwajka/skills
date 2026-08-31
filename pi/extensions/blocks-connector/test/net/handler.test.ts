import assert from "node:assert/strict";
import { test } from "node:test";
import { createInboundBroker, DEADLINE_FALLBACK, type DeliveredMessage } from "../../inbound/broker.ts";
import { createHandler, describePeer } from "../../net/handler.ts";
import { formatEnvelope, parseEnvelope } from "../../net/envelope.ts";

function request(text: string, taskId = "t1") {
	return { taskId, taskKind: "request", requestParts: [{ partId: "message", text: formatEnvelope({ text }) }] };
}
function textOf(result: { artifacts?: Array<{ data: string }> }): string {
	return parseEnvelope(result.artifacts?.[0]?.data)?.text ?? "";
}
function fakeCtx(inbound: unknown[] = []) {
	const written: string[] = [];
	let ended = 0;
	return {
		written,
		get ended() { return ended; },
		ctx: {
			reportStatus() {}, isCancelled: false, isExpired: false,
			createStream: async () => ({
				write: (data: unknown) => written.push(String(data)),
				events<T>(): AsyncIterable<T> { return (async function* () { for (const item of inbound) yield item as T; })(); },
				end: async () => { ended += 1; },
			}),
		},
	};
}

function answeringHarness(answer = (item: DeliveredMessage) => `answer:${item.text}`, timeout = 1_000) {
	const delivered: DeliveredMessage[] = [];
	let broker: ReturnType<typeof createInboundBroker>;
	broker = createInboundBroker({ deliver(item) { delivered.push(item); queueMicrotask(() => broker.reply(item.reference, answer(item))); } });
	return {
		delivered,
		broker,
		handler: createHandler({ broker, streamKey: "chat", maxConcurrent: 3, replyTimeoutMs: timeout, notify() {} }),
	};
}

test("a request delivery becomes one reply artifact", async () => {
	const h = answeringHarness();
	const result = await h.handler(request("hello"));
	assert.equal(textOf(result), "answer:hello");
	assert.equal(h.delivered.length, 1);
	assert.equal(h.delivered[0].kind, "request");
	assert.equal(h.delivered[0].taskId, "t1");
});

test("a request timeout returns the truthful fallback artifact", async () => {
	const broker = createInboundBroker({ deliver() {} });
	const handler = createHandler({ broker, streamKey: "chat", maxConcurrent: 3, replyTimeoutMs: 10, notify() {} });
	assert.equal(textOf(await handler(request("hello"))), DEADLINE_FALLBACK);
	assert.equal(broker.pending().length, 0);
});

test("the earliest SDK deadline wins and leaves time for the final write", async () => {
	const now = 1_000_000;
	const delivered: DeliveredMessage[] = [];
	let broker: ReturnType<typeof createInboundBroker>;
	broker = createInboundBroker(
		{
			deliver(item) {
				delivered.push(item);
				queueMicrotask(() => broker.reply(item.reference, "done"));
			},
		},
		() => now,
	);
	const handler = createHandler({
		broker,
		streamKey: "chat",
		maxConcurrent: 3,
		replyTimeoutMs: 60_000,
		notify() {},
		now: () => now,
	});
	const ctx = {
		reportStatus() {},
		isCancelled: false,
		isExpired: false,
		deadlineAt: now + 30_000,
	};
	const result = await handler({ ...request("hello"), deadlineAt: now + 45_000 }, ctx as never);
	assert.equal(textOf(result), "done");
	assert.equal(delivered[0].deadlineAt, now + 25_000);
});

test("concurrency is reserved before awaits and refusal still returns an artifact", async () => {
	const delivered: DeliveredMessage[] = [];
	const broker = createInboundBroker({ deliver: (item) => void delivered.push(item) });
	const handler = createHandler({ broker, streamKey: "chat", maxConcurrent: 1, replyTimeoutMs: 1_000, notify() {} });
	const first = handler(request("one", "one"));
	await Promise.resolve();
	const refused = await handler(request("two", "two"));
	assert.match(textOf(refused), /already handling 1 concurrent tasks/);
	broker.reply(delivered[0].reference, "done");
	assert.equal(textOf(await first), "done");
});

test("empty input and a pipe without context remain terminal artifacts", async () => {
	const h = answeringHarness();
	assert.match(textOf(await h.handler({ taskId: "t", taskKind: "request", requestParts: [] })), /nothing to answer/);
	assert.match(textOf(await h.handler({ taskId: "p", taskKind: "pipe" })), /no task context/);
});

test("pipe opening and frames flow serially through distinct references", async () => {
	const h = answeringHarness();
	const stream = fakeCtx([formatEnvelope({ text: "second" }), formatEnvelope({ text: "third" })]);
	const result = await h.handler({ ...request("first"), taskKind: "pipe" }, stream.ctx as never);
	assert.deepEqual(h.delivered.map((item) => item.text), ["first", "second", "third"]);
	assert.equal(new Set(h.delivered.map((item) => item.reference)).size, 3);
	assert.deepEqual(stream.written.map((raw) => parseEnvelope(raw)?.text), ["answer:first", "answer:second", "answer:third"]);
	assert.match(textOf(result), /closed after 3 turn/);
	assert.equal(stream.ended, 1);
});

test("peer labels use only unverified task fields", () => {
	assert.equal(describePeer({ taskId: "t", ownerId: "o", orgId: "g" }), "o (org g)");
	assert.equal(describePeer({ taskId: "t", ownerId: "o" }), "o");
	assert.equal(describePeer({ taskId: "t", orgId: "g" }), "org g");
	assert.equal(describePeer({ taskId: "t" }), "an unidentified caller");
});
