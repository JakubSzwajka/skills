export type LifecycleState = "pending" | "queued" | "running" | "complete" | "failed" | "paused" | "stopped" | "rejected" | "unknown";
export type PromptAttribution = "exact" | "best-effort" | "unavailable";

export interface WarningRecord {
	kind: string;
	path?: string;
	message: string;
}

export interface ActivityRecord {
	ts?: number;
	type: string;
	detail?: string;
	attention?: boolean;
	runId?: string;
	workflowKey?: string;
	stepIndex?: number;
}

export interface AttemptRecord {
	id: string;
	runId?: string;
	state: LifecycleState;
	agent?: string;
	model?: string;
	thinking?: string;
	context?: "fresh" | "fork" | "mixed";
	startedAt?: number;
	endedAt?: number;
	durationMs?: number;
	turnCount?: number;
	toolCount?: number;
	totalTokens?: number;
	costUsd?: number;
	error?: string;
	attention?: boolean;
	activities?: ActivityRecord[];
	currentTool?: string;
	recentTools?: Array<{ tool: string; args?: string; endMs?: number }>;
	recentOutput?: string[];
	sessionFile?: string;
	transcriptPath?: string;
	outputPath?: string;
	/** Recorded roots used to contain bounded transcript/output reads. */
	trustedRoots?: string[];
	prompt?: string;
	promptAttribution: PromptAttribution;
	promptNote?: string;
	nested: AttemptRecord[];
	provisional?: boolean;
}

export interface LogicalChildRecord {
	id: string;
	workflowKey: string;
	label?: string;
	phase?: string;
	agent?: string;
	requestedContext?: "fresh" | "fork";
	resolvedContext?: "fresh" | "fork" | "mixed";
	attempts: AttemptRecord[];
	lineageAvailable: boolean;
}

export interface WorkflowRecord {
	id: string;
	workflowRunId: string;
	parentEntryId?: string;
	parentToolCallId?: string;
	goal?: string;
	state: LifecycleState;
	startedAt?: number;
	endedAt?: number;
	durationMs?: number;
	totalTokens?: number;
	totalCostUsd?: number;
	error?: string;
	activities?: ActivityRecord[];
	asyncDir?: string;
	attributed: boolean;
	stale: boolean;
	logicalChildren: LogicalChildRecord[];
	warnings: WarningRecord[];
}

export interface HistorySnapshot {
	sessionId: string;
	sessionFile?: string;
	sessionName?: string;
	scope: "branch" | "session";
	workflows: WorkflowRecord[];
	warnings: WarningRecord[];
	loadedAt: number;
}

export interface SourceReference {
	workflowRunId: string;
	asyncDir?: string;
	toolCallId?: string;
	parentEntryId?: string;
	goal?: string;
	observedAt: number;
}

export interface LedgerSnapshot {
	version: 1;
	sessionId: string;
	sessionFile?: string;
	updatedAt: number;
	sources: SourceReference[];
	workflows: WorkflowRecord[];
}
