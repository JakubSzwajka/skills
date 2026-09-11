export type LaneStatus = "pending" | "idle" | "working" | "blocked" | "done" | "unknown" | "closed";

/**
 * How a lane is run. `herdr` gives it a visible pane; `subprocess` runs it headless.
 *
 * A lane's transport comes from its profile and nowhere else, because it decides whether the
 * operator can watch the work. The model stays a per-call choice: matching a model to a lane's
 * difficulty is the orchestrator's job.
 */
export type Transport = "herdr" | "subprocess";

export const TRANSPORTS: readonly Transport[] = ["herdr", "subprocess"];
export const DEFAULT_TRANSPORT: Transport = "herdr";

export interface DelegateProfile {
	model: string;
	readOnly?: boolean;
	tools?: string[];
	excludeTools?: string[];
	transport?: Transport;
}

export interface LaneRecord {
	lane: string;
	profile: string;
	pane: string;
	session: string;
	cwd: string;
	handoff: string;
	started: string;
	rang?: string;
	read: boolean;
	closed: boolean;
	closedAt?: string;
	model?: string;
	sessionFile?: string;
	status?: LaneStatus;
	error?: string;
	ownerSession?: string;
	ownerPid?: number;
	transport?: Transport;
	/** Subprocess transport: the detached worker's pid, which is also its process group id. */
	pid?: number;
	/** Second liveness witness for `pid`, so a reused pid cannot pass as a live lane. */
	pidStart?: string;
	/** Subprocess transport: where the worker's stdout and stderr are appended. */
	logFile?: string;
	/** When an intercom ask from this lane reached the parent, so `blocked` can clear itself. */
	blockedAt?: string;
}

export interface LaneRegistry {
	lanes: LaneRecord[];
}

export interface CommandResult {
	stdout: string;
	stderr: string;
	code: number;
	killed?: boolean;
}

export interface CommandRunner {
	exec(command: string, args: string[], options?: { signal?: AbortSignal; timeout?: number }): Promise<CommandResult>;
}

/** Everything a runner needs to create one lane. Assembled by the service, never by a runner. */
export interface LaneSpec {
	lane: string;
	cwd: string;
	parentId: string;
	/** `provider/id[:thinking]`, still joined; each runner splits it the way its target wants. */
	model: string;
	policy: { tools?: string[]; excludeTools: string[] };
	/** The brief with the return contract already appended. Delivered whole, never in pieces. */
	prompt: string;
	handoff: string;
	/** A per-lane directory the runner may use for logs and session files. */
	stateDir: string;
}

/** What a runner learned while creating a lane. Every field is transport-specific and optional. */
export interface LaneHandle {
	pane?: string;
	session?: string;
	sessionFile?: string;
	pid?: number;
	pidStart?: string;
	logFile?: string;
	status?: LaneStatus;
	/** Herdr only: false when the pane never confirmed the transition to `working`. */
	transitionConfirmed?: boolean;
}

/**
 * One lane as the runner currently sees it. `gone` means the lane's home is destroyed and the
 * record should close; a `status` observation only moves the record's state.
 */
export type LaneObservation =
	| { kind: "status"; status: LaneStatus; session?: string; sessionFile?: string }
	| { kind: "gone" };

export interface LaneKill {
	gone: boolean;
	alreadyGone: boolean;
	warnings: string[];
	/** Why the lane is still there, when `gone` is false. */
	detail?: string;
}

/** Persists partial progress while a lane is being created, so a half-built lane stays addressable. */
export type LaneProgress = (patch: Partial<LaneRecord>) => Promise<void>;

/**
 * The seam between the service and whatever actually runs a worker.
 *
 * `probe` takes the whole lane list and answers in one map on purpose: a herdr probe is one
 * `agent list` plus one `pane list` for every lane at once, and a subprocess probe is one `ps`
 * for every pid at once. A per-lane signature would force the pane model onto both.
 */
export interface LaneRunner {
	readonly transport: Transport;
	/** Names already taken by something this runner can see, so a new lane cannot collide. */
	liveNames(signal?: AbortSignal): Promise<Set<string>>;
	spawn(spec: LaneSpec, progress: LaneProgress, signal?: AbortSignal): Promise<LaneHandle>;
	probe(lanes: readonly LaneRecord[], signal?: AbortSignal): Promise<Map<string, LaneObservation>>;
	kill(lane: LaneRecord, signal?: AbortSignal): Promise<LaneKill>;
}

/** Sort key for lane lists: the states that need an operator come first. */
export function statusRank(status: string): number {
	return status === "blocked" ? 0 : status === "working" ? 1 : status === "done" || status === "idle" ? 2 : status === "unknown" || status === "pending" ? 3 : 4;
}

export interface StartInput {
	action: "start";
	profile?: string;
	brief?: string;
	name?: string;
	cwd?: string;
	model?: string;
	handoff?: string;
}

export interface ListInput { action: "list" }
export interface ReadInput { action: "read"; lane?: string }
export interface StopInput { action: "stop"; lane?: string }
export type DelegateInput = StartInput | ListInput | ReadInput | StopInput;
