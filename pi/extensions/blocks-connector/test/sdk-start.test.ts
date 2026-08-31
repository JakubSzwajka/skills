import assert from "node:assert/strict";
import { test } from "node:test";
import { startWithConfiguredApiKey } from "../sdk-start.ts";

const SDK_MISSING_KEY = "BLOCKS_API_KEY is required. Run 'blocks login --write-env' to set up credentials.";

test("supplies the directory-local API key to the environment-bound Blocks SDK", async () => {
	const previous = process.env.BLOCKS_API_KEY;
	delete process.env.BLOCKS_API_KEY;
	try {
		await assert.doesNotReject(
			startWithConfiguredApiKey("directory-key", async () => {
				if (!process.env.BLOCKS_API_KEY) throw new Error(SDK_MISSING_KEY);
				assert.equal(process.env.BLOCKS_API_KEY, "directory-key");
			}),
		);
		assert.equal(process.env.BLOCKS_API_KEY, undefined);
	} finally {
		if (previous === undefined) delete process.env.BLOCKS_API_KEY;
		else process.env.BLOCKS_API_KEY = previous;
	}
});

test("restores an existing process credential when SDK startup fails", async () => {
	const previous = process.env.BLOCKS_API_KEY;
	process.env.BLOCKS_API_KEY = "existing-key";
	try {
		await assert.rejects(
			startWithConfiguredApiKey("directory-key", async () => {
				assert.equal(process.env.BLOCKS_API_KEY, "directory-key");
				throw new Error("startup failed");
			}),
			/startup failed/,
		);
		assert.equal(process.env.BLOCKS_API_KEY, "existing-key");
	} finally {
		if (previous === undefined) delete process.env.BLOCKS_API_KEY;
		else process.env.BLOCKS_API_KEY = previous;
	}
});
