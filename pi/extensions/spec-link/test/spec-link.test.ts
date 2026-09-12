import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	defaultSpecRoot,
	describeSpec,
	discover,
	pickerLabels,
	renderNote,
	sanitizeDisplay,
	type SpecMetadata,
} from "../discovery.ts";

const NOW = Date.parse("2026-09-12T12:00:00.000Z");

function makeRoot(): string {
	return mkdtempSync(join(tmpdir(), "spec-link-discovery-"));
}

function writeSpec(root: string, folder: string, metadata: SpecMetadata | string): string {
	const path = join(root, folder);
	mkdirSync(path, { recursive: true });
	writeFileSync(join(path, "spec.json"), typeof metadata === "string" ? metadata : `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
	return path;
}

test("the default root uses the home directory without shell expansion", () => {
	assert.equal(defaultSpecRoot(), join(homedir(), ".pi", "specs"));
});

test("discovery lists pending and only done specs from the last 72 hours", (t) => {
	const root = makeRoot();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeSpec(root, "2026-09-10_pending-work", { schemaVersion: 1, title: "Pending work", status: "pending" });
	writeSpec(root, "2026-09-09_recent-done", {
		schemaVersion: 1,
		title: "Recent done",
		status: "done",
		completedAt: new Date(NOW - 71 * 60 * 60 * 1000).toISOString(),
	});
	writeSpec(root, "2026-09-08_old-done", {
		schemaVersion: 1,
		title: "Old done",
		status: "done",
		completedAt: new Date(NOW - 73 * 60 * 60 * 1000).toISOString(),
	});
	mkdirSync(join(root, "not-a-spec"));
	writeFileSync(join(root, "README.md"), "ignored", "utf8");

	const found = discover(root, NOW);
	assert.deepEqual(
		found.map((record) => [record.folder, record.kind === "spec" ? record.status : record.kind]),
		[
			["not-a-spec", "invalid"],
			["2026-09-10_pending-work", "pending"],
			["2026-09-09_recent-done", "done"],
		],
	);
});

test("a mounted old done spec remains discoverable and describes without an age check", (t) => {
	const root = makeRoot();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const old = writeSpec(root, "2026-09-01_old-done", {
		schemaVersion: 1,
		title: "Old but mounted",
		status: "done",
		completedAt: new Date(NOW - 10 * 24 * 60 * 60 * 1000).toISOString(),
	});
	assert.deepEqual(discover(root, NOW), []);
	assert.equal(discover(root, NOW, old)[0]?.kind, "spec");
	const described = describeSpec(old, root);
	assert.equal(described.kind, "spec");
	if (described.kind === "spec") assert.equal(described.title, "Old but mounted");
});

test("metadata validation rejects every misleading state and keeps errors visible", (t) => {
	const root = makeRoot();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeSpec(root, "2026-09-12_bad-json", "{");
	writeSpec(root, "2026-09-12_bad-version", JSON.stringify({ schemaVersion: 2, title: "X", status: "pending" }));
	writeSpec(root, "2026-09-12_bad-title", JSON.stringify({ schemaVersion: 1, title: "\n\u0000", status: "pending" }));
	writeSpec(root, "2026-09-12_bad-status", JSON.stringify({ schemaVersion: 1, title: "X", status: "started" }));
	writeSpec(root, "2026-09-12_pending-completed", JSON.stringify({ schemaVersion: 1, title: "X", status: "pending", completedAt: new Date(NOW).toISOString() }));
	writeSpec(root, "2026-09-12_done-missing-time", JSON.stringify({ schemaVersion: 1, title: "X", status: "done" }));
	writeSpec(root, "2026-09-12_done-bad-time", JSON.stringify({ schemaVersion: 1, title: "X", status: "done", completedAt: "later" }));
	writeSpec(root, "2026-09-12_done-impossible-time", JSON.stringify({ schemaVersion: 1, title: "X", status: "done", completedAt: "2026-02-30T12:00:00.000Z" }));
	writeSpec(root, "2026-09-12_done-loose-time", JSON.stringify({ schemaVersion: 1, title: "X", status: "done", completedAt: "0" }));
	mkdirSync(join(root, "2026-09-12_missing-metadata"));

	const found = discover(root, NOW);
	assert.equal(found.length, 10);
	assert.ok(found.every((record) => record.kind === "invalid"));
	const errors = found.map((record) => (record.kind === "invalid" ? record.error : ""));
	assert.ok(errors.some((error) => error.includes("valid JSON")));
	assert.ok(errors.some((error) => error.includes("schemaVersion")));
	assert.ok(errors.some((error) => error.includes("non-empty")));
	assert.ok(errors.some((error) => error.includes("status")));
	assert.ok(errors.some((error) => error.includes("must not have completedAt")));
	assert.equal(errors.filter((error) => error.includes("completedAt timestamp")).length, 4);
	assert.equal(errors.filter((error) => error.includes("canonical UTC")).length, 3);
	assert.ok(errors.some((error) => error.includes("cannot be read")));
	for (const label of pickerLabels(found)) assert.match(label, /·  invalid\s+·/);
});

test("folder and metadata path checks keep mounts inside the configured root", (t) => {
	const root = makeRoot();
	const outside = makeRoot();
	t.after(() => {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	});
	const wrongName = writeSpec(root, "feature", { schemaVersion: 1, title: "Wrong", status: "pending" });
	const outsideSpec = writeSpec(outside, "2026-09-12_elsewhere", { schemaVersion: 1, title: "Elsewhere", status: "pending" });
	assert.deepEqual(describeSpec(wrongName, root), {
		kind: "invalid",
		path: wrongName,
		folder: "feature",
		error: "folder name must match YYYY-MM-DD_feature-slug",
	});
	const escaped = describeSpec(outsideSpec, root);
	assert.equal(escaped.kind, "invalid");
	if (escaped.kind === "invalid") assert.match(escaped.error, /direct child/);
});

test("picker, status, and provider note sanitize display text and never include bodies", (t) => {
	const root = makeRoot();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const folder = writeSpec(root, "2026-09-12_safe", { schemaVersion: 1, title: "Safe\u001b[2J title", status: "pending" });
	mkdirSync(join(folder, "notes", "nested"), { recursive: true });
	writeFileSync(join(folder, "SPEC.md"), "SECRET BODY", "utf8");
	writeFileSync(join(folder, "notes", "nested", "anything.md"), "OTHER SECRET", "utf8");
	const record = describeSpec(folder, root);
	assert.equal(record.kind, "spec");
	if (record.kind !== "spec") return;
	assert.match(pickerLabels([record])[0], /^1\.  Safe \[2J title\s+·  pending/);
	const note = renderNote(record);
	assert.equal(
		note,
		`[spec-link] Mounted spec: "Safe [2J title".\nStatus: pending\nFolder: ${folder}\nRead files in this folder when needed. This note contains no file bodies.`,
	);
	assert.ok(!note.includes("SECRET BODY"));
	assert.ok(!note.includes("OTHER SECRET"));
	assert.equal(sanitizeDisplay("a\u0000b\nc"), "a b c");
	assert.equal(sanitizeDisplay("x".repeat(90)).length, 80);
});
