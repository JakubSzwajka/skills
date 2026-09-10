import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	statSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { encodeNewTask } from "./codec.ts";
import { atomicWriteFile, acquireFileLock, TaskDurabilityUncertainError, TaskLockOwnershipError } from "./locking.ts";
import { resolveRepository, UnsupportedRepositoryError } from "./repository.ts";
import { TaskService } from "./service.ts";
import { DuplicateTaskIdConflict, isRepositoryTaskPath, repositoryTasks } from "./storage.ts";
import { FakeExtensionHost, temporaryRepository } from "./test-harness.ts";

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function repositoryWithCommit(): string {
	const root = temporaryRepository();
	git(root, "config", "user.email", "task-log@example.test");
	git(root, "config", "user.name", "Task Log Test");
	writeFileSync(join(root, "seed.txt"), "seed\n");
	git(root, "add", "seed.txt");
	git(root, "commit", "-q", "-m", "seed");
	return root;
}

function linkedWorktree(root: string): string {
	const parent = mkdtempSync(join(tmpdir(), "task-log-worktree-parent-"));
	const worktree = join(parent, "linked");
	git(root, "worktree", "add", "-q", "-b", `linked-${Date.now()}-${Math.random().toString(16).slice(2)}`, worktree);
	return worktree;
}

function canonicalSnapshot(directory: string): Map<string, Buffer> {
	const snapshot = new Map<string, Buffer>();
	for (const name of readdirSync(directory)) {
		if (name.endsWith(".md")) snapshot.set(name, readFileSync(join(directory, name)));
	}
	return snapshot;
}

const root = repositoryWithCommit();
const nested = join(root, "packages", "app");
mkdirSync(nested, { recursive: true });
const worktree = linkedWorktree(root);
const rootRepository = resolveRepository(root);
const nestedRepository = resolveRepository(nested);
const linkedRepository = resolveRepository(worktree);
assert.equal(rootRepository.id, nestedRepository.id);
assert.equal(rootRepository.id, linkedRepository.id);
assert.equal(rootRepository.commonDir, linkedRepository.commonDir);
assert.equal(rootRepository.branch, git(root, "symbolic-ref", "--short", "HEAD"));
assert.notEqual(rootRepository.branch, linkedRepository.branch);
assert.equal(linkedRepository.worktree, realpathSync(worktree));

const rootHost = new FakeExtensionHost();
const rootContext = rootHost.createContext({ cwd: root, inputs: ["Shared task", "One canonical record"], pickerInputs: ["\u000e"] });
await rootHost.invokeCommand("task", rootContext);
const attachment = rootHost.customEntries.at(-1)!.data as { repositoryId: string; taskId: string; pathHint: string };
assert.equal(attachment.repositoryId, rootRepository.id);
assert.ok(attachment.taskId);
assert.ok(attachment.pathHint.startsWith(rootRepository.tasksDir));
await rootHost.invokeTool("task_log", { type: "context", text: "Written from the repository root." }, rootContext);
const nestedSameSession = rootHost.createContext({ cwd: nested });
assert.match((await rootHost.invokeTool("task_read", {}, nestedSameSession)).content[0].text, /Written from the repository root/);

for (const cwd of [nested, worktree]) {
	const host = new FakeExtensionHost();
	const context = host.createContext({ cwd, branch: rootHost.customEntries });
	await host.emit("session_start", {}, context);
	const read = await host.invokeTool("task_read", {}, context);
	assert.match(read.content[0].text, /Written from the repository root/);
	assert.equal((host.customEntries.length), 0);
}

const movedTaskPath = join(dirname(attachment.pathHint), `moved-${Date.now()}.md`);
renameSync(attachment.pathHint, movedTaskPath);
const movedHost = new FakeExtensionHost();
const movedContext = movedHost.createContext({ cwd: worktree, branch: rootHost.customEntries });
await movedHost.emit("session_start", {}, movedContext);
const movedRead = await movedHost.invokeTool("task_read", {}, movedContext);
assert.match(movedRead.content[0].text, /Shared task/);
assert.equal((movedRead.details as { path: string }).path, movedTaskPath);
const canonicalAliasRoot = mkdtempSync(join(tmpdir(), "task-log-canonical-alias-"));
const canonicalFileAlias = join(canonicalAliasRoot, "task-file.md");
const canonicalDirectoryAlias = join(canonicalAliasRoot, "tasks");
symlinkSync(movedTaskPath, canonicalFileAlias);
symlinkSync(dirname(movedTaskPath), canonicalDirectoryAlias);
assert.equal(isRepositoryTaskPath(root, canonicalFileAlias), true);
const canonicalDirectoryAliasPath = join(canonicalDirectoryAlias, movedTaskPath.split("/").at(-1)!);
assert.equal(isRepositoryTaskPath(root, canonicalDirectoryAliasPath), true);
for (const path of [canonicalFileAlias, canonicalDirectoryAliasPath]) {
	const results = await rootHost.emit("tool_call", { type: "tool_call", toolName: "write", input: { path } }, rootContext);
	assert.ok(results.some((result) => (result as { block?: boolean } | undefined)?.block === true));
}
const danglingCanonicalAlias = join(canonicalAliasRoot, "future-task.md");
symlinkSync(join(dirname(movedTaskPath), "future-task.md"), danglingCanonicalAlias);
assert.equal(isRepositoryTaskPath(root, danglingCanonicalAlias), true, "dangling aliases into canonical storage stay protected");
assert.ok((await rootHost.emit("tool_call", { type: "tool_call", toolName: "write", input: { path: danglingCanonicalAlias } }, rootContext))
	.some((result) => (result as { block?: boolean } | undefined)?.block === true));

const movableRoot = repositoryWithCommit();
const movableService = new TaskService(movableRoot);
const movableTask = movableService.create("Movable repository", "Identity moves with the Git common directory.");
const movableAttachment = movableService.attach(movableTask);
const movableId = resolveRepository(movableRoot).id;
const movedRoot = `${movableRoot}-moved`;
renameSync(movableRoot, movedRoot);
assert.equal(resolveRepository(movedRoot).id, movableId);
const movedService = new TaskService(movedRoot);
assert.equal(movedService.restore(movableAttachment)?.taskId, movableTask.id);
assert.equal(movedService.requireAttached().title, "Movable repository");

const nonGit = mkdtempSync(join(tmpdir(), "task-log-non-git-"));
assert.throws(() => resolveRepository(nonGit), UnsupportedRepositoryError);

const nestedLegacyRoot = repositoryWithCommit();
const nestedLegacyDirectory = join(nestedLegacyRoot, "packages", "legacy-owner");
const nestedLegacyPath = join(nestedLegacyDirectory, ".pi", "tasks", "nested.md");
mkdirSync(dirname(nestedLegacyPath), { recursive: true });
writeFileSync(nestedLegacyPath, encodeNewTask("t-nested-legacy", "Nested legacy", "2025-01-01T00:00:00Z", "Created by the former cwd-local store."));
assert.equal(repositoryTasks(nestedLegacyRoot).tasks[0].id, "t-nested-legacy", "root-first discovery finds nested cwd-local stores");
assert.equal(repositoryTasks(nestedLegacyDirectory).tasks[0].id, "t-nested-legacy");

const legacyRoot = repositoryWithCommit();
const legacyWorktree = linkedWorktree(legacyRoot);
const legacyRepository = resolveRepository(legacyRoot);
const rootLegacyPath = join(legacyRoot, ".pi", "tasks", "legacy.md");
const linkedLegacyPath = join(legacyWorktree, ".pi", "tasks", "legacy-copy.md");
mkdirSync(dirname(rootLegacyPath), { recursive: true });
mkdirSync(dirname(linkedLegacyPath), { recursive: true });
const legacyBytes = Buffer.from(encodeNewTask("t-legacy-shared", "Legacy shared", "2025-01-01T00:00:00Z", "Preserve these bytes."));
writeFileSync(rootLegacyPath, legacyBytes);
writeFileSync(linkedLegacyPath, legacyBytes);
const migrated = repositoryTasks(legacyWorktree).tasks;
assert.equal(migrated.length, 1);
assert.ok(migrated[0].path.startsWith(legacyRepository.tasksDir));
assert.deepEqual(readFileSync(rootLegacyPath), legacyBytes);
assert.deepEqual(readFileSync(linkedLegacyPath), legacyBytes);
assert.deepEqual(readFileSync(migrated[0].path), legacyBytes);
const migratedService = new TaskService(legacyWorktree);
migratedService.append(migrated[0].path, { type: "context", text: "Canonical continuation", session: "test" });
assert.equal(repositoryTasks(legacyRoot).tasks[0].entries.at(-1)?.text, "Canonical continuation");
assert.deepEqual(readFileSync(rootLegacyPath), legacyBytes);
assert.deepEqual(readFileSync(linkedLegacyPath), legacyBytes);
const legacyAliasRoot = mkdtempSync(join(tmpdir(), "task-log-legacy-alias-"));
const legacyFileAlias = join(legacyAliasRoot, "legacy-file.md");
const legacyDirectoryAlias = join(legacyAliasRoot, "legacy-tasks");
symlinkSync(rootLegacyPath, legacyFileAlias);
symlinkSync(dirname(rootLegacyPath), legacyDirectoryAlias);
assert.equal(isRepositoryTaskPath(legacyRoot, legacyFileAlias), true);
const legacyDirectoryAliasPath = join(legacyDirectoryAlias, "legacy.md");
assert.equal(isRepositoryTaskPath(legacyRoot, legacyDirectoryAliasPath), true);
const legacyGuardHost = new FakeExtensionHost();
const legacyGuardContext = legacyGuardHost.createContext({ cwd: legacyRoot });
for (const path of [legacyFileAlias, legacyDirectoryAliasPath]) {
	const results = await legacyGuardHost.emit("tool_call", { type: "tool_call", toolName: "edit", input: { path } }, legacyGuardContext);
	assert.ok(results.some((result) => (result as { block?: boolean } | undefined)?.block === true));
}
const danglingLegacyAlias = join(legacyAliasRoot, "future-legacy.md");
symlinkSync(join(dirname(rootLegacyPath), "future-legacy.md"), danglingLegacyAlias);
assert.equal(isRepositoryTaskPath(legacyRoot, danglingLegacyAlias), true, "dangling aliases into legacy storage stay protected");
assert.ok((await legacyGuardHost.emit("tool_call", { type: "tool_call", toolName: "edit", input: { path: danglingLegacyAlias } }, legacyGuardContext))
	.some((result) => (result as { block?: boolean } | undefined)?.block === true));

const orphanPath = join(legacyRepository.tasksDir, `.${migrated[0].path.split("/").at(-1)}.tmp-interrupted-copy`);
writeFileSync(orphanPath, "partial bytes");
assert.equal(repositoryTasks(legacyRoot).tasks.length, 1);
assert.equal(readFileSync(orphanPath, "utf8"), "partial bytes");

const lateDuplicateRoot = repositoryWithCommit();
const initialLateWorktree = linkedWorktree(lateDuplicateRoot);
const initialLatePath = join(initialLateWorktree, ".pi", "tasks", "late.md");
mkdirSync(dirname(initialLatePath), { recursive: true });
const lateBytes = Buffer.from(encodeNewTask("t-late-duplicate", "Late duplicate", "2025-01-01T00:00:00Z", "original bytes"));
writeFileSync(initialLatePath, lateBytes);
const lateCanonical = repositoryTasks(lateDuplicateRoot).tasks[0];
new TaskService(lateDuplicateRoot).append(lateCanonical.path, { type: "context", text: "canonical changed", session: "test" });
const introducedWorktree = linkedWorktree(lateDuplicateRoot);
const introducedPath = join(introducedWorktree, ".pi", "tasks", "late.md");
mkdirSync(dirname(introducedPath), { recursive: true });
writeFileSync(introducedPath, lateBytes);
assert.throws(
	() => repositoryTasks(lateDuplicateRoot),
	(error) => error instanceof DuplicateTaskIdConflict && error.taskId === "t-late-duplicate" && error.paths.length === 2,
);
assert.deepEqual(readFileSync(initialLatePath), lateBytes);
assert.deepEqual(readFileSync(introducedPath), lateBytes);

const conflictRoot = repositoryWithCommit();
const conflictWorktree = linkedWorktree(conflictRoot);
const conflictRepository = resolveRepository(conflictRoot);
mkdirSync(conflictRepository.tasksDir, { recursive: true });
const conflictA = join(conflictRoot, ".pi", "tasks", "same-id.md");
const conflictB = join(conflictWorktree, ".pi", "tasks", "same-id.md");
mkdirSync(dirname(conflictA), { recursive: true });
mkdirSync(dirname(conflictB), { recursive: true });
const bytesA = Buffer.from(encodeNewTask("t-conflict", "First", "2025-01-01T00:00:00Z", "first bytes"));
const bytesB = Buffer.from(encodeNewTask("t-conflict", "Second", "2025-01-01T00:00:00Z", "second bytes"));
writeFileSync(conflictA, bytesA);
writeFileSync(conflictB, bytesB);
const canonicalBefore = canonicalSnapshot(conflictRepository.tasksDir);
assert.throws(
	() => repositoryTasks(conflictRoot),
	(error) => error instanceof DuplicateTaskIdConflict && error.taskId === "t-conflict" && error.paths.length === 2,
);
assert.deepEqual(readFileSync(conflictA), bytesA);
assert.deepEqual(readFileSync(conflictB), bytesB);
assert.deepEqual(canonicalSnapshot(conflictRepository.tasksDir), canonicalBefore);

const lockPath = join(conflictRepository.storeDir, "ownership-test.lock");
const lock = acquireFileLock(lockPath);
const originalOwner = readFileSync(lock.path);
writeFileSync(lock.path, JSON.stringify({ pid: process.pid, token: "changed", createdAt: new Date().toISOString(), ticket: 1 }));
assert.throws(() => lock.release(), TaskLockOwnershipError);
writeFileSync(lock.path, originalOwner);
lock.release();
assert.equal(statSync(conflictRepository.storeDir).isDirectory(), true);

const stalePath = join(conflictRepository.storeDir, "stale-test.lock");
const staleQueue = `${stalePath}.queue`;
mkdirSync(staleQueue, { recursive: true });
const staleClaim = join(staleQueue, "2147483647-stale-token.claim");
writeFileSync(staleClaim, JSON.stringify({ pid: 2_147_483_647, token: "stale-token", createdAt: "2000-01-01T00:00:00Z", ticket: 1 }));
utimesSync(staleClaim, new Date(0), new Date(0));
const recovered = acquireFileLock(stalePath, { timeoutMs: 100, staleMs: 0 });
assert.notEqual(recovered.token, "stale-token");
recovered.release();

const malformedPath = join(conflictRepository.storeDir, "malformed-test.lock");
const malformedQueue = `${malformedPath}.queue`;
mkdirSync(malformedQueue, { recursive: true });
const malformedChoosing = join(malformedQueue, "2147483647-interrupted.choosing");
writeFileSync(malformedChoosing, '{"pid":');
utimesSync(malformedChoosing, new Date(0), new Date(0));
const recoveredMalformed = acquireFileLock(malformedPath, { timeoutMs: 100, staleMs: 0 });
recoveredMalformed.release();
assert.equal(readdirSync(malformedQueue).some((name) => name.endsWith(".claim") || name.endsWith(".choosing")), false);

const uncertainRoot = mkdtempSync(join(tmpdir(), "task-log-durability-"));
const uncertainPath = join(uncertainRoot, "task.md");
writeFileSync(uncertainPath, "before");
assert.throws(
	() => atomicWriteFile(uncertainPath, "after", { syncDirectory: () => { throw new Error("injected directory fsync failure"); } }),
	(error) => error instanceof TaskDurabilityUncertainError && error.path === uncertainPath,
);
assert.equal(readFileSync(uncertainPath, "utf8"), "after", "post-rename failures report that the destination changed");

const permissionsRoot = repositoryWithCommit();
const permissionsRepository = resolveRepository(permissionsRoot);
mkdirSync(permissionsRepository.tasksDir, { recursive: true });
const permissionsLegacy = join(permissionsRoot, ".pi", "tasks", "permissions.md");
mkdirSync(dirname(permissionsLegacy), { recursive: true });
writeFileSync(permissionsLegacy, encodeNewTask("t-permissions", "Permissions", "2025-01-01T00:00:00Z", "must fail cleanly"));
chmodSync(permissionsRepository.tasksDir, 0o500);
try {
	assert.throws(() => repositoryTasks(permissionsRoot), /EACCES|permission denied/i);
	assert.deepEqual(readFileSync(permissionsLegacy), Buffer.from(encodeNewTask("t-permissions", "Permissions", "2025-01-01T00:00:00Z", "must fail cleanly")));
} finally {
	chmodSync(permissionsRepository.tasksDir, 0o700);
}

const mutationPermissionsRoot = repositoryWithCommit();
const mutationPermissionsService = new TaskService(mutationPermissionsRoot);
const mutationPermissionsTask = mutationPermissionsService.create("Mutation permissions", "A failed lock acquisition changes nothing.");
const mutationBytes = readFileSync(mutationPermissionsTask.path);
chmodSync(dirname(mutationPermissionsTask.path), 0o500);
try {
	assert.throws(
		() => mutationPermissionsService.append(mutationPermissionsTask.path, { type: "context", text: "must not persist", session: "test" }),
		/EACCES|permission denied/i,
	);
	assert.deepEqual(readFileSync(mutationPermissionsTask.path), mutationBytes);
} finally {
	chmodSync(dirname(mutationPermissionsTask.path), 0o700);
}

export default function repositoryStorageSmoke(): void {}
