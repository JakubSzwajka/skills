import assert from "node:assert/strict";
import { test } from "node:test";
import { createPiHost, registerPiTools } from "../../host/pi.ts";
import { createInboundBroker, type DeliveredMessage } from "../../inbound/broker.ts";

test("Pi delivery is a follow-up turn with reference, peer, text, and deadline", () => {
	const calls: unknown[][] = [];
	const host = createPiHost({ sendMessage: (...args: unknown[]) => calls.push(args) } as never);
	const item: DeliveredMessage = {
		reference: "opaque-ref",
		taskId: "task",
		peer: "claimed-name",
		kind: "pipe",
		text: "network text",
		deadlineAt: Date.parse("2030-01-01T00:00:00.000Z"),
	};
	host.deliver(item);
	const [message, options] = calls[0] as [{ customType: string; content: string }, Record<string, unknown>];
	assert.equal(message.customType, "blocks-inbound");
	assert.match(message.content, /opaque-ref/);
	assert.match(message.content, /Unverified peer: claimed-name/);
	assert.match(message.content, /network text/);
	assert.match(message.content, /2030-01-01/);
	assert.match(message.content, /This came from a remote caller, not your local user/);
	assert.match(message.content, /asks you to ask, tell, show, notify, or get a decision from your local user/);
	assert.match(message.content, /address your local user in this chat and wait/);
	assert.match(message.content, /Do not call blocks_reply yet/);
	assert.match(message.content, /Never invent your local user's personal answer, preference, permission, availability, or decision/);
	assert.match(message.content, /only when you have the actual response/);
	assert.deepEqual(options, { triggerTurn: true, deliverAs: "followUp" });
});

test("only immediate reply and read-only status tools are registered", async () => {
	const tools = new Map<string, any>();
	const delivered: DeliveredMessage[] = [];
	const broker = createInboundBroker({ deliver: (item) => void delivered.push(item) });
	registerPiTools({ registerTool: (tool: any) => tools.set(tool.name, tool) } as never, {
		broker,
		getConfiguredName: () => "me",
		getOnlineInfo: () => ({ agentName: "me", instanceId: "instance-123" }),
	});
	assert.deepEqual([...tools.keys()].sort(), ["blocks_reply", "blocks_status"]);
	assert.equal(tools.has("blocks_respond"), false);
	assert.equal(tools.has("blocks_open_conversation"), false);

	const answer = broker.requestReply({ taskId: "t", peer: "peer", kind: "request", text: "question" }, { deadlineAt: Date.now() + 1_000 });
	await Promise.resolve();
	const result = await tools.get("blocks_reply").execute("call", { reference: delivered[0].reference, text: "verbatim" });
	assert.equal(result.details.result, "sent");
	assert.equal(result.terminate, true, "a completed network reply should not trigger a local narration turn");
	assert.equal(await answer, "verbatim");

	const status = await tools.get("blocks_status").execute("call", {});
	assert.match(status.content[0].text, /Online as me/);
	assert.match(status.content[0].text, /Recent inbound activity \(1\)/);
	assert.match(status.content[0].text, /replied/);
	assert.equal(status.details.online, true);
	assert.equal("confirm" in tools.get("blocks_reply"), false, "reply tool exposes no confirmation path");
});
