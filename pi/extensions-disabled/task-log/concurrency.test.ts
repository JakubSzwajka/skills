import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskService } from "./service.ts";
import { taskMutationLockPath } from "./storage.ts";
import { temporaryRepository } from "./test-harness.ts";

const worker = new URL("./concurrency-worker.ts", import.meta.url).pathname;

interface WorkerResult {
	code: number | null;
	stdout: string;
	stderr: string;
}

function runWorker(cwd: string, taskId: string, operation: string, value: string): Promise<WorkerResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [worker, cwd, taskId, operation, value], { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => { stdout += chunk; });
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		child.on("error", reject);
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}

function assertWorkersPassed(results: WorkerResult[]): void {
	for (const result of results) {
		assert.equal(result.code, 0, `worker failed: ${result.stderr || result.stdout}`);
	}
}

const root = temporaryRepository();
execFileSync("git", ["-C", root, "config", "user.email", "task-log@example.test"]);
execFileSync("git", ["-C", root, "config", "user.name", "Task Log Test"]);
writeFileSync(join(root, "seed.txt"), "seed\n");
execFileSync("git", ["-C", root, "add", "seed.txt"]);
execFileSync("git", ["-C", root, "commit", "-q", "-m", "seed"]);
const nested = join(root, "nested", "directory");
mkdirSync(nested, { recursive: true });
const worktreeParent = mkdtempSync(join(tmpdir(), "task-log-concurrency-worktree-"));
const worktree = join(worktreeParent, "linked");
execFileSync("git", ["-C", root, "worktree", "add", "-q", "-b", `concurrency-${Date.now()}`, worktree]);
const workingDirectories = [root, nested, worktree];
const service = new TaskService(root);
const task = service.create("Concurrent task", "Every successful mutation must survive.");
const firstTokens = Array.from({ length: 12 }, (_, index) => `parallel-append-${index}`);
const appendResults = await Promise.all(firstTokens.map((token, index) => runWorker(workingDirectories[index % workingDirectories.length], task.id, "append", token)));
assertWorkersPassed(appendResults);
let current = service.getById(task.id);
assert.deepEqual(
	new Set(current.entries.map((entry) => entry.text).filter((text) => text.startsWith("parallel-append-"))),
	new Set(firstTokens),
);

const racedTokens = Array.from({ length: 8 }, (_, index) => `metadata-race-append-${index}`);
const raced = await Promise.all([
	...racedTokens.map((token, index) => runWorker(workingDirectories[index % workingDirectories.length], task.id, "append", token)),
	runWorker(root, task.id, "status", "paused"),
	runWorker(worktree, task.id, "status", "active"),
	runWorker(nested, task.id, "references", "reference-a"),
	runWorker(worktree, task.id, "references", "reference-b"),
]);
assertWorkersPassed(raced);
current = service.getById(task.id);
for (const token of [...firstTokens, ...racedTokens]) {
	assert.equal(current.entries.filter((entry) => entry.text === token).length, 1, `missing or duplicate persisted entry: ${token}`);
}
assert.ok(current.status === "active" || current.status === "paused");
assert.deepEqual(new Set(current.refs), new Set(["reference-a", "reference-b"]));

for (let index = 0; index < 8; index++) {
	service.changeStatus(task.path, "active");
	const [continued, paused] = await Promise.all([
		runWorker(worktree, task.id, "continue", "Concurrent task mutations"),
		runWorker(root, task.id, "status", "paused"),
	]);
	assertWorkersPassed([continued, paused]);
	assert.ok(continued.stdout === task.id || continued.stdout === "none");
	assert.equal(service.getById(task.id).status, "paused");
}
const pausedContinuation = await runWorker(nested, task.id, "continue", "Concurrent task mutations");
assertWorkersPassed([pausedContinuation]);
assert.equal(pausedContinuation.stdout, "none", "continuation cannot attach after an inactive status is committed");
service.changeStatus(task.path, "active");

const crashed = await runWorker(root, task.id, "crash-lock", "unused");
assert.equal(crashed.code, 17);
const lockPath = taskMutationLockPath(service.getById(task.id).path);
const lockQueue = `${lockPath}.queue`;
assert.equal(existsSync(lockQueue), true);
assert.ok(readdirSync(lockQueue).some((name) => name.endsWith(".claim")));
const probeTrace = join(mkdtempSync(join(tmpdir(), "task-log-lock-probe-")), "trace.txt");
const reclaimers = await Promise.all(Array.from({ length: 6 }, () => runWorker(root, task.id, "recover-probe", probeTrace)));
assertWorkersPassed(reclaimers);
const probeEvents = readFileSync(probeTrace, "utf8").trim().split("\n");
for (let index = 0; index < probeEvents.length; index += 2) {
	assert.match(probeEvents[index], /^start:\d+$/);
	assert.equal(probeEvents[index + 1], probeEvents[index].replace("start:", "end:"));
}
assert.equal(readdirSync(lockQueue).some((name) => name.endsWith(".claim") || name.endsWith(".choosing")), false);
service.append(service.getById(task.id).path, { type: "context", text: "append-after-crash", session: "parent" });
assert.equal(service.getById(task.id).entries.at(-1)?.text, "append-after-crash");

export default function concurrencySmoke(): void {}
