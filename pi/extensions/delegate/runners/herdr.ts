import { basename } from "node:path";
import type {
	CommandRunner, LaneHandle, LaneKill, LaneObservation, LaneProgress, LaneRecord, LaneRunner, LaneSpec, LaneStatus,
} from "../types.ts";
import { errorMessage, isObject, isPresent, numberValue, processGroupAlive, sleep, splitModelSpec, text } from "./support.ts";

export interface AgentInfo {
	name?: string;
	pane: string;
	status: LaneStatus;
	session: string;
	sessionFile?: string;
}

/**
 * The original transport: every lane is a Herdr pane running an interactive pi agent.
 * All the herdr shelling in this extension lives here and nowhere else.
 */
export class HerdrLaneRunner implements LaneRunner {
	readonly transport = "herdr" as const;
	private readonly runner: CommandRunner;
	/** Answers why herdr cannot be reached, so an unreachable pane transport says so in its own words. */
	private readonly available: () => Promise<string | undefined>;

	constructor(runner: CommandRunner, available?: () => Promise<string | undefined>) {
		this.runner = runner;
		this.available = available ?? (async () => undefined);
	}

	async liveNames(signal?: AbortSignal): Promise<Set<string>> {
		return new Set((await this.listAgents(signal)).map((agent) => agent.name).filter(isPresent));
	}

	async spawn(spec: LaneSpec, progress: LaneProgress, signal?: AbortSignal): Promise<LaneHandle> {
		const split = await this.herdr([
			"pane", "split", "--current", "--direction", "right", "--ratio", "0.4", "--cwd", spec.cwd,
			"--env", "PI_DELEGATE_ROLE=child", "--env", `PI_DELEGATE_PARENT=${spec.parentId}`, "--no-focus",
		], signal, 10_000, "split pane");
		const pane = findString(split, ["pane_id", "paneId"]);
		if (!pane) throw new Error("Herdr split a pane but returned no pane ID");
		await progress({ pane });
		await this.awaitAvailableShell(pane, signal);
		const started = await this.startAgent(pane, spec, signal);
		const agent = toAgent(findObject(started, (value) => isObject(value) && (value.pane_id === pane || value.paneId === pane) ? value : undefined));
		if (!agent) throw new Error("Herdr did not confirm the started Pi agent");
		await progress({ session: agent.session, ...(agent.sessionFile ? { sessionFile: agent.sessionFile } : {}), status: agent.status });
		let transitionConfirmed = true;
		try {
			await this.herdr(["agent", "prompt", spec.lane, spec.prompt, "--wait", "--until", "working", "--timeout", "10000"], signal, 11_000, "deliver brief");
		} catch (error) {
			if (!isTransitionTimeout(error)) throw error;
			transitionConfirmed = false;
		}
		return {
			pane,
			session: agent.session,
			...(agent.sessionFile ? { sessionFile: agent.sessionFile } : {}),
			...(transitionConfirmed ? { status: "working" as LaneStatus } : {}),
			transitionConfirmed,
		};
	}

	async probe(lanes: readonly LaneRecord[], signal?: AbortSignal): Promise<Map<string, LaneObservation>> {
		const observations = new Map<string, LaneObservation>();
		if (!lanes.some((lane) => lane.pane)) return observations;
		const [agents, panes] = await both(this.listAgents(signal), this.listPanes(signal));
		const byPane = new Map(agents.map((agent) => [agent.pane, agent]));
		for (const lane of lanes) {
			if (!lane.pane) continue;
			const agent = byPane.get(lane.pane);
			if (agent) {
				observations.set(lane.lane, {
					kind: "status", status: agent.status,
					...(agent.session ? { session: agent.session } : {}),
					...(agent.sessionFile ? { sessionFile: agent.sessionFile } : {}),
				});
			} else observations.set(lane.lane, panes.has(lane.pane) ? { kind: "status", status: "unknown" } : { kind: "gone" });
		}
		return observations;
	}

	async kill(lane: LaneRecord, signal?: AbortSignal): Promise<LaneKill> {
		if (!lane.pane) return { gone: true, alreadyGone: true, warnings: [] };
		const [agents, panes] = await both(this.listAgents(signal), this.listPanes(signal));
		if (!agents.some((agent) => agent.pane === lane.pane) && !panes.has(lane.pane)) return { gone: true, alreadyGone: true, warnings: [] };
		const warnings: string[] = [];
		try { await this.terminatePaneProcess(lane.pane, signal); }
		catch (error) { warnings.push(errorMessage(error)); }
		try { await this.herdr(["pane", "close", lane.pane], signal, 5_000, "close pane"); }
		catch (error) { warnings.push(errorMessage(error)); }
		const [afterAgents, afterPanes] = await both(this.listAgents(signal), this.listPanes(signal));
		const gone = !afterAgents.some((agent) => agent.pane === lane.pane) && !afterPanes.has(lane.pane);
		return {
			gone, alreadyGone: false, warnings,
			...(gone ? {} : { detail: `stop left pane ${lane.pane} behind${warnings.length ? `: ${warnings.join("; ")}` : ""}` }),
		};
	}

	private async awaitAvailableShell(pane: string, signal?: AbortSignal): Promise<void> {
		// A freshly split pane needs a moment before its shell reaches an interactive prompt.
		// Starting an agent early fails with agent_pane_busy, which cost a real lane on 2026-09-10.
		const deadline = Date.now() + 10_000;
		for (;;) {
			try {
				const raw = await this.herdr(["pane", "process-info", "--pane", pane], signal, 5_000, "inspect pane process");
				const info = findObject(raw, (value) => isObject(value) && ("shell_pid" in value || "shellPid" in value) ? value : undefined);
				const shell = numberValue(info?.shell_pid ?? info?.shellPid);
				const foreground = numberValue(info?.foreground_process_group_id ?? info?.foregroundProcessGroupId);
				if (shell && foreground === shell) return;
			} catch (error) { if (Date.now() >= deadline) throw error; }
			if (Date.now() >= deadline) return;
			await sleep(200);
		}
	}

	private async startAgent(pane: string, spec: LaneSpec, signal?: AbortSignal): Promise<unknown> {
		const { model, thinking } = splitModelSpec(spec.model);
		const args = ["agent", "start", spec.lane, "--kind", "pi", "--pane", pane, "--timeout", "30000", "--", "--name", spec.lane, "--model", model];
		if (spec.policy.tools?.length) args.push("--tools", spec.policy.tools.join(","));
		if (spec.policy.excludeTools.length) args.push("--exclude-tools", spec.policy.excludeTools.join(","));
		if (thinking) args.push("--thinking", thinking);
		for (let attempt = 1; ; attempt += 1) {
			try { return await this.herdr(args, signal, 31_000, "start Pi agent"); }
			catch (error) {
				if (attempt >= 5 || !/agent_pane_busy|agent_not_ready/.test(errorMessage(error))) throw error;
				await sleep(500 * attempt);
			}
		}
	}

	private async terminatePaneProcess(pane: string, signal?: AbortSignal): Promise<void> {
		const raw = await this.herdr(["pane", "process-info", "--pane", pane], signal, 5_000, "inspect pane process");
		const info = findObject(raw, (value) => isObject(value) && ("foreground_process_group_id" in value || "foregroundProcessGroupId" in value) ? value : undefined);
		const group = numberValue(info?.foreground_process_group_id ?? info?.foregroundProcessGroupId);
		const shell = numberValue(info?.shell_pid ?? info?.shellPid);
		if (!group || group === shell) return;
		try { process.kill(-group, "SIGTERM"); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
		await sleep(100);
		if (!processGroupAlive(group)) return;
		try { process.kill(-group, "SIGKILL"); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
	}

	private async listAgents(signal?: AbortSignal): Promise<AgentInfo[]> {
		const raw = await this.herdr(["agent", "list"], signal, 5_000, "list agents");
		return nestedArray(raw, "agents").map(toAgent).filter(isPresent);
	}

	private async listPanes(signal?: AbortSignal): Promise<Set<string>> {
		const raw = await this.herdr(["pane", "list"], signal, 5_000, "list panes");
		return new Set(nestedArray(raw, "panes").map((pane) => isObject(pane) ? text(pane.pane_id ?? pane.paneId) : undefined).filter(isPresent));
	}

	private async herdr(args: string[], signal: AbortSignal | undefined, timeout: number, action: string): Promise<unknown> {
		const blocked = await this.available();
		if (blocked) throw new Error(blocked);
		let result;
		try { result = await this.runner.exec("herdr", args, { ...(signal ? { signal } : {}), timeout }); }
		catch (error) {
			const raw = parsePossibleJson((error as { stdout?: unknown } | null)?.stdout);
			throw new Error(herdrFailure(action, raw, text((error as { stderr?: unknown } | null)?.stderr) ?? errorMessage(error)));
		}
		const raw = parsePossibleJson(result.stdout);
		if (result.code !== 0 || errorCode(raw)) throw new Error(herdrFailure(action, raw, result.stderr));
		if (!raw) throw new Error(`Herdr could not ${action}: response was not JSON`);
		return raw;
	}
}

export function toAgent(value: unknown): AgentInfo | undefined {
	if (!isObject(value)) return undefined;
	const pane = text(value.pane_id ?? value.paneId);
	if (!pane) return undefined;
	const sessionValue = isObject(value.agent_session) ? value.agent_session.value : isObject(value.session) ? value.session.value : value.session_path ?? value.sessionPath;
	const sessionFile = text(sessionValue);
	return {
		name: text(value.name),
		pane,
		status: laneStatus(value.agent_status ?? value.status ?? value.state),
		session: sessionFile ? sessionIdFromPath(sessionFile) : text(value.session_id ?? value.sessionId) ?? "",
		...(sessionFile ? { sessionFile } : {}),
	};
}

function laneStatus(value: unknown): LaneStatus {
	return typeof value === "string" && ["idle", "working", "blocked", "done"].includes(value) ? value as LaneStatus : "unknown";
}

export function sessionIdFromPath(path: string): string {
	const filename = basename(path).replace(/\.jsonl$/, "");
	return filename.slice(filename.lastIndexOf("_") + 1);
}

function returnErrorMessage(value: unknown): string | undefined {
	return isObject(value) ? text(value.message) : undefined;
}

function herdrFailure(action: string, raw: unknown, stderr: string): string {
	const code = errorCode(raw);
	const message = returnErrorMessage(isObject(raw) ? raw.error : undefined);
	const detail = code ? `${code}${message ? `: ${message}` : ""}` : stderr.trim().split("\n")[0];
	return `Herdr could not ${action}${detail ? `: ${detail}` : ""}`;
}

/**
 * Both calls run at once, and both are awaited even when the first fails. `Promise.all` would
 * return on the first rejection and leave the other herdr process in flight, landing on whatever
 * the caller does next.
 */
async function both<A, B>(first: Promise<A>, second: Promise<B>): Promise<[A, B]> {
	const [one, two] = await Promise.allSettled([first, second]);
	if (one!.status === "rejected") throw one!.reason;
	if (two!.status === "rejected") throw two!.reason;
	return [one!.value, two!.value];
}

function errorCode(raw: unknown): string | undefined { return isObject(raw) && isObject(raw.error) ? text(raw.error.code) : undefined; }
function parsePossibleJson(value: unknown): unknown { if (typeof value !== "string") return undefined; try { return JSON.parse(value); } catch { return undefined; } }
function nestedArray(value: unknown, key: string): unknown[] { const found = findObject(value, (candidate) => isObject(candidate) && Array.isArray(candidate[key]) ? candidate : undefined); return found && Array.isArray(found[key]) ? found[key] : []; }
function findString(value: unknown, keys: string[]): string { for (const key of keys) { const found = findObject(value, (candidate) => isObject(candidate) && text(candidate[key]) ? candidate : undefined); if (found) return text(found[key]) ?? ""; } return ""; }
function findObject<T>(value: unknown, convert: (value: unknown) => T | undefined): T | undefined { const direct = convert(value); if (direct) return direct; if (!isObject(value) && !Array.isArray(value)) return undefined; for (const child of Object.values(value)) { const found = findObject(child, convert); if (found) return found; } return undefined; }
function isTransitionTimeout(error: unknown): boolean { return /\btime(?:d\s*)?out\b/i.test(errorMessage(error)); }
