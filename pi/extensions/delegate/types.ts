export type LaneStatus = "pending" | "idle" | "working" | "blocked" | "done" | "unknown" | "closed";

export interface DelegateProfile {
	model: string;
	readOnly?: boolean;
	tools?: string[];
	excludeTools?: string[];
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
export interface WaitInput { action: "wait"; lanes?: string[]; timeoutMs?: number }
export type DelegateInput = StartInput | ListInput | ReadInput | StopInput | WaitInput;
