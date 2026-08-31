import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureRegistered } from "../../net/register.ts";

test("an already-registered agent is left alone, no process spawned", async () => {
	let spawned = false;
	const result = await ensureRegistered("acme_bot", "/cards/acme/agent-card.json", "key123", {
		getAgent: async () => ({ agentName: "acme_bot" }),
		runRegister: async () => {
			spawned = true;
			return { code: 0, stdout: "", stderr: "" };
		},
	});
	assert.deepEqual(result, { action: "already-registered" });
	assert.equal(spawned, false);
});

test("a missing agent gets registered", async () => {
	const result = await ensureRegistered("acme_bot", "/cards/acme/agent-card.json", "key123", {
		getAgent: async () => null,
		runRegister: async (cardPath, apiKey) => {
			assert.equal(cardPath, "/cards/acme/agent-card.json");
			assert.equal(apiKey, "key123");
			return { code: 0, stdout: "registered acme_bot", stderr: "" };
		},
	});
	assert.deepEqual(result, { action: "registered" });
});

test("a failed registration surfaces the CLI's stderr, not a generic message", async () => {
	const result = await ensureRegistered("acme_bot", "/cards/acme/agent-card.json", "key123", {
		getAgent: async () => null,
		runRegister: async () => ({
			code: 1,
			stdout: "",
			stderr: "agentName already taken by another organization",
		}),
	});
	assert.deepEqual(result, {
		action: "failed",
		detail: "agentName already taken by another organization",
	});
});

test("a failed registration with only stdout still surfaces something readable", async () => {
	const result = await ensureRegistered("acme_bot", "/cards/acme/agent-card.json", "key123", {
		getAgent: async () => null,
		runRegister: async () => ({ code: 127, stdout: "command not found", stderr: "" }),
	});
	assert.deepEqual(result, { action: "failed", detail: "command not found" });
});

test("the API key never appears in the runRegister call's own return value", async () => {
	// Guards against a future change accidentally logging or echoing it.
	const result = await ensureRegistered("acme_bot", "/cards/acme/agent-card.json", "super-secret-key", {
		getAgent: async () => null,
		runRegister: async () => ({ code: 0, stdout: "ok", stderr: "" }),
	});
	assert.equal(JSON.stringify(result).includes("super-secret-key"), false);
});
