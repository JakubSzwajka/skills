import { execFile, spawn } from "node:child_process";
import { mkdir, open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
	LaneHandle, LaneKill, LaneObservation, LaneProgress, LaneRecord, LaneRunner, LaneSettled, LaneSpec,
} from "../types.ts";
import { errorMessage, isPid, processAlive, sleep, splitModelSpec } from "./support.ts";

const execFileAsync = promisify(execFile);

/** How long after an intercom ask a growing transcript is read as "the worker resumed". */
const BLOCKED_GRACE_MS = 3_000;
const SETTLE_POLL_MS = 250;
const KILL_GRACE_MS = 2_000;

export interface LaunchRequest {
	command: string;
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	logFile: string;
}

/** Starts one detached worker and returns its pid. The only place a real process is created. */
export type Launcher = (request: LaunchRequest) => Promise<{ pid: number }>;

/**
 * What one `ps` learned. `starts` maps a pid to an opaque witness of when it started; `answered`
 * holds the pids `ps` actually reported on, present or absent. A pid missing from `answered` is a
 * question nobody answered, which is not the same as a process that exited.
 */
export interface ProcessSnapshot {
	starts: Map<number, string>;
	answered: ReadonlySet<number>;
}

/** Asks the operating system which of these pids are alive and when each one started. */
export type ProcessTable = (pids: readonly number[]) => Promise<ProcessSnapshot>;

/**
 * Whether the recorded pid is still the worker that recorded it.
 * `unproven` is the honest third answer: something holds the pid but nothing confirms it is ours.
 */
export type Liveness = "ours" | "gone" | "unproven";

/** Said in `stop`'s result, because the operator has to finish the job by hand. */
function unprovenDetail(lane: LaneRecord, reason: string): string {
	return `delegate will not signal process group ${lane.pid} for lane ${lane.lane}: ${reason}.`
		+ ` A pid can be reused, so signalling it could kill an unrelated process group.`
		+ ` The lane stays open and unclosed. Check ${lane.logFile ?? "the lane log"} and \`ps -p ${lane.pid}\`,`
		+ ` then kill it by hand with \`kill -TERM -${lane.pid}\` if that really is the worker.`;
}

export interface SubprocessDeps {
	command?: string;
	launch?: Launcher;
	processTable?: ProcessTable;
	kill?: (target: number, signal: NodeJS.Signals) => void;
	sessionId?: () => string;
	now?: () => number;
}

/**
 * A lane with no pane: a detached `pi -p` that outlives this session.
 *
 * What it gives up against the pane transport is real and deliberate. There is no `idle`
 * separate from `done` — a print-mode worker either runs or has exited. Nobody can watch it;
 * its output is a log file. `blocked` exists only for the one case a parent can actually
 * observe, an intercom ask, and is set by the service rather than seen here. `unknown` is the
 * fourth state: the pid could not be proven to be this worker, so nothing is reported and nothing
 * is signalled.
 */
export class SubprocessLaneRunner implements LaneRunner {
	readonly transport = "subprocess" as const;
	private readonly command: string;
	private readonly launch: Launcher;
	private readonly processTable: ProcessTable;
	private readonly killSignal: (target: number, signal: NodeJS.Signals) => void;
	private readonly newSessionId: () => string;
	private readonly now: () => number;

	constructor(deps: SubprocessDeps = {}) {
		this.command = deps.command ?? "pi";
		this.launch = deps.launch ?? detachedLauncher;
		this.processTable = deps.processTable ?? psTable;
		this.killSignal = deps.kill ?? ((target, signal) => { process.kill(target, signal); });
		this.newSessionId = deps.sessionId ?? uuidV7;
		this.now = deps.now ?? Date.now;
	}

	/** Nothing outside this session's registries knows a headless lane's name, and the registry check owns that. */
	async liveNames(): Promise<Set<string>> {
		return new Set();
	}

	async spawn(spec: LaneSpec, progress: LaneProgress): Promise<LaneHandle> {
		const session = this.newSessionId();
		const logFile = join(spec.stateDir, "worker.log");
		await mkdir(spec.stateDir, { recursive: true, mode: 0o700 });
		// Created and recorded before the process exists: a spawn that half-succeeds must still leave
		// the operator a file to open, since a headless lane has nothing else to look at.
		await (await open(logFile, "a", 0o600)).close();
		await progress({ session, logFile });
		const { pid } = await this.launch({
			command: this.command,
			args: launchArguments(spec, session),
			cwd: spec.cwd,
			env: childEnvironment(spec.parentId),
			logFile,
		});
		if (!pid) throw new Error("The delegate worker was launched but reported no pid");
		// Without this witness the lane can never be stopped by delegate, so a failed first `ps` is
		// worth one retry before the lane is stuck that way for its whole life.
		let pidStart = (await this.processTable([pid])).starts.get(pid);
		if (!pidStart) {
			await sleep(100);
			pidStart = (await this.processTable([pid])).starts.get(pid);
		}
		return { session, logFile, pid, ...(pidStart ? { pidStart } : {}), status: "working" };
	}

	async probe(lanes: readonly LaneRecord[]): Promise<Map<string, LaneObservation>> {
		const observations = new Map<string, LaneObservation>();
		const running = lanes.filter((lane) => lane.pid);
		if (!running.length) return observations;
		const snapshot = await this.processTable(running.map((lane) => lane.pid!));
		for (const lane of running) {
			const sessionFile = lane.sessionFile ?? await findSessionFile(lane);
			const carried = sessionFile ? { sessionFile } : {};
			const liveness = this.liveness(lane, snapshot);
			if (liveness === "gone") {
				observations.set(lane.lane, { kind: "status", status: "done", ...carried });
				continue;
			}
			// Nothing proved this lane dead, so it is not reported dead. `unknown` keeps the record open
			// and keeps the pid addressable instead of pruning it out of reach.
			if (liveness === "unproven") {
				observations.set(lane.lane, { kind: "status", status: "unknown", ...carried });
				continue;
			}
			const blocked = lane.status === "blocked" && !(await resumedSince(sessionFile, lane.blockedAt, BLOCKED_GRACE_MS));
			observations.set(lane.lane, { kind: "status", status: blocked ? "blocked" : "working", ...carried });
		}
		return observations;
	}

	async settle(lane: LaneRecord, timeoutMs: number, signal?: AbortSignal): Promise<LaneSettled> {
		if (!lane.pid) return { timedOut: false, status: "done" };
		const deadline = this.now() + timeoutMs;
		for (;;) {
			// Only a proven exit ends the wait. An unreadable `ps` times out instead of claiming done.
			if (this.liveness(lane, await this.processTable([lane.pid])) === "gone") return { timedOut: false, status: "done" };
			if (signal?.aborted || this.now() >= deadline) return { timedOut: true };
			await sleep(SETTLE_POLL_MS);
		}
	}

	async kill(lane: LaneRecord): Promise<LaneKill> {
		if (!lane.pid) return { gone: true, alreadyGone: true, warnings: [] };
		const liveness = this.liveness(lane, await this.processTable([lane.pid]));
		if (liveness === "gone") return { gone: true, alreadyGone: true, warnings: [] };
		// No witness, no signal. A group signal to a recycled pid kills strangers, and the only thing
		// that separates the worker from a stranger is the recorded start time.
		if (liveness === "unproven") {
			const reason = lane.pidStart
				? "`ps` could not be read, so the recorded start time could not be compared"
				: "the lane has no recorded process start time, so this pid cannot be proven to be the worker";
			return { gone: false, alreadyGone: false, warnings: [], detail: unprovenDetail(lane, reason) };
		}
		const warnings: string[] = [];
		// The worker is its own process group leader, so one signal reaches everything it started.
		for (const attempt of ["SIGTERM", "SIGKILL"] as const) {
			try { this.killSignal(-lane.pid, attempt); }
			catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ESRCH") break;
				warnings.push(errorMessage(error));
				try { this.killSignal(lane.pid, attempt); }
				catch (fallback) { if ((fallback as NodeJS.ErrnoException).code !== "ESRCH") warnings.push(errorMessage(fallback)); }
			}
			const deadline = this.now() + KILL_GRACE_MS;
			while (this.now() < deadline && processAlive(lane.pid)) await sleep(100);
			if (!processAlive(lane.pid)) return { gone: true, alreadyGone: false, warnings };
		}
		const gone = this.liveness(lane, await this.processTable([lane.pid])) === "gone";
		return { gone, alreadyGone: false, warnings, ...(gone ? {} : { detail: `stop left worker process ${lane.pid} behind` }) };
	}

	/**
	 * A bare pid is not proof. Records live for 24 hours and pids get reused, so the recorded start
	 * time has to match too. Three things can be true: this is our worker, the pid is definitely
	 * free, or nobody could tell. The third one used to read as the second, which closed live lanes.
	 */
	private liveness(lane: LaneRecord, snapshot: ProcessSnapshot): Liveness {
		if (!lane.pid) return "gone";
		if (!snapshot.answered.has(lane.pid)) {
			// `ps` said nothing about this pid. `kill(pid, 0)` is the cheap second opinion: it cannot
			// confirm identity, but ESRCH does prove no process holds the pid at all.
			return processAlive(lane.pid) ? "unproven" : "gone";
		}
		const start = snapshot.starts.get(lane.pid);
		if (start === undefined) return "gone";
		if (!lane.pidStart) return "unproven";
		return sameProcessStart(lane.pidStart, start) ? "ours" : "gone";
	}
}

/**
 * `ps` formats `lstart` in the caller's locale. The call now forces `LC_ALL=C`, but a lane recorded
 * by an earlier build under `de_DE` holds `Do. 10 Sep. 19:43:39 2026` for what reads as
 * `Thu Sep 10 19:43:39 2026` today. The digits are the same in every locale, so they decide when the
 * strings differ.
 */
export function sameProcessStart(recorded: string, observed: string): boolean {
	if (recorded === observed) return true;
	const digits = (value: string): string => value.match(/\d+/g)?.join(" ") ?? "";
	const left = digits(recorded);
	return left.length > 0 && left === digits(observed);
}

export function launchArguments(spec: LaneSpec, session: string): string[] {
	const { model, thinking } = splitModelSpec(spec.model);
	const args = ["--print", "--name", spec.lane, "--model", model];
	if (spec.policy.tools?.length) args.push("--tools", spec.policy.tools.join(","));
	if (spec.policy.excludeTools.length) args.push("--exclude-tools", spec.policy.excludeTools.join(","));
	if (thinking) args.push("--thinking", thinking);
	args.push("--session-dir", spec.stateDir, "--session-id", session);
	// The brief is an argument, not a keystroke: nothing can be half-typed into a headless lane.
	args.push("--", spec.prompt);
	return args;
}

/**
 * Session-scoped variables describe the parent, not the worker. Pi strips them for nested
 * processes for the same reason, and a stale `HERDR_PANE_ID` would point a paneless worker at
 * its parent's pane.
 */
export function childEnvironment(parentId: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env, PI_DELEGATE_ROLE: "child", PI_DELEGATE_PARENT: parentId };
	// The whole HERDR_ set goes, not just the pane: a headless worker has no pane, no tab and no
	// workspace, and leaving HERDR_ENV=1 behind tells it that it lives in its parent's workspace.
	for (const key of [
		"PI_SESSION_ID", "PI_SESSION_FILE", "PI_INTERCOM_SESSION_ID", "PI_PROVIDER", "PI_MODEL", "PI_REASONING_LEVEL",
		"HERDR_ENV", "HERDR_PANE_ID", "HERDR_SOCKET_PATH", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID",
	]) delete env[key];
	return env;
}

const detachedLauncher: Launcher = async (request) => {
	const handle = await open(request.logFile, "a", 0o600);
	try {
		const child = spawn(request.command, request.args, {
			cwd: request.cwd,
			env: request.env,
			// detached gives the worker its own session and process group, so it survives the
			// parent's terminal and can be signalled as a group.
			detached: true,
			stdio: ["ignore", handle.fd, handle.fd],
		});
		const pid = child.pid;
		child.unref();
		if (!pid) throw new Error("spawn returned no pid");
		return { pid };
	} finally {
		await handle.close();
	}
};

/**
 * One `ps` for every lane at once. `lstart` is an absolute start time, so a reused pid reads
 * differently. A pid only lands in `answered` when this call is trusted, so a `ps` that never ran
 * leaves every lane unproven rather than dead.
 */
export const psTable: ProcessTable = async (pids) => {
	const unique = [...new Set(pids)];
	if (!unique.length) return { starts: new Map(), answered: new Set() };
	// An impossible pid makes `ps -p a,b,BAD` print nothing and exit 1, so it never reaches the call.
	// It is also not a pid anyone can hold, which makes "no such process" the honest answer for it.
	const queryable = unique.filter((pid) => isPid(pid));
	const answered = new Set(unique.filter((pid) => !isPid(pid)));
	const batch = await psQuery(queryable);
	if (batch) return { starts: batch, answered: new Set([...answered, ...queryable]) };
	// The batch failed as a whole. One pid per call, so one bad entry costs only its own lane.
	const starts = new Map<number, string>();
	for (const pid of queryable) {
		const single = await psQuery([pid]);
		if (!single) continue;
		answered.add(pid);
		const start = single.get(pid);
		if (start !== undefined) starts.set(pid, start);
	}
	return { starts, answered };
};

/** One `ps` call. `undefined` means the call itself failed, which is not "these pids are free". */
async function psQuery(pids: readonly number[]): Promise<Map<number, string> | undefined> {
	if (!pids.length) return new Map();
	let stdout: string;
	try {
		// `lstart` is locale-formatted, so the witness would change spelling with the parent's LANG.
		stdout = (await execFileAsync("ps", ["-o", "pid=,lstart=", "-p", pids.join(",")], {
			timeout: 5_000,
			env: { ...process.env, LC_ALL: "C", LANG: "C" },
		})).stdout;
	} catch (error) {
		// `ps` exits 1 with nothing on stdout and nothing on stderr when no pid matched. That is an
		// answer. Anything else (missing binary, timeout, "process id too large") is not.
		const failure = error as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
		if (failure.code !== 1 || failure.killed || String(failure.stderr ?? "").trim()) return undefined;
		stdout = String(failure.stdout ?? "");
	}
	const table = new Map<number, string>();
	for (const line of stdout.split("\n")) {
		const match = line.trim().match(/^(\d+)\s+(.*\S)\s*$/);
		if (match) table.set(Number(match[1]), match[2]!);
	}
	return table;
}

async function findSessionFile(lane: LaneRecord): Promise<string | undefined> {
	if (!lane.logFile || !lane.session) return undefined;
	const directory = join(lane.logFile, "..");
	let entries: string[];
	try { entries = await readdir(directory); }
	catch { return undefined; }
	const match = entries.find((name) => name.endsWith(".jsonl") && name.includes(lane.session));
	return match ? join(directory, match) : undefined;
}

/**
 * A blocked worker is waiting on the parent, so its transcript stands still. Once bytes land
 * after the ask, the reply arrived and the lane is working again.
 */
async function resumedSince(sessionFile: string | undefined, blockedAt: string | undefined, graceMs: number): Promise<boolean> {
	if (!blockedAt) return true;
	if (!sessionFile) return false;
	try { return (await stat(sessionFile)).mtimeMs > Date.parse(blockedAt) + graceMs; }
	catch { return false; }
}

/** UUIDv7, matching the shape pi assigns itself, so a pre-assigned id looks like any other session. */
export function uuidV7(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	const stamp = Date.now();
	for (let index = 0; index < 6; index += 1) bytes[index] = Math.floor(stamp / 2 ** (8 * (5 - index))) & 0xff;
	bytes[6] = (bytes[6]! & 0x0f) | 0x70;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
