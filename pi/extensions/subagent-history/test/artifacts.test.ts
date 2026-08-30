import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { MAX_JSON_BYTES, MAX_PREVIEW_BYTES, readFreshPrompt, readTextPreview, readTranscriptPreview, safeJsonFile } from "../artifacts.ts";

test("fresh prompt skips metadata and malformed JSONL", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "history-prompt-"));
	const file = path.join(root, "session.jsonl");
	fs.writeFileSync(file, [JSON.stringify({ type: "session", id: "x" }), "{bad", JSON.stringify({ type: "model_change", modelId: "m" }), JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "Exact launch task" }, { type: "image", data: "secret" }] } })].join("\n"));
	const prompt = readFreshPrompt(file, [root], "fresh");
	assert.equal(prompt.text, "Exact launch task"); assert.equal(prompt.attribution, "exact"); assert.match(prompt.warning ?? "", /skipped 1 malformed/);
	const transcript = readTranscriptPreview(file, [root]); assert.deepEqual(transcript.lines, ["model: m", "user: Exact launch task\n[image omitted]"]); assert.match(transcript.warning ?? "", /skipped 1 malformed/);
	fs.rmSync(root, { recursive: true, force: true });
});

test("fork prompt and escaped/symlink previews are unavailable", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "history-trust-"));
	const other = fs.mkdtempSync(path.join(os.tmpdir(), "history-other-"));
	const file = path.join(other, "session.jsonl"); fs.writeFileSync(file, JSON.stringify({ type: "message", message: { role: "user", content: "inherited" } }));
	assert.equal(readFreshPrompt(file, [other], "fork").attribution, "unavailable");
	assert.match(readTextPreview(file, [root]).unavailable ?? "", /outside/);
	const link = path.join(root, "link"); fs.symlinkSync(file, link);
	assert.match(readTextPreview(link, [root]).unavailable ?? "", /missing|outside/);
	fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(other, { recursive: true, force: true });
});

test("oversized JSON artifacts are rejected before allocation", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "history-json-bound-")); const file = path.join(root, "status.json"); const warnings: any[] = [];
	fs.writeFileSync(file, " ".repeat(MAX_JSON_BYTES + 1)); assert.equal(safeJsonFile(file, warnings, "status"), undefined); assert.match(warnings[0].message, /exceeds/);
	fs.rmSync(root, { recursive: true, force: true });
});

test("bounded preview marks truncation", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "history-bound-")); const file = path.join(root, "out.log");
	fs.writeFileSync(file, "x".repeat(MAX_PREVIEW_BYTES + 20));
	const preview = readTextPreview(file, [root]); assert.equal(preview.truncated, true); assert.ok(preview.lines.join("\n").length <= MAX_PREVIEW_BYTES);
	fs.rmSync(root, { recursive: true, force: true });
});
