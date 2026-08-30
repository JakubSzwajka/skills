import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const COMMAND_TIMEOUT_MS = 10_000;
const AGENT_START_TIMEOUT_MS = 30_000;
const SHELL_READY_TIMEOUT_MS = 5_000;
const SHELL_RETRY_DELAY_MS = 100;

type HerdrSplitResponse = {
	result?: {
		pane?: {
			pane_id?: string;
		};
	};
};

function parseSplitPaneId(output: string): string | undefined {
	for (const line of output.trim().split("\n").reverse()) {
		try {
			const response = JSON.parse(line) as HerdrSplitResponse;
			const paneId = response.result?.pane?.pane_id;
			if (paneId) return paneId;
		} catch {
			// Herdr normally emits one JSON line. Ignore unrelated output defensively.
		}
	}
	return undefined;
}

function herdrError(stdout: string, stderr: string): { code?: string; message: string } {
	const output = (stderr.trim() || stdout.trim()).split("\n").at(-1) ?? "Unknown error";
	try {
		const parsed = JSON.parse(output) as { error?: { code?: string; message?: string } };
		return {
			code: parsed.error?.code,
			message: parsed.error?.message ?? output.slice(0, 300),
		};
	} catch {
		return { message: output.slice(0, 300) };
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function agentNameFor(sessionFile: string): string {
	const sessionId = basename(sessionFile, ".jsonl").split("_").at(-1) ?? Date.now().toString(36);
	const suffix = sessionId.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 12);
	return `side-${suffix}`;
}

export default function sideChatExtension(pi: ExtensionAPI) {
	pi.registerCommand("side-chat", {
		description: "Clone this chat into a vertical Herdr split",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/side-chat requires Pi's interactive mode", "error");
				return;
			}

			if (process.env.HERDR_ENV !== "1" || !process.env.HERDR_PANE_ID) {
				ctx.ui.notify("/side-chat requires Pi to be running inside Herdr", "error");
				return;
			}

			await ctx.waitForIdle();

			const currentSessionFile = ctx.sessionManager.getSessionFile();
			const leafId = ctx.sessionManager.getLeafId();
			if (!currentSessionFile || !leafId || !existsSync(currentSessionFile)) {
				ctx.ui.notify("This chat has not been saved yet", "error");
				return;
			}

			let sideSessionFile: string | undefined;
			let paneCreated = false;
			try {
				// Clone through a separate manager. Calling createBranchedSession on the
				// live manager would redirect this pane's future writes to the clone.
				const source = SessionManager.open(currentSessionFile, ctx.sessionManager.getSessionDir());
				sideSessionFile = source.createBranchedSession(leafId);
				if (!sideSessionFile) throw new Error("Could not create a persistent side-chat session");

				const split = await pi.exec(
					"herdr",
					[
						"pane",
						"split",
						"--current",
						"--direction",
						"right",
						"--cwd",
						ctx.cwd,
						"--focus",
					],
					{ timeout: COMMAND_TIMEOUT_MS },
				);
				if (split.code !== 0) {
					throw new Error(`Herdr could not split the pane: ${herdrError(split.stdout, split.stderr).message}`);
				}
				paneCreated = true;

				const paneId = parseSplitPaneId(split.stdout);
				if (!paneId) throw new Error("Herdr did not return the new pane ID");

				const startArgs = [
					"agent",
					"start",
					agentNameFor(sideSessionFile),
					"--kind",
					"pi",
					"--pane",
					paneId,
					"--timeout",
					String(AGENT_START_TIMEOUT_MS),
					"--",
					"--session",
					sideSessionFile,
				];
				const shellReadyDeadline = Date.now() + SHELL_READY_TIMEOUT_MS;

				while (true) {
					const started = await pi.exec("herdr", startArgs, { timeout: AGENT_START_TIMEOUT_MS + 5_000 });
					if (started.code === 0) break;

					const error = herdrError(started.stdout, started.stderr);
					if (error.code !== "agent_pane_busy" || Date.now() >= shellReadyDeadline) {
						throw new Error(`Pi did not become ready in the new pane: ${error.message}`);
					}
					await delay(SHELL_RETRY_DELAY_MS);
				}

				ctx.ui.notify("Side chat opened", "info");
			} catch (error) {
				// If splitting never succeeded, avoid leaving an unreachable clone behind.
				// Once Herdr created the pane, retain the clone: Pi may still be starting
				// or waiting for user input there even if readiness detection timed out.
				const message = error instanceof Error ? error.message : String(error);
				if (sideSessionFile && !paneCreated) {
					await rm(sideSessionFile, { force: true }).catch(() => undefined);
				}
				ctx.ui.notify(message, "error");
			}
		},
	});
}
