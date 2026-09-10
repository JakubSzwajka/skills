import { randomUUID } from "node:crypto";
import {
	closeSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

interface LockOwner {
	pid: number;
	token: string;
	createdAt: string;
	ticket: number;
}

export interface FileLock {
	path: string;
	token: string;
	release(): void;
}

export class TaskLockTimeoutError extends Error {
	readonly lockPath: string;

	constructor(lockPath: string) {
		super(`Timed out waiting for task mutation lock: ${lockPath}`);
		this.name = "TaskLockTimeoutError";
		this.lockPath = lockPath;
	}
}

export class TaskDurabilityUncertainError extends Error {
	readonly path: string;

	constructor(path: string, cause: unknown) {
		super(`Task write completed, but directory durability could not be confirmed: ${path}`, { cause });
		this.name = "TaskDurabilityUncertainError";
		this.path = path;
	}
}

export class TaskLockOwnershipError extends Error {
	readonly lockPath: string;

	constructor(lockPath: string) {
		super(`Refusing to remove a task lock owned by another writer: ${lockPath}`);
		this.name = "TaskLockOwnershipError";
		this.lockPath = lockPath;
	}
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_MS = 30_000;
const WAIT_MS = 10;
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

function errorCode(error: unknown): string | undefined {
	return error instanceof Error && "code" in error ? String(error.code) : undefined;
}

function readOwner(path: string): LockOwner | undefined {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as Partial<LockOwner>;
		if (!Number.isInteger(value.pid) || typeof value.token !== "string" || typeof value.createdAt !== "string" || !Number.isInteger(value.ticket)) {
			return undefined;
		}
		return value as LockOwner;
	} catch {
		return undefined;
	}
}

function processIsAbsent(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		return errorCode(error) === "ESRCH";
	}
}

function tokenVerifiedRemove(path: string, token: string, lockPath: string): boolean {
	const owner = readOwner(path);
	if (!owner) return false;
	if (owner.token !== token) throw new TaskLockOwnershipError(lockPath);
	const removalPath = `${path}.remove-${token}`;
	try {
		renameSync(path, removalPath);
	} catch (error) {
		if (errorCode(error) === "ENOENT") return false;
		throw error;
	}
	const movedOwner = readOwner(removalPath);
	if (movedOwner?.token !== token) throw new TaskLockOwnershipError(lockPath);
	unlinkSync(removalPath);
	return true;
}

function reclaimIfStale(path: string, owner: LockOwner | undefined, lockPath: string, staleMs: number): boolean {
	let age: number;
	try {
		age = Date.now() - statSync(path).mtimeMs;
	} catch (error) {
		return errorCode(error) === "ENOENT";
	}
	if (age < staleMs) return false;
	if (owner) return processIsAbsent(owner.pid) && tokenVerifiedRemove(path, owner.token, lockPath);

	// Queue names contain unrepeatable UUIDs, so a malformed stale entry cannot be replaced at the same path.
	const removalPath = `${path}.remove-${randomUUID()}`;
	try {
		renameSync(path, removalPath);
		unlinkSync(removalPath);
		return true;
	} catch (error) {
		if (errorCode(error) === "ENOENT") return true;
		throw error;
	}
}

function writeOwner(path: string, owner: LockOwner): void {
	// Publishing only after a complete fsynced write prevents a crash from exposing partial queue state.
	atomicWriteFile(path, `${JSON.stringify(owner)}\n`);
}

function queueEntries(queuePath: string, suffix: ".choosing" | ".claim"): string[] {
	return readdirSync(queuePath)
		.filter((name) => name.endsWith(suffix))
		.map((name) => join(queuePath, name));
}

function wait(deadline: number, lockPath: string): void {
	if (Date.now() >= deadline) throw new TaskLockTimeoutError(lockPath);
	Atomics.wait(waitBuffer, 0, 0, Math.min(WAIT_MS, Math.max(1, deadline - Date.now())));
}

/**
 * Unique bakery claims avoid replacing a fixed lock path, so two stale-lock reclaimers cannot displace a newer live owner.
 */
export function acquireFileLock(
	lockPath: string,
	options: { timeoutMs?: number; staleMs?: number } = {},
): FileLock {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
	const deadline = Date.now() + timeoutMs;
	const queuePath = `${lockPath}.queue`;
	mkdirSync(queuePath, { recursive: true });
	const token = randomUUID();
	const choosingPath = join(queuePath, `${process.pid}-${token}.choosing`);
	const claimPath = join(queuePath, `${process.pid}-${token}.claim`);
	const initialOwner: LockOwner = { pid: process.pid, token, createdAt: new Date().toISOString(), ticket: 0 };
	writeOwner(choosingPath, initialOwner);
	let owner: LockOwner;
	try {
		const existingTickets = queueEntries(queuePath, ".claim")
			.map((path) => readOwner(path)?.ticket ?? 0);
		owner = { ...initialOwner, ticket: Math.max(0, ...existingTickets) + 1 };
		writeOwner(claimPath, owner);
		if (!tokenVerifiedRemove(choosingPath, token, lockPath)) throw new TaskLockOwnershipError(lockPath);

		for (;;) {
			let blocked = false;
			for (const path of queueEntries(queuePath, ".choosing")) {
				const other = readOwner(path);
				if (reclaimIfStale(path, other, lockPath, staleMs)) continue;
				blocked = true;
				break;
			}
			if (!blocked) break;
			wait(deadline, lockPath);
		}

		for (;;) {
			let blocked = false;
			for (const path of queueEntries(queuePath, ".claim")) {
				if (path === claimPath) continue;
				const other = readOwner(path);
				if (reclaimIfStale(path, other, lockPath, staleMs)) continue;
				if (!other || other.ticket < owner.ticket || (other.ticket === owner.ticket && other.token < owner.token)) {
					blocked = true;
					break;
				}
			}
			if (!blocked) break;
			wait(deadline, lockPath);
		}
	} catch (error) {
		if (readOwner(choosingPath)?.token === token) tokenVerifiedRemove(choosingPath, token, lockPath);
		if (readOwner(claimPath)?.token === token) tokenVerifiedRemove(claimPath, token, lockPath);
		throw error;
	}

	let released = false;
	return {
		path: claimPath,
		token,
		release() {
			if (released) return;
			if (!tokenVerifiedRemove(claimPath, token, lockPath)) throw new TaskLockOwnershipError(lockPath);
			released = true;
		},
	};
}

export function withFileLock<T>(path: string, mutate: () => T): T {
	const lock = acquireFileLock(path);
	try {
		return mutate();
	} finally {
		lock.release();
	}
}

/** A crash before rename leaves an ignored orphan temp; a successful return confirms the renamed destination and directory are fsynced. */
export function atomicWriteFile(
	path: string,
	content: string | Buffer,
	options: { syncDirectory?: (directory: string) => void } = {},
): void {
	const directory = dirname(path);
	const tempPath = join(directory, `.${basename(path)}.tmp-${process.pid}-${randomUUID()}`);
	const fd = openSync(tempPath, "wx", 0o600);
	try {
		writeFileSync(fd, content);
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	renameSync(tempPath, path);
	try {
		if (options.syncDirectory) {
			options.syncDirectory(directory);
			return;
		}
		const directoryFd = openSync(directory, "r");
		try {
			fsyncSync(directoryFd);
		} finally {
			closeSync(directoryFd);
		}
	} catch (error) {
		throw new TaskDurabilityUncertainError(path, error);
	}
}
