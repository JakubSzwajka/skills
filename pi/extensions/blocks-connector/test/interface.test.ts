import assert from "node:assert/strict";
import { test } from "node:test";
import blocksConnector from "../index.ts";
import { createInboundBroker } from "../inbound/broker.ts";
import { createHumanBridge } from "../operator/bridge.ts";

test("registers one-line lifecycle commands and removes the spaced command", () => {
	const commands = new Map<string, unknown>();
	blocksConnector({
		appendEntry() {},
		on() {},
		registerCommand(name: string, command: unknown) { commands.set(name, command); },
		registerTool() {},
		sendMessage() {},
	} as never);

	assert.deepEqual([...commands.keys()].sort(), [
		"blocks:offline",
		"blocks:online",
		"blocks:status",
	]);
	assert.equal(commands.has("blocks"), false);
});

test("hides the footer while offline and shows only the online Agent identity", () => {
	const statuses: Array<string | undefined> = [];
	const broker = createInboundBroker({ deliver() {} });
	const bridge = createHumanBridge({ appendEntry() {} } as never, broker);
	bridge.setContext({
		hasUI: true,
		ui: {
			setStatus(_key: string, text: string | undefined) { statuses.push(text); },
			setWidget() {},
		},
	} as never);

	assert.equal(statuses.at(-1), undefined);
	bridge.setStatusLine("🟢 blocks (player_one)");
	assert.equal(statuses.at(-1), "🟢 blocks (player_one)");
	bridge.setStatusLine(undefined);
	assert.equal(statuses.at(-1), undefined);
});
