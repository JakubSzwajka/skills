import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../config.ts";

function makeConfigDir(agentName: string, apiKey: string): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-blocks-config-"));
	writeFileSync(join(dir, ".env"), `BLOCKS_API_KEY=${apiKey}\nPI_BLOCKS_MAX_CONCURRENT=4\n`);
	writeFileSync(join(dir, "agent-card.json"), JSON.stringify({
		identity: {
			agentName,
			displayName: agentName,
			description: "Test connector",
			version: "1.0.0",
			provider: { organization: "Test" },
		},
		capabilities: { taskKinds: ["request", "pipe"] },
		streams: { chat: { direction: "bidirectional", format: "events" } },
		runtime: { concurrency: 2, maxRunningTimeSec: 1800 },
	}));
	return dir;
}

test("loads the API key and default Agent Card from the current directory", () => {
	const dir = makeConfigDir("local_agent", "local-key");
	try {
		const result = loadConfig(dir, {});
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.equal(result.config.apiKey, "local-key");
		assert.equal(result.config.card.identity.agentName, "local_agent");
		assert.equal(result.config.cardPath, join(dir, "agent-card.json"));
		assert.equal(result.config.maxConcurrent, 4);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("process environment overrides local dotenv and resolves card paths from the current directory", () => {
	const dir = makeConfigDir("default_agent", "local-key");
	writeFileSync(join(dir, "alternate-card.json"), JSON.stringify({
		identity: {
			agentName: "alternate_agent",
			displayName: "Alternate",
			description: "Test connector",
			version: "1.0.0",
			provider: { organization: "Test" },
		},
		capabilities: { taskKinds: ["request", "pipe"] },
		streams: { chat: { direction: "bidirectional", format: "events" } },
	}));
	try {
		const result = loadConfig(dir, {
			BLOCKS_API_KEY: "process-key",
			PI_BLOCKS_CARD: "alternate-card.json",
		});
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.equal(result.config.apiKey, "process-key");
		assert.equal(result.config.card.identity.agentName, "alternate_agent");
		assert.equal(result.config.cardPath, join(dir, "alternate-card.json"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("separate current directories do not leak dotenv values into each other", () => {
	const first = makeConfigDir("first_agent", "first-key");
	const second = makeConfigDir("second_agent", "second-key");
	try {
		const firstResult = loadConfig(first, {});
		const secondResult = loadConfig(second, {});
		assert.equal(firstResult.ok && firstResult.config.apiKey, "first-key");
		assert.equal(secondResult.ok && secondResult.config.apiKey, "second-key");
	} finally {
		rmSync(first, { recursive: true, force: true });
		rmSync(second, { recursive: true, force: true });
	}
});
