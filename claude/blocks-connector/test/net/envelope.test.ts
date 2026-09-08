import assert from "node:assert/strict";
import { test } from "node:test";
import { envelopeFromParts, formatEnvelope, parseEnvelope } from "../../net/envelope.ts";

test("parses the JSON shape this connector sends", () => {
	assert.deepEqual(parseEnvelope('{"text":"hello"}'), { text: "hello" });
	assert.deepEqual(parseEnvelope('{"text":"hi","meta":{"ref":"abc"}}'), {
		text: "hi",
		meta: { ref: "abc" },
	});
});

test("accepts a bare string, because MCP send_task and the browser form send one", () => {
	assert.deepEqual(parseEnvelope("just words"), { text: "just words" });
	assert.deepEqual(parseEnvelope("  padded  "), { text: "padded" });
});

test("accepts message and reply as aliases for text", () => {
	assert.deepEqual(parseEnvelope({ message: "via message" }), { text: "via message" });
	assert.deepEqual(parseEnvelope({ reply: "via reply" }), { text: "via reply" });
});

test("treats unparseable JSON as prose rather than failing the turn", () => {
	assert.deepEqual(parseEnvelope('{"text": broken'), { text: '{"text": broken' });
});

test("returns undefined only when there is no message at all", () => {
	assert.equal(parseEnvelope(undefined), undefined);
	assert.equal(parseEnvelope(""), undefined);
	assert.equal(parseEnvelope("   "), undefined);
	assert.equal(parseEnvelope({}), undefined);
	assert.equal(parseEnvelope({ text: "  " }), undefined);
});

test("ignores a non-object meta instead of passing junk to the session", () => {
	assert.deepEqual(parseEnvelope({ text: "x", meta: "nope" }), { text: "x" });
	assert.deepEqual(parseEnvelope({ text: "x", meta: [1, 2] }), { text: "x" });
});

test("prefers the declared message part, then any part with text", () => {
	assert.deepEqual(
		envelopeFromParts([
			{ partId: "other", text: "wrong one" },
			{ partId: "message", text: '{"text":"right one"}' },
		]),
		{ text: "right one" },
	);
	assert.deepEqual(envelopeFromParts([{ text: "only part" }]), { text: "only part" });
	assert.equal(envelopeFromParts([]), undefined);
	assert.equal(envelopeFromParts(undefined), undefined);
});

test("round-trips through the wire format", () => {
	const envelope = { text: "line one\nline two", meta: { turn: 3 } };
	assert.deepEqual(parseEnvelope(formatEnvelope(envelope)), envelope);
});

test("omits meta from the wire when there is none", () => {
	assert.equal(formatEnvelope({ text: "plain" }), '{"text":"plain"}');
});
