export const COMMIT_WIDGET_KEY = "commit";
export const COMMIT_WIDGET_TICK_MS = 100;

export type CommitPhase = "inspecting" | "staging" | "committing";

export interface CommitProgress {
	phase: CommitPhase;
	model?: string;
	stagedPaths?: readonly string[];
}

export interface CommitWidgetUi {
	setWidget(key: string, lines: string[] | undefined): void;
}

export interface CommitWidgetClock {
	now(): number;
	setInterval(callback: () => void, delayMs: number): ReturnType<typeof setInterval>;
	clearInterval(handle: ReturnType<typeof setInterval>): void;
}

const systemClock: CommitWidgetClock = {
	now: () => Date.now(),
	setInterval: (callback, delayMs) => setInterval(callback, delayMs),
	clearInterval: (handle) => clearInterval(handle),
};

export function shortCommitModel(model: string | undefined): string {
	if (!model) return "selecting";
	const id = model.slice(model.lastIndexOf("/") + 1).toLowerCase();
	if (id.includes("luna")) return "luna";
	if (id.includes("haiku")) return "haiku";
	return clip(id || model, 24);
}

export function renderCommitWidget(progress: CommitProgress, elapsedMs: number): string[] {
	const paths = [...new Set(progress.stagedPaths ?? [])];
	const count = `${paths.length} file${paths.length === 1 ? "" : "s"}`;
	const phase = progress.phase === "inspecting" ? "inspecting" : `${progress.phase}  ${count}`;
	return [
		`/commit  ${shortCommitModel(progress.model)}  ${(Math.max(0, elapsedMs) / 1_000).toFixed(1)}s`,
		phase,
		...paths.map((path) => `  ${clip(path, 120)}`),
	];
}

export class CommitStatusWidget {
	private readonly ui: CommitWidgetUi;
	private readonly clock: CommitWidgetClock;
	private progress: CommitProgress = { phase: "inspecting", stagedPaths: [] };
	private startedAt = 0;
	private timer?: ReturnType<typeof setInterval>;
	private running = false;

	constructor(ui: CommitWidgetUi, clock: CommitWidgetClock = systemClock) {
		this.ui = ui;
		this.clock = clock;
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.startedAt = this.clock.now();
		this.paint();
		this.timer = this.clock.setInterval(() => this.paint(), COMMIT_WIDGET_TICK_MS);
		this.timer.unref?.();
	}

	update(progress: CommitProgress): void {
		if (!this.running) return;
		this.progress = {
			...this.progress,
			...progress,
			stagedPaths: progress.stagedPaths ?? this.progress.stagedPaths,
		};
		this.paint();
	}

	stop(): void {
		if (this.timer) {
			this.clock.clearInterval(this.timer);
			this.timer = undefined;
		}
		if (!this.running) return;
		this.running = false;
		try { this.ui.setWidget(COMMIT_WIDGET_KEY, undefined); }
		catch { /* A broken UI must not change the commit result. */ }
	}

	private paint(): void {
		if (!this.running) return;
		try {
			this.ui.setWidget(COMMIT_WIDGET_KEY, renderCommitWidget(this.progress, this.clock.now() - this.startedAt));
		} catch {
			// Progress is best-effort. Git safety and the final receipt stay authoritative.
		}
	}
}

function clip(value: string, limit: number): string {
	if (value.length <= limit) return value;
	return `${value.slice(0, Math.max(0, limit - 1))}…`;
}
