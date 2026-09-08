/**
 * Registration, folded into "go online" instead of a separate manual step.
 *
 * This reverses the earlier design (see README history): the operator asked
 * for one command that either works or says why, not a five-step setup
 * checklist. So `/blocks:online` now checks the registry itself and, if this
 * agentName isn't there yet, registers it before connecting — private and
 * free, the CLI's own recommended default, never public or paid.
 *
 * The tradeoff is explicit: `startAgentInstance` was always going to refuse
 * to run an unregistered agent (the SDK checks and throws), so this removes a
 * manual step the SDK made mandatory anyway. It does not remove a safety
 * check — it just performs the same registration the operator would have
 * typed by hand, using the same CLI, gated on the operator having put an API
 * key in `.env` in the first place. Nothing here runs unless `/blocks:online`
 * is run.
 *
 * The API key is passed to the CLI over its stdin (`--api-key-stdin`), not as
 * an argv string, so it never appears in `ps` output.
 */

import { spawn } from "node:child_process";

export interface AgentLookup {
	(agentName: string, options: { apiKey: string; baseUrl?: string }): Promise<unknown | null>;
}

export interface RegisterProcessResult {
	code: number;
	stdout: string;
	stderr: string;
}

export interface RegisterRunner {
	(cardPath: string, apiKey: string): Promise<RegisterProcessResult>;
}

export interface EnsureRegisteredDeps {
	getAgent: AgentLookup;
	runRegister: RegisterRunner;
}

export type EnsureRegisteredResult =
	| { action: "already-registered" }
	| { action: "registered" }
	| { action: "failed"; detail: string };

/**
 * Pure orchestration: look the name up, register only if it's missing. Kept
 * separate from `runBlocksRegister` below so this can be unit tested without
 * spawning a real process or calling the network.
 */
export async function ensureRegistered(
	agentName: string,
	cardPath: string,
	apiKey: string,
	deps: EnsureRegisteredDeps,
): Promise<EnsureRegisteredResult> {
	const existing = await deps.getAgent(agentName, { apiKey });
	if (existing) return { action: "already-registered" };

	const result = await deps.runRegister(cardPath, apiKey);
	if (result.code !== 0) {
		const detail = (result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`);
		return { action: "failed", detail };
	}
	return { action: "registered" };
}

/**
 * The real registration run: `blocks register --api-key-stdin <agent-card.json>`.
 * Requires the CLI on PATH (the same one the manual setup step used). The
 * argument is the card *file* — the CLI does `readFile` on exactly the path
 * given, not a directory lookup, so a directory here fails with ENOTDIR/EISDIR
 * rather than finding `agent-card.json` inside it.
 */
export const runBlocksRegister: RegisterRunner = (cardPath, apiKey) =>
	new Promise((resolve, reject) => {
		const child = spawn("blocks", ["register", "--api-key-stdin", cardPath], {
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			reject(
				new Error(
					`could not run the "blocks" CLI (${error.message}). Is @blocks-network/cli installed and on PATH?`,
				),
			);
		});
		child.on("close", (code) => {
			resolve({ code: code ?? 1, stdout, stderr });
		});

		child.stdin.write(apiKey);
		child.stdin.end();
	});
