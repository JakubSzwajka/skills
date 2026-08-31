/**
 * Duplex moves frames. Anything about what an exchange *means* — steers, turn
 * counting, telling the operator — is tested against the Conversation seam in
 * conversation.test.ts, because that is where it now lives.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { runDuplex, type DuplexStream } from "../../conversation/duplex.ts";
import { formatEnvelope } from "../../net/envelope.ts";

/** A stream that replays a scripted list of inbound frames and records writes. */
function fakeStream(inbound: unknown[]): DuplexStream & { written: string[] } {
	const written: string[] = [];
	return {
		written,
		write(data: unknown) {
			written.push(String(data));
		},
		events<T>(): AsyncIterable<T> {
			return (async function* () {
				for (const item of inbound) yield item as T;
			})();
		},
	};
}

test("one inbound message produces exactly one reply on the wire", async () => {
	const stream = fakeStream([formatEnvelope({ text: "hello" })]);
	const result = await runDuplex(stream, { deliverAndWait: async () => "hi back" });

	assert.equal(result.turns, 1);
	assert.equal(result.stopped, "stream-ended");
	assert.deepEqual(stream.written, ['{"text":"hi back"}']);
});

test("keepalives and malformed frames are not turns", async () => {
	const stream = fakeStream([{}, "", "   ", formatEnvelope({ text: "real" })]);
	let asked = 0;
	const result = await runDuplex(stream, {
		deliverAndWait: async () => {
			asked += 1;
			return "answer";
		},
	});

	assert.equal(asked, 1);
	assert.equal(result.turns, 1);
	assert.equal(stream.written.length, 1);
});

test("the peer's text reaches answer untouched, meta and all", async () => {
	const seen: Array<{ text: string; meta?: Record<string, unknown> }> = [];
	const stream = fakeStream([formatEnvelope({ text: "see attached", meta: { contractId: "c-9" } })]);
	await runDuplex(stream, {
		deliverAndWait: async (inbound) => {
			seen.push(inbound);
			return "ok";
		},
	});

	assert.equal(seen[0].text, "see attached");
	assert.deepEqual(seen[0].meta, { contractId: "c-9" });
});

test("a failed turn still answers, because the far end is waiting", async () => {
	const stream = fakeStream([formatEnvelope({ text: "hello" })]);
	const errors: unknown[] = [];
	const result = await runDuplex(stream, {
		deliverAndWait: async () => {
			throw new Error("model exploded");
		},
		onError: (error) => errors.push(error),
	});

	assert.equal(result.turns, 1);
	assert.equal(errors.length, 1);
	assert.match(stream.written[0], /could not process this message/);
});

test("shouldStop ends the conversation before answering again", async () => {
	const stream = fakeStream([
		formatEnvelope({ text: "one" }),
		formatEnvelope({ text: "two" }),
	]);
	let stop = false;
	const result = await runDuplex(stream, {
		deliverAndWait: async () => {
			stop = true;
			return "answered once";
		},
		shouldStop: () => stop,
	});

	assert.equal(result.turns, 1);
	assert.equal(result.stopped, "cancelled");
});
