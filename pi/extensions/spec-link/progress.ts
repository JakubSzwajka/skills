import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	fsyncSync,
	ftruncateSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	renameSync,
	unlinkSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { describeSpec, type SpecRecord, type SpecStatus } from "./discovery.ts";

export interface StatusTransition {
	record: SpecRecord;
	changed: boolean;
}

type Identity = { dev: bigint; ino: bigint };
type Hierarchy = { rootPath: string; root: Identity; specPath: string; spec: Identity };
type LockOwner = { version: 1; token: string; pid: number; startedAt: number; ticket: number | null };
type LockCandidate = { path: string; identity: Identity; owner: LockOwner };

const EXCLUSIVE_FILE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);
const LOCK_WAIT_MS = 10;
const LOCK_TIMEOUT_MS = 10_000;
const PROCESS_STARTED_AT = Math.floor((Date.now() - process.uptime() * 1_000) / 1_000);
const waitCell = new Int32Array(new SharedArrayBuffer(4));

function sameIdentity(left: Identity, right: Identity): boolean {
	return left.dev === right.dev && left.ino === right.ino;
}

function directoryIdentity(path: string, label: string): Identity {
	const entry = lstatSync(path, { bigint: true });
	if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`${label} must be a regular directory`);
	return { dev: entry.dev, ino: entry.ino };
}

function fileIdentity(path: string, label: string): Identity {
	const entry = lstatSync(path, { bigint: true });
	if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`${label} must be a regular file`);
	return { dev: entry.dev, ino: entry.ino };
}

function descriptorIdentity(descriptor: number): Identity {
	const entry = fstatSync(descriptor, { bigint: true });
	return { dev: entry.dev, ino: entry.ino };
}

function captureHierarchy(record: SpecRecord, root: string): Hierarchy {
	const rootPath = resolve(root);
	const specPath = resolve(record.path);
	if (dirname(specPath) !== rootPath || basename(specPath) !== record.folder) {
		throw new Error("Mounted spec must remain a direct child of the spec root");
	}
	return {
		rootPath,
		root: directoryIdentity(rootPath, "Spec root"),
		specPath,
		spec: directoryIdentity(specPath, "Mounted spec folder"),
	};
}

function assertHierarchy(hierarchy: Hierarchy): void {
	if (!sameIdentity(directoryIdentity(hierarchy.rootPath, "Spec root"), hierarchy.root)) {
		throw new Error("Spec root changed during the write");
	}
	if (!sameIdentity(directoryIdentity(hierarchy.specPath, "Mounted spec folder"), hierarchy.spec)) {
		throw new Error("Mounted spec folder changed during the write");
	}
}

function assertDirectory(path: string, expected: Identity, label: string): void {
	if (!sameIdentity(directoryIdentity(path, label), expected)) throw new Error(`${label} changed during the write`);
}

function assertFile(path: string, expected: Identity, label: string): void {
	if (!sameIdentity(fileIdentity(path, label), expected)) throw new Error(`${label} changed during the write`);
}

function closeQuietly(descriptor: number): void {
	try {
		closeSync(descriptor);
	} catch {}
}

function removeOwnedFile(path: string, expected: Identity, hierarchy: Hierarchy, directory?: { path: string; identity: Identity }): boolean {
	try {
		assertHierarchy(hierarchy);
		if (directory) assertDirectory(directory.path, directory.identity, "Mounted spec log folder");
		assertFile(path, expected, "Private file");
		// These checks stop static links and accidental replacement. Portable Node cannot close a malicious same-UID parent-rename race without openat-style operations.
		unlinkSync(path);
		return true;
	} catch {
		return false;
	}
}

function removeDeadCandidate(path: string, identity: Identity, hierarchy: Hierarchy): void {
	if (removeOwnedFile(path, identity, hierarchy)) return;
	try {
		fileIdentity(path, "Spec status lock");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	throw new Error("Spec status lock changed during crash recovery");
}

function currentRecord(record: SpecRecord, root: string): SpecRecord {
	const current = describeSpec(record.path, root);
	if (current.kind === "invalid") throw new Error(`Mounted spec is invalid: ${current.error}`);
	return current;
}

function lockOwnerFromName(name: string, prefix: string): Omit<LockOwner, "version" | "ticket"> | undefined {
	if (!name.startsWith(prefix)) return undefined;
	const [pidText, startedAtText, token, ...rest] = name.slice(prefix.length).split(".");
	const pid = Number(pidText);
	const startedAt = Number(startedAtText);
	if (rest.length > 0 || !Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(startedAt) || startedAt <= 0 || !/^[0-9a-f-]{36}$/.test(token ?? "")) {
		throw new Error("Spec status lock path is unsafe");
	}
	return { pid, startedAt, token };
}

function ownerIsLive(owner: Pick<LockOwner, "pid" | "startedAt">): boolean {
	if (owner.pid === process.pid) return owner.startedAt === PROCESS_STARTED_AT;
	try {
		process.kill(owner.pid, 0);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
		return true;
	}
	try {
		const started = execFileSync("/bin/ps", ["-p", String(owner.pid), "-o", "lstart="], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 1_000,
		}).trim();
		const startedAt = Date.parse(started);
		if (!Number.isFinite(startedAt)) return true;
		return Math.abs(Math.floor(startedAt / 1_000) - owner.startedAt) <= 2;
	} catch {
		return true;
	}
}

function writeLockOwner(descriptor: number, owner: LockOwner): void {
	const payload = `${JSON.stringify(owner)}\n`;
	ftruncateSync(descriptor, 0);
	writeSync(descriptor, payload, 0, "utf8");
	fsyncSync(descriptor);
}

function readLockCandidates(hierarchy: Hierarchy, prefix: string): LockCandidate[] {
	const candidates: LockCandidate[] = [];
	for (const name of readdirSync(hierarchy.rootPath)) {
		const namedOwner = lockOwnerFromName(name, prefix);
		if (!namedOwner) continue;
		const path = join(hierarchy.rootPath, name);
		let identity: Identity;
		let text: string;
		try {
			identity = fileIdentity(path, "Spec status lock");
			text = readFileSync(path, "utf8");
			assertFile(path, identity, "Spec status lock");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		const live = ownerIsLive(namedOwner);
		if (!live) {
			// PID start time distinguishes a crashed owner from PID reuse, so recovery never removes a candidate owned by a live or unknown process.
			removeDeadCandidate(path, identity, hierarchy);
			continue;
		}
		let owner: LockOwner;
		try {
			owner = JSON.parse(text) as LockOwner;
		} catch {
			owner = { version: 1, ...namedOwner, ticket: null };
		}
		if (
			owner.version !== 1 ||
			owner.pid !== namedOwner.pid ||
			owner.startedAt !== namedOwner.startedAt ||
			owner.token !== namedOwner.token ||
			(owner.ticket !== null && (!Number.isSafeInteger(owner.ticket) || owner.ticket <= 0))
		) {
			throw new Error("Spec status lock owner is invalid");
		}
		candidates.push({ path, identity, owner });
	}
	return candidates;
}

function precedes(left: LockOwner, right: LockOwner): boolean {
	if (left.ticket === null) return true;
	if (right.ticket === null) return false;
	if (left.ticket !== right.ticket) return left.ticket < right.ticket;
	if (left.startedAt !== right.startedAt) return left.startedAt < right.startedAt;
	if (left.pid !== right.pid) return left.pid < right.pid;
	return left.token < right.token;
}

function withStatusLock<T>(record: SpecRecord, root: string, run: () => T): T {
	const hierarchy = captureHierarchy(record, root);
	const prefix = `.${record.folder}.status.lock.`;
	const owner: LockOwner = { version: 1, token: randomUUID(), pid: process.pid, startedAt: PROCESS_STARTED_AT, ticket: null };
	const path = join(hierarchy.rootPath, `${prefix}${owner.pid}.${owner.startedAt}.${owner.token}`);
	const descriptor = openSync(path, EXCLUSIVE_FILE_FLAGS, 0o600);
	const identity = descriptorIdentity(descriptor);
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	try {
		writeLockOwner(descriptor, owner);
		assertHierarchy(hierarchy);
		assertFile(path, identity, "Spec status lock");
		const choosing = readLockCandidates(hierarchy, prefix);
		owner.ticket = Math.max(0, ...choosing.flatMap((candidate) => (candidate.owner.ticket === null ? [] : [candidate.owner.ticket]))) + 1;
		writeLockOwner(descriptor, owner);
		while (true) {
			assertHierarchy(hierarchy);
			assertFile(path, identity, "Spec status lock");
			const contenders = readLockCandidates(hierarchy, prefix);
			const blocked = contenders.some((candidate) => candidate.owner.token !== owner.token && precedes(candidate.owner, owner));
			if (!blocked) return run();
			if (Date.now() >= deadline) throw new Error("Timed out waiting for another spec status change");
			Atomics.wait(waitCell, 0, 0, LOCK_WAIT_MS);
		}
	} finally {
		closeQuietly(descriptor);
		removeOwnedFile(path, identity, hierarchy);
	}
}

function writeMetadata(record: SpecRecord, root: string): void {
	const hierarchy = captureHierarchy(record, root);
	const metadataIdentity = fileIdentity(record.metadataPath, "Mounted spec metadata");
	const temporary = join(record.path, `.spec.json.${process.pid}.${randomUUID()}.tmp`);
	const metadata = {
		schemaVersion: 1,
		title: record.title,
		status: record.status,
		...(record.status === "done" ? { completedAt: record.completedAt } : {}),
	};
	let descriptor: number | undefined;
	let temporaryIdentity: Identity | undefined;
	let closed = false;
	try {
		descriptor = openSync(temporary, EXCLUSIVE_FILE_FLAGS, 0o600);
		temporaryIdentity = descriptorIdentity(descriptor);
		assertHierarchy(hierarchy);
		assertFile(temporary, temporaryIdentity, "Temporary metadata file");
		assertFile(record.metadataPath, metadataIdentity, "Mounted spec metadata");
		writeFileSync(descriptor, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
		fsyncSync(descriptor);
		assertHierarchy(hierarchy);
		assertFile(temporary, temporaryIdentity, "Temporary metadata file");
		assertFile(record.metadataPath, metadataIdentity, "Mounted spec metadata");
		// A same-directory rename keeps readers from observing a partly written spec.json.
		renameSync(temporary, record.metadataPath);
		assertHierarchy(hierarchy);
		assertFile(record.metadataPath, temporaryIdentity, "Mounted spec metadata");
		closeSync(descriptor);
		closed = true;
	} catch (error) {
		if (descriptor !== undefined && !closed) closeQuietly(descriptor);
		if (temporaryIdentity) removeOwnedFile(temporary, temporaryIdentity, hierarchy);
		throw error;
	}
}

export function transitionStatus(record: SpecRecord, status: SpecStatus, root: string, now = Date.now()): StatusTransition {
	return withStatusLock(record, root, () => {
		const current = currentRecord(record, root);
		if (current.status === status) return { record: current, changed: false };
		const next: SpecRecord =
			status === "done"
				? { ...current, status, completedAt: new Date(now).toISOString() }
				: {
						kind: "spec",
						path: current.path,
						folder: current.folder,
						metadataPath: current.metadataPath,
						schemaVersion: 1,
						title: current.title,
						status,
					};
		writeMetadata(next, root);
		return { record: next, changed: true };
	});
}

function ensureLogDirectory(record: SpecRecord, root: string): { hierarchy: Hierarchy; path: string; identity: Identity } {
	const hierarchy = captureHierarchy(record, root);
	const path = join(record.path, "log");
	try {
		mkdirSync(path, 0o700);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	assertHierarchy(hierarchy);
	return { hierarchy, path, identity: directoryIdentity(path, "Mounted spec log folder") };
}

function timestampName(now: number): string {
	return new Date(now).toISOString().replace(/:/g, "-").replace(".", "-");
}

export function appendSpecLog(record: SpecRecord, text: string, root: string, now = Date.now()): string {
	if (typeof text !== "string" || text.trim().length === 0) throw new Error("Log text is required");
	const current = currentRecord(record, root);
	const log = ensureLogDirectory(current, root);
	const base = timestampName(now);
	const body = text.endsWith("\n") ? text : `${text}\n`;
	for (let collision = 0; collision < 10_000; collision++) {
		const suffix = collision === 0 ? "" : `-${String(collision).padStart(2, "0")}`;
		const path = join(log.path, `${base}${suffix}.md`);
		let descriptor: number | undefined;
		let openedIdentity: Identity | undefined;
		let closed = false;
		try {
			// O_EXCL reserves one immutable name even when other processes use the same millisecond.
			descriptor = openSync(path, EXCLUSIVE_FILE_FLAGS, 0o600);
			openedIdentity = descriptorIdentity(descriptor);
			assertHierarchy(log.hierarchy);
			assertDirectory(log.path, log.identity, "Mounted spec log folder");
			assertFile(path, openedIdentity, "New spec log file");
			writeFileSync(descriptor, body, "utf8");
			fsyncSync(descriptor);
			assertHierarchy(log.hierarchy);
			assertDirectory(log.path, log.identity, "Mounted spec log folder");
			assertFile(path, openedIdentity, "New spec log file");
			closeSync(descriptor);
			closed = true;
			return path;
		} catch (error) {
			if (descriptor !== undefined && !closed) closeQuietly(descriptor);
			if (openedIdentity) removeOwnedFile(path, openedIdentity, log.hierarchy, { path: log.path, identity: log.identity });
			if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
			throw error;
		}
	}
	throw new Error("Could not allocate a unique log filename");
}
