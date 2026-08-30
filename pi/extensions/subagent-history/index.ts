import type { ExtensionAPI, SessionManager } from "@earendil-works/pi-coding-agent";
import { sourceFromEvent, sourceMatchesSession } from "./collector.ts";
import { disposeHistoryViews, openHistory } from "./history-ui.ts";
import { upsertSource } from "./ledger.ts";
import { isRecord, text } from "./artifacts.ts";
import type { SourceReference } from "./types.ts";

type SessionIdentity = Pick<SessionManager, "getSessionId" | "getSessionFile">;

export default function subagentHistory(pi: ExtensionAPI): void {
	let manager: SessionIdentity | undefined;
	let disposed = false;
	const owner = () => manager && { sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), ownerId: manager.getSessionFile() ?? manager.getSessionId() };
	const retain = (source: SourceReference, eventOwner?: unknown, trustedContext = false) => {
		const current = owner();
		if (!current) return;
		if (typeof eventOwner === "string" ? eventOwner !== current.ownerId : !trustedContext && !sourceMatchesSession(source, current.sessionId, current.sessionFile)) return;
		try { upsertSource(current.sessionId, current.sessionFile, source); } catch { /* the dashboard surfaces ledger write failures on collection */ }
	};
	const eventHandler = (value: unknown) => { const source = sourceFromEvent(value); if (source) retain(source, isRecord(value) ? value.sessionId : undefined); };
	const unsubscribes: Array<() => void> = [];
	const installEvents = () => {
		if (unsubscribes.length) return;
		for (const event of ["subagent:async-started", "subagent:async-complete", "subagent:child-status", "subagent:process-terminal"]) unsubscribes.push(pi.events.on(event, eventHandler));
	};
	installEvents();

	pi.on("session_start", (_event, ctx) => { manager = ctx.sessionManager; disposed = false; installEvents(); });
	pi.on("tool_result", (event, ctx) => {
		manager = ctx.sessionManager;
		if (event.toolName !== "subagent" || !isRecord(event.details)) return;
		const runId = text(event.details.runId) ?? text(event.details.asyncId) ?? text(event.details.id);
		const asyncDir = text(event.details.asyncDir);
		if (runId && asyncDir) retain({ workflowRunId: runId, asyncDir, toolCallId: event.toolCallId, observedAt: Date.now() }, undefined, true);
	});
	pi.on("session_shutdown", () => {
		disposeHistoryViews();
		manager = undefined;
		if (!disposed) { disposed = true; for (const unsubscribe of unsubscribes.splice(0)) unsubscribe(); }
	});

	pi.registerCommand("subagents-history", {
		description: "Browse read-only subagent history for the current session",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") { ctx.ui.notify("/subagents-history requires the interactive Pi TUI", "error"); return; }
			manager = ctx.sessionManager;
			try { await openHistory(ctx, pi); }
			catch (error) { ctx.ui.notify(`Could not open subagent history: ${error instanceof Error ? error.message : String(error)}`, "error"); }
		},
	});
}
