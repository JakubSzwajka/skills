import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { createInboundChannel } from "../../host/inbound-ws.ts";
import type { DeliveredMessage, PendingSnapshot } from "../../inbound/broker.ts";

const item = (over: Partial<PendingSnapshot> = {}): PendingSnapshot => ({
	taskId: "task-1",
	peer: "user_42",
	kind: "request",
	text: "what is your ask?",
	reference: "ref-1",
	deadlineAt: Date.now() + 60_000,
	createdAt: Date.now(),
	...over,
});

interface Watcher {
	socket: WebSocket;
	/** Frames buffer from the moment of connection, so a burst is never missed. */
	frame(index: number, timeoutMs?: number): Promise<string>;
}

async function connect(url: string): Promise<Watcher> {
	const socket = new WebSocket(url);
	const frames: string[] = [];
	const arrived: Array<() => void> = [];
	socket.on("message", (data) => {
		frames.push(String(data));
		for (const wake of arrived.splice(0)) wake();
	});
	await new Promise<void>((open, fail) => {
		socket.once("open", open);
		socket.once("error", fail);
	});
	return {
		socket,
		async frame(index, timeoutMs = 1000) {
			const deadline = Date.now() + timeoutMs;
			while (frames.length <= index) {
				if (Date.now() >= deadline) throw new Error(`frame ${index} never arrived`);
				await new Promise<void>((wake) => {
					arrived.push(wake);
					setTimeout(wake, 25);
				});
			}
			return frames[index]!;
		},
	};
}

test("delivers an inbound message to an authorized watcher", async () => {
	const channel = await createInboundChannel({ pending: () => [], log: () => {} });
	const watcher = await connect(channel.url());
	try {
		channel.deliver(item() as DeliveredMessage);
		const text = await watcher.frame(0);
		assert.match(text, /Reply reference: ref-1/);
		assert.match(text, /Unverified peer: user_42/);
		assert.match(text, /what is your ask\?/);
		assert.match(text, /untrusted request/);
	} finally {
		watcher.socket.close();
		channel.close();
	}
});

test("refuses a watcher with no token", async () => {
	const channel = await createInboundChannel({ pending: () => [], log: () => {} });
	const bare = channel.url().replace(/\?token=.*$/, "");
	try {
		const socket = new WebSocket(bare);
		const code = await new Promise<number>((settle) => socket.once("close", settle));
		assert.equal(code, 1008);
	} finally {
		channel.close();
	}
});

test("refuses a watcher with the wrong token", async () => {
	const channel = await createInboundChannel({ pending: () => [], log: () => {} });
	const wrong = channel.url().replace(/token=.*$/, "token=00000000-0000-0000-0000-000000000000");
	try {
		const socket = new WebSocket(wrong);
		const code = await new Promise<number>((settle) => socket.once("close", settle));
		assert.equal(code, 1008);
	} finally {
		channel.close();
	}
});

test("replays still-pending work to a watcher that attaches late", async () => {
	const backlog = [item({ reference: "ref-a" }), item({ reference: "ref-b" })];
	const channel = await createInboundChannel({ pending: () => backlog, log: () => {} });
	const watcher = await connect(channel.url());
	try {
		const first = await watcher.frame(0);
		const second = await watcher.frame(1);
		assert.match(first, /Reply reference: ref-a/);
		assert.match(first, /replayed — still pending/);
		assert.match(second, /Reply reference: ref-b/);
	} finally {
		watcher.socket.close();
		channel.close();
	}
});

test("reports no watcher rather than dropping the item silently", async () => {
	const logged: string[] = [];
	const channel = await createInboundChannel({ pending: () => [], log: (m) => logged.push(m) });
	try {
		channel.deliver(item() as DeliveredMessage);
		assert.equal(channel.watchers(), 0);
		assert.ok(logged.some((line) => line.includes("no watcher attached")));
	} finally {
		channel.close();
	}
});
