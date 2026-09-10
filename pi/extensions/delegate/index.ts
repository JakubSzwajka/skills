import { access, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DelegateService, intercomRings } from "./delegate.ts";
import type { CommandResult } from "./types.ts";

const WIDGET_KEY = "delegate";
const ACTIONS = ["start", "list", "read", "wait", "stop"] as const;

export default function delegateExtension(pi: ExtensionAPI): void {
	install(pi);
}

function install(pi: ExtensionAPI): void {
	if (process.env.PI_DELEGATE_ROLE === "child") return;

	let service: DelegateService | undefined;
	const announced = new Set<string>();
	const seenRings = new Set<string>();

	const runner = {
		async exec(command: string, args: string[], options?: { signal?: AbortSignal; timeout?: number }): Promise<CommandResult> {
			const result = await pi.exec(command, args, options ?? {}) as CommandResult;
			return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: typeof result.code === "number" ? result.code : 0, killed: result.killed };
		},
	};

	const domain = (): DelegateService => (service ??= new DelegateService(runner, homedir()));

	const unavailable = async (): Promise<string | undefined> => {
		if (process.env.HERDR_ENV !== "1") return "delegate needs a Herdr pane: HERDR_ENV is not 1, so no lane can be started, listed, read, waited on, or stopped.";
		if (!(await onPath("herdr"))) return "delegate needs the herdr binary on PATH, and it is missing. No lane can be started, listed, read, waited on, or stopped.";
		return undefined;
	};

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

	const refreshWidget = async (ctx: ExtensionContext): Promise<void> => {
		if (!ctx.hasUI) return;
		if (await unavailable()) { ctx.ui.setWidget(WIDGET_KEY, undefined); return; }
		const lanes = (await domain().list(actionContext(ctx))).filter((lane) => lane.status !== "closed");
		if (!lanes.length) { ctx.ui.setWidget(WIDGET_KEY, undefined); return; }
		ctx.ui.setWidget(WIDGET_KEY, lanes.map((lane, index) => {
			const label = index === 0 ? "delegate" : "        ";
			const status = lane.status === "blocked" ? "BLOCKED" : String(lane.status);
			const context = lane.contextPct === null ? "  — ctx" : `${String(lane.contextPct).padStart(4)}% ctx`;
			const spend = lane.spendUsd === null ? "     —" : `$${Number(lane.spendUsd).toFixed(2)}`.padStart(6);
			const ring = lane.status === "blocked" ? "needs you" : `ring:${lane.rang ? "yes" : "—"}${lane.unread ? "  unread" : ""}`;
			return `${label}  ${String(lane.lane).padEnd(14)}${String(lane.profile).padEnd(10)}${status.padEnd(9)}${context}  ${spend}  ${ring}`;
		}));
	};

	const correlateRings = async (ctx: ExtensionContext): Promise<void> => {
		if (await unavailable()) return;
		for (const ring of intercomRings(ctx.sessionManager.getEntries())) {
			if (seenRings.has(ring.messageId)) continue;
			seenRings.add(ring.messageId);
			await domain().markRang(ring.sender, actionContext(ctx));
		}
	};

	const nudge = async (ctx: ExtensionContext): Promise<void> => {
		if (!ctx.hasUI || await unavailable()) return;
		for (const lane of await domain().list(actionContext(ctx))) {
			if (lane.status === "blocked") {
				ctx.ui.notify(`delegate lane ${lane.lane} is BLOCKED and waiting for you (pane ${lane.pane ?? "?"}).`, "warning");
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
		if (await unavailable()) return;
		await domain().adopt(actionContext(ctx));
		await refreshWidget(ctx);
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
		if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
	}));

	pi.registerTool({
		name: "delegate",
		label: "Delegate",
		description: [
			"Run work in another pi session as a Herdr pane. start returns immediately; the worker reports back through a handoff file and an intercom ring.",
			"If a worker needs a decision, it asks the orchestrator through intercom and waits. Answer that inbound question directly rather than forwarding it blindly.",
			"Actions: start (profile, brief, optional name/cwd/model/handoff), list, read (lane), wait (lanes, timeoutMs), stop (lane).",
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
			model: Type.Optional(Type.String({ description: "Override the profile model, provider/id[:thinking]" })),
			handoff: Type.Optional(Type.String({ description: "Override the assigned handoff path" })),
			lane: Type.Optional(Type.String({ description: "Lane name for read and stop" })),
			lanes: Type.Optional(Type.Array(Type.String(), { description: "Lanes for wait, default every live lane" })),
			timeoutMs: Type.Optional(Type.Integer({ minimum: 1, description: "Wait timeout in milliseconds" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			try {
				const blocked = await unavailable();
				if (blocked) return { content: [{ type: "text", text: blocked }], details: { error: "unavailable" } };
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
