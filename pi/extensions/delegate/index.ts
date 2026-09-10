import { access, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DelegateService, intercomRings } from "./delegate.ts";
import { HerdrLaneRunner } from "./runners/herdr.ts";
import { SubprocessLaneRunner } from "./runners/subprocess.ts";
import { SessionStatsWatcher, ClosedLaneMemory, laneSignature, laneWidgetFactory, sampleLaneViews } from "./widget.ts";
import type { CommandResult } from "./types.ts";

const WIDGET_KEY = "delegate";
const ACTIONS = ["start", "list", "read", "wait", "stop"] as const;
// A cheap tick reads only the bytes appended to each worker transcript. Every fourth tick also asks
// herdr for lane statuses, which is the only part that spawns a subprocess.
const TICK_MS = 1_500;
const SYNC_EVERY_TICKS = 4;

export default function delegateExtension(pi: ExtensionAPI): void {
	install(pi);
}

function install(pi: ExtensionAPI): void {
	if (process.env.PI_DELEGATE_ROLE === "child") return;

	let service: DelegateService | undefined;
	const announced = new Set<string>();
	const seenRings = new Set<string>();
	const watcher = new SessionStatsWatcher();
	// Finished lanes stay on screen for the rest of the session, so this session keeps its own history
	// even after the registry's retention window prunes the record.
	const finished = new ClosedLaneMemory();
	let shownSignature: string | undefined;
	// Whether any row on screen is a lane that can still move. Finished rows keep the widget visible
	// for the rest of the session, and asking a transport about lanes that are all closed would buy
	// nothing but a pair of spawns every six seconds.
	let liveOnScreen = false;
	let timer: ReturnType<typeof setInterval> | undefined;
	let ticking = false;
	let ticksToSync = SYNC_EVERY_TICKS;
	// Bumped when the widget is torn down. A tick that was already awaiting compares the era it
	// started in and drops its repaint instead of putting a cleared widget back on screen.
	let generation = 0;

	const runner = {
		async exec(command: string, args: string[], options?: { signal?: AbortSignal; timeout?: number }): Promise<CommandResult> {
			const result = await pi.exec(command, args, options ?? {}) as CommandResult;
			return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: typeof result.code === "number" ? result.code : 0, killed: result.killed };
		},
	};

	// Only the positive answer is cached: a PATH scan per widget tick would cost one access() per PATH
	// entry, while a missing binary stays worth re-checking in case it gets installed mid-session.
	let herdrFound = false;
	// Unavailability now belongs to the transport that is unavailable. A session outside Herdr can
	// still run, list, read and stop headless lanes; only the pane transport refuses.
	const herdrUnavailable = async (): Promise<string | undefined> => {
		if (process.env.HERDR_ENV !== "1") return "delegate cannot use the herdr transport: HERDR_ENV is not 1, so no pane lane can be started, waited on, or stopped. A headless lane needs a profile whose transport is subprocess, which only the operator can change.";
		if (!herdrFound) {
			if (!(await onPath("herdr"))) return "delegate cannot use the herdr transport: the herdr binary is missing from PATH. A headless lane needs a profile whose transport is subprocess, which only the operator can change.";
			herdrFound = true;
		}
		return undefined;
	};

	const domain = (): DelegateService => (service ??= new DelegateService(runner, homedir(), [
		new HerdrLaneRunner(runner, herdrUnavailable),
		new SubprocessLaneRunner(),
	]));

	const actionContext = (ctx: ExtensionContext, signal?: AbortSignal) => ({
		parentId: ctx.sessionManager.getSessionId(),
		cwd: ctx.cwd,
		...(signal ? { signal } : {}),
		contextWindow: (model: string) => {
			try {
				const [provider, rest] = model.includes("/") ? [model.slice(0, model.indexOf("/")), model.slice(model.indexOf("/") + 1)] : [undefined, model];
				const id = rest.replace(/:(off|minimal|low|medium|high|xhigh|max)$/, "");
				if (!provider) return null;
				return ctx.modelRegistry?.find?.(provider, id)?.contextWindow ?? null;
			} catch { return null; }
		},
	});

	const clearWidget = (ctx: ExtensionContext): void => {
		if (shownSignature === undefined) return;
		shownSignature = undefined;
		liveOnScreen = false;
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	};

	/** Repaint from the registry and the transcript tails. No subprocess runs here. */
	const paintWidget = async (ctx: ExtensionContext): Promise<void> => {
		if (!ctx.hasUI) return;
		const era = generation;
		const lanes = await sampleLaneViews({ root: domain().root, cwd: ctx.cwd, parentId: ctx.sessionManager.getSessionId(), watcher, finished, contextWindow: actionContext(ctx).contextWindow });
		if (era !== generation) return;
		if (!lanes.length) { clearWidget(ctx); return; }
		liveOnScreen = lanes.some((lane) => !lane.finished);
		const signature = laneSignature(lanes);
		if (signature === shownSignature) return;
		shownSignature = signature;
		ctx.ui.setWidget(WIDGET_KEY, laneWidgetFactory(lanes));
	};

	/** Ask each transport for lane statuses and write them back to the registry, then repaint. */
	const refreshWidget = async (ctx: ExtensionContext): Promise<void> => {
		if (!ctx.hasUI) return;
		const era = generation;
		// Counted before the call, not after: a herdr that is present but failing must still buy the
		// next three cheap ticks, or a dead daemon turns every 1.5 s tick into a pair of spawns.
		ticksToSync = SYNC_EVERY_TICKS;
		// Statuses only. `list` would also re-read every handoff and every transcript, several times a
		// minute, to produce numbers the widget already samples incrementally.
		await domain().refreshStatus(actionContext(ctx));
		if (era !== generation) return;
		await paintWidget(ctx);
	};

	const tick = async (ctx: ExtensionContext): Promise<void> => {
		if (ticking) return;
		ticking = true;
		try {
			// Statuses only move when a lane is live, so the subprocess pair stays idle otherwise.
			if (shownSignature !== undefined && liveOnScreen && --ticksToSync <= 0) await refreshWidget(ctx);
			else await paintWidget(ctx);
		} catch (error) { void error; }
		finally { ticking = false; }
	};

	const stopTimer = (): void => {
		if (!timer) return;
		clearInterval(timer);
		timer = undefined;
	};

	const startTimer = (ctx: ExtensionContext): void => {
		stopTimer();
		if (!ctx.hasUI) return;
		timer = setInterval(() => { void tick(ctx); }, TICK_MS);
		timer.unref?.();
	};

	const correlateRings = async (ctx: ExtensionContext): Promise<void> => {
		for (const ring of intercomRings(ctx.sessionManager.getEntries())) {
			if (seenRings.has(ring.messageId)) continue;
			seenRings.add(ring.messageId);
			await domain().markRang(ring.sender, actionContext(ctx), { expectsReply: ring.expectsReply });
		}
	};

	const nudge = async (ctx: ExtensionContext): Promise<void> => {
		if (!ctx.hasUI) return;
		for (const lane of await domain().list(actionContext(ctx))) {
			if (lane.status === "blocked") {
				ctx.ui.notify(`delegate lane ${lane.lane} is BLOCKED and waiting for you (${lane.pane ? `pane ${lane.pane}` : `log ${lane.logFile ?? "?"}`}).`, "warning");
				continue;
			}
			const terminal = lane.status === "done" || lane.status === "idle";
			if (terminal && lane.unread && !announced.has(String(lane.lane))) {
				announced.add(String(lane.lane));
				ctx.ui.notify(`delegate lane ${lane.lane} finished with an unread handoff: ${lane.handoff}`, "info");
			}
			if (!lane.unread) announced.delete(String(lane.lane));
		}
	};

	const safely = (action: (ctx: ExtensionContext) => Promise<void>) => async (_event: unknown, ctx: ExtensionContext): Promise<void> => {
		try { await action(ctx); }
		catch (error) { void error; }
	};

	pi.on("session_start", safely(async (ctx) => {
		// The timer is the only retry path this widget has, so failed startup work must not cost the
		// session its live widget for the rest of its life.
		try {
			await domain().adopt(actionContext(ctx));
			await refreshWidget(ctx);
		} finally {
			startTimer(ctx);
		}
	}));

	pi.on("turn_start", safely(async (ctx) => {
		await correlateRings(ctx);
		await refreshWidget(ctx);
	}));

	pi.on("turn_end", safely(async (ctx) => {
		await correlateRings(ctx);
		await refreshWidget(ctx);
		await nudge(ctx);
	}));

	pi.on("session_shutdown", safely(async (ctx) => {
		stopTimer();
		generation += 1;
		liveOnScreen = false;
		if (ctx.hasUI) { shownSignature = undefined; ctx.ui.setWidget(WIDGET_KEY, undefined); }
	}));

	pi.registerTool({
		name: "delegate",
		label: "Delegate",
		description: [
			"Run work in another pi session, either as a Herdr pane or as a detached headless process. start returns immediately; the worker reports back through a handoff file and an intercom ring.",
			"If a worker needs a decision, it asks the orchestrator through intercom and waits. Answer that inbound question directly rather than forwarding it blindly.",
			"Actions: start (profile, brief, optional name/cwd/model/handoff), list, read (lane), wait (lanes, timeoutMs), stop (lane).",
			"A lane's transport comes from its profile and nowhere else, because it decides whether the operator can watch the work; there is no transport argument and naming one is refused. model stays yours to choose per lane, because matching a model to a lane's difficulty is your job.",
			"A subprocess lane has no pane to watch or steer, and only reports working, blocked on an intercom ask, done, or unknown.",
			"A subprocess lane reads unknown when its liveness cannot be established; stop then refuses to signal and tells you how to finish by hand, and the lane stays open. Outside Herdr, list, read and stop still work on subprocess lanes, and list reports any transport it could not reach as staleTransports.",
			"Profiles carry the model and tool policy. The tool appends the worker return contract, assigns the handoff path, and injects the doorbell line; never write those yourself.",
		].join(" "),
		promptSnippet: "Delegate a lane of work to another pi session and read its handoff",
		promptGuidelines: [
			"Use delegate to run owned work in another session instead of doing it yourself; name the owned paths in the brief.",
			"When a delegate worker asks for a decision through intercom, answer it directly rather than forwarding the question blindly.",
			"Use delegate action=read after a worker rings, and delegate action=stop once its handoff is read.",
		],
		parameters: Type.Object({
			action: StringEnum(ACTIONS),
			profile: Type.Optional(Type.String({ description: "Profile name, default worker" })),
			brief: Type.Optional(Type.String({ description: "The brief for the worker; the return contract is appended automatically" })),
			name: Type.Optional(Type.String({ description: "Lane name, [a-z][a-z0-9_-]{0,31}" })),
			cwd: Type.Optional(Type.String({ description: "Working directory for the lane, default this session's cwd" })),
			model: Type.Optional(Type.String({ description: "Override the profile model, provider/id[:thinking]. The one per-call override there is: match the model to the lane's difficulty" })),
			handoff: Type.Optional(Type.String({ description: "Override the assigned handoff path" })),
			lane: Type.Optional(Type.String({ description: "Lane name for read and stop" })),
			lanes: Type.Optional(Type.Array(Type.String(), { description: "Lanes for wait, default every live lane" })),
			timeoutMs: Type.Optional(Type.Integer({ minimum: 1, description: "Wait timeout in milliseconds" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			try {
				const result = await domain().execute(params as never, actionContext(ctx, signal ?? undefined));
				try { await refreshWidget(ctx); } catch (error) { void error; }
				return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { content: [{ type: "text", text: `delegate failed: ${message}` }], details: { error: "runtime", message } };
			}
		},
	});
}

function onPath(binary: string): Promise<boolean> {
	const directories = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
	return Promise.all(directories.map((directory) => new Promise<boolean>((resolve) => {
		access(join(directory, binary), constants.X_OK, (error) => resolve(!error));
	}))).then((results) => results.includes(true));
}
