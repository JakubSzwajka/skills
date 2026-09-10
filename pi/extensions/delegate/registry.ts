import { mkdir, open, readFile, readdir, rename, rmdir, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LaneRecord, LaneRegistry, Transport } from "./types.ts";
import { TRANSPORTS } from "./types.ts";
import { isPid } from "./runners/support.ts";

const LOCK_WAIT_MS = 20;
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;

export async function readRegistry(path: string): Promise<LaneRegistry> {
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		if (!isObject(parsed) || !Array.isArray(parsed.lanes)) return { lanes: [] };
		return { lanes: parsed.lanes.map(toLane).filter(isPresent) };
	} catch {
		return { lanes: [] };
	}
}

export async function mutateRegistry(path: string, mutate: (registry: LaneRegistry) => LaneRegistry | void): Promise<LaneRegistry> {
	const next = await withLock(path, async () => {
		const current = await readRegistry(path);
		const updated = mutate(current) ?? current;
		if (updated.lanes.length) await atomicWrite(path, updated);
		else await removeFile(path);
		return updated;
	});
	if (!next.lanes.length) await removeRegistryDirectory(path);
	return next;
}

export async function registryFiles(root: string): Promise<string[]> {
	let entries;
	try { entries = await readdir(root, { withFileTypes: true }); }
	catch { return []; }
	const candidates = entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name, "lanes.json"));
	const populated = await Promise.all(candidates.map(async (path) => {
		const registry = await readAndCleanRegistry(path);
		return registry.lanes.length ? path : undefined;
	}));
	return populated.filter(isPresent);
}

async function atomicWrite(path: string, registry: LaneRegistry): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	const handle = await open(temporary, "wx", 0o600);
	try {
		await handle.writeFile(`${JSON.stringify(registry, null, 2)}\n`, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	await rename(temporary, path);
}

async function readAndCleanRegistry(path: string): Promise<LaneRegistry> {
	const registry = await withLock(path, async () => {
		const current = await readRegistry(path);
		if (!current.lanes.length) await removeFile(path);
		return current;
	});
	if (!registry.lanes.length) await removeRegistryDirectory(path);
	return registry;
}

async function removeFile(path: string): Promise<void> {
	try { await unlink(path); }
	catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

async function removeRegistryDirectory(path: string): Promise<void> {
	try { await rmdir(dirname(path)); }
	catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
	}
}

async function withLock<T>(path: string, action: () => Promise<T>): Promise<T> {
	const lock = `${path}.lock`;
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	for (;;) {
		try {
			await mkdir(lock, { mode: 0o700 });
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			try {
				if (Date.now() - (await stat(lock)).mtimeMs > STALE_LOCK_MS) {
					await rmdir(lock);
					continue;
				}
			} catch (lockError) {
				if ((lockError as NodeJS.ErrnoException).code !== "ENOENT" && (lockError as NodeJS.ErrnoException).code !== "ENOTEMPTY") throw lockError;
			}
			if (Date.now() >= deadline) throw new Error(`Timed out locking delegate registry ${path}`);
			await sleep(LOCK_WAIT_MS);
		}
	}
	try { return await action(); }
	finally {
		try { await rmdir(lock); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	}
}

function toLane(value: unknown): LaneRecord | undefined {
	if (!isObject(value)) return undefined;
	const lane = text(value.lane);
	const profile = text(value.profile);
	const cwd = text(value.cwd);
	const handoff = text(value.handoff);
	const started = text(value.started);
	if (!lane || !profile || !cwd || !handoff || !started) return undefined;
	return {
		lane,
		profile,
		pane: text(value.pane) ?? "",
		session: text(value.session) ?? "",
		cwd,
		handoff,
		started,
		...(text(value.rang) ? { rang: text(value.rang) } : {}),
		read: value.read === true,
		closed: value.closed === true,
		...(text(value.closedAt) ? { closedAt: text(value.closedAt) } : {}),
		...(text(value.model) ? { model: text(value.model) } : {}),
		...(text(value.sessionFile) ? { sessionFile: text(value.sessionFile) } : {}),
		...(isStatus(value.status) ? { status: value.status } : {}),
		...(text(value.error) ? { error: text(value.error) } : {}),
		...(text(value.ownerSession) ? { ownerSession: text(value.ownerSession) } : {}),
		...(isPid(value.ownerPid) ? { ownerPid: value.ownerPid } : {}),
		...(isTransport(value.transport) ? { transport: value.transport } : {}),
		// A pid no kernel could have handed out is dropped rather than carried: it can never be probed
		// or signalled, and as part of a batched `ps` it used to blind every other lane in the file.
		...(isPid(value.pid) ? { pid: value.pid } : {}),
		...(text(value.pidStart) ? { pidStart: text(value.pidStart) } : {}),
		...(text(value.logFile) ? { logFile: text(value.logFile) } : {}),
		...(text(value.blockedAt) ? { blockedAt: text(value.blockedAt) } : {}),
	};
}

function isTransport(value: unknown): value is Transport {
	return typeof value === "string" && (TRANSPORTS as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is LaneRecord["status"] {
	return typeof value === "string" && ["pending", "idle", "working", "blocked", "done", "unknown", "closed"].includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isPresent<T>(value: T | undefined): value is T { return value !== undefined; }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
