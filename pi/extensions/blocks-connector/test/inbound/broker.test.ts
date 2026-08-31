import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createInboundBroker,
	DEADLINE_FALLBACK,
	DELIVERY_FALLBACK,
	type DeliveredMessage,
} from "../../inbound/broker.ts";

const message = (taskId: string, text: string) => ({ taskId, text, peer: "unverified-peer", kind: "request" as const });

test("direct reply resolves exactly the referenced pending item", async () => {
	const delivered: DeliveredMessage[] = [];
	const broker = createInboundBroker({ deliver: (item) => void delivered.push(item) });
	const answer = broker.requestReply(message("t1", "hello"), { deadlineAt: Date.now() + 1_000 });
	await Promise.resolve();
	assert.equal(delivered.length, 1);
	assert.equal(broker.reply(delivered[0].reference, "exact reply"), "sent");
	assert.equal(await answer, "exact reply");
	assert.equal(broker.pending().length, 0);
	assert.equal(broker.reply(delivered[0].reference, "late"), "expired");
});

test("concurrent opaque references cannot cross-answer", async () => {
	const delivered: DeliveredMessage[] = [];
	const broker = createInboundBroker({ deliver: (item) => void delivered.push(item) });
	const one = broker.requestReply(message("one", "first"), { deadlineAt: Date.now() + 1_000 });
	const two = broker.requestReply(message("two", "second"), { deadlineAt: Date.now() + 1_000 });
	await Promise.resolve();
	assert.notEqual(delivered[0].reference, delivered[1].reference);
	assert.equal(broker.reply("not-a-reference", "wrong"), "unknown");
	broker.reply(delivered[1].reference, "for two");
	broker.reply(delivered[0].reference, "for one");
	assert.deepEqual(await Promise.all([one, two]), ["for one", "for two"]);
});

test("timeout and cancellation settle with fallback and remove capabilities", async () => {
	const delivered: DeliveredMessage[] = [];
	const broker = createInboundBroker({ deliver: (item) => void delivered.push(item) });
	const timed = broker.requestReply(message("t1", "wait"), { deadlineAt: Date.now() + 10 });
	assert.equal(await timed, DEADLINE_FALLBACK);
	assert.equal(broker.reply(delivered[0].reference, "late"), "expired");

	const controller = new AbortController();
	const cancelled = broker.requestReply(message("t2", "cancel"), { deadlineAt: Date.now() + 1_000, signal: controller.signal });
	controller.abort();
	assert.equal(await cancelled, DEADLINE_FALLBACK);
	assert.equal(broker.pending().length, 0);

	const alreadyAborted = new AbortController();
	alreadyAborted.abort();
	assert.equal(
		await broker.requestReply(message("t3", "too late"), {
			deadlineAt: Date.now() + 1_000,
			signal: alreadyAborted.signal,
		}),
		DEADLINE_FALLBACK,
	);
	assert.equal(delivered.some((item) => item.taskId === "t3"), false);
});

test("delivery failure and shutdown clean up pending waits", async () => {
	const failed = createInboundBroker({ deliver: () => { throw new Error("host gone"); } });
	assert.equal(await failed.requestReply(message("t1", "hello"), { deadlineAt: Date.now() + 1_000 }), DELIVERY_FALLBACK);

	const broker = createInboundBroker({ deliver() {} });
	const taskPending = broker.requestReply(message("t2", "hello"), { deadlineAt: Date.now() + 1_000 });
	const otherPending = broker.requestReply(message("t3", "hello"), { deadlineAt: Date.now() + 1_000 });
	broker.cancelTask("t2");
	assert.equal(await taskPending, DEADLINE_FALLBACK);
	assert.equal(broker.pending().length, 1, "task/stream cleanup must not cancel another task");
	broker.cancelAll();
	assert.equal(await otherPending, DEADLINE_FALLBACK);
	assert.equal(broker.pending().length, 0);
});
