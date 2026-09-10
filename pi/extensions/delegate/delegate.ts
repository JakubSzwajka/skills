import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { DelegateInput, DelegateProfile, LaneRecord, LaneRegistry, LaneStatus, CommandRunner } from "./types.ts";
import { mutateRegistry, readRegistry, registryFiles } from "./registry.ts";

const CLOSED_RETENTION_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_WAIT_MS = 300_000;
const DEFAULT_PROFILES: Record<string, DelegateProfile> = {
	worker: { model: "openai-codex/gpt-5.6-sol:high", excludeTools: ["ask_user_question"] },
	scout: { model: "openai-codex/gpt-5.6-luna", readOnly: true, excludeTools: ["ask_user_question"] },
	reviewer: { model: "amazon-bedrock/global.anthropic.claude-opus-5", readOnly: true, excludeTools: ["ask_user_question"] },
	oracle: { model: "amazon-bedrock/global.anthropic.claude-opus-5", readOnly: true, excludeTools: ["ask_user_question"] },
};

interface AgentInfo {
	name?: string;
	pane: string;
	status: LaneStatus;
	session: string;
	sessionFile?: string;
}

interface ActionContext {
	parentId: string;
	cwd: string;
	signal?: AbortSignal;
	contextWindow?: (model: string) => number | null;
}

export class DelegateService {
	readonly root: string;
	readonly profilesPath: string;
	private readonly runner: CommandRunner;
	private readonly registries = new Set<string>();
	private readonly foreignRegistries = new Map<string, string>();

	constructor(runner: CommandRunner, home: string) {
		this.runner = runner;
		this.root = join(home, ".pi", "agent", "delegate");
		this.profilesPath = join(home, ".agents", "pi", "delegate", "profiles.json");
	}

	async execute(input: DelegateInput, context: ActionContext): Promise<Record<string, unknown>> {
		const profileState = await this.loadProfiles();
		let result: Record<string, unknown>;
		switch (input.action) {
			case "start": result = await this.start(input, context, profileState.profiles); break;
			case "list": result = { lanes: await this.list(context) }; break;
			case "read": result = await this.read(input.lane, context); break;
			case "wait": result = await this.wait(input.lanes, input.timeoutMs, context); break;
			case "stop": result = await this.stop(input.lane, context); break;
		}
		return profileState.warning ? { ...result, warning: profileState.warning } : result;
	}

	async adopt(context: ActionContext): Promise<void> {
		const own = this.registryPath(context.parentId);
		this.registries.add(own);
		this.foreignRegistries.clear();
		const agents = await this.listAgents(context.signal);
		for (const path of await registryFiles(this.root)) {
			if (path === own) continue;
			const foreignParent = basename(dirname(path));
			const registry = await readRegistry(path);
			const candidates = registry.lanes.filter((lane) => lane.cwd === context.cwd && !lane.closed);
			if (!candidates.length) continue;
			if (candidates.some((lane) => !lane.ownerPid || processAlive(lane.ownerPid))) {
				this.foreignRegistries.set(path, candidates[0]?.ownerSession ?? foreignParent);
				continue;
			}
			let claimed = false;
			await mutateRegistry(path, (current) => {
				const live = current.lanes.filter((lane) => lane.cwd === context.cwd && !lane.closed);
				if (!live.length || live.some((lane) => !lane.ownerPid || processAlive(lane.ownerPid))) return;
				for (const lane of live) {
					lane.ownerSession = context.parentId;
					lane.ownerPid = process.pid;
				}
				claimed = true;
			});
			if (claimed) this.registries.add(path);
			else this.foreignRegistries.set(path, foreignParent);
		}
		await this.refresh(context, agents);
	}

	async markRang(senderSessionId: string, context: ActionContext): Promise<string | undefined> {
		await this.ensureRegistries(context);
		for (const path of this.registries) {
			let matched: string | undefined;
			await mutateRegistry(path, (registry) => {
				const lane = registry.lanes.find((candidate) => !candidate.closed && candidate.session === senderSessionId);
				if (!lane) return;
				lane.rang = new Date().toISOString();
				matched = lane.lane;
			});
			if (matched) return matched;
		}
		return undefined;
	}

	async list(context: ActionContext): Promise<Array<Record<string, unknown>>> {
		await this.ensureRegistries(context);
		await this.refresh(context);
		const records = (await this.allRecords(true)).filter(({ lane, owned }) => owned || lane.cwd === context.cwd && !lane.closed);
		const lanes = await Promise.all(records.map(async ({ lane, owned, owner }) => {
			const present = await fileExists(lane.handoff);
			const stats = await sessionStats(lane.sessionFile, context.contextWindow?.(lane.model ?? "") ?? null);
			return {
				lane: lane.lane,
				profile: lane.profile,
				status: lane.closed ? "closed" : lane.status ?? "pending",
				contextPct: stats.contextPct,
				spendUsd: stats.spendUsd,
				rang: Boolean(lane.rang),
				handoffPresent: present,
				unread: present && !lane.read,
				pane: lane.pane || null,
				session: lane.session || null,
				handoff: lane.handoff,
				ownership: owned ? "owned" : "other-parent",
				owner,
			};
		}));
		return lanes.sort((left, right) => statusRank(String(left.status)) - statusRank(String(right.status)) || String(left.lane).localeCompare(String(right.lane)));
	}

	private async start(input: Extract<DelegateInput, { action: "start" }>, context: ActionContext, profiles: Record<string, DelegateProfile>): Promise<Record<string, unknown>> {
		const brief = input.brief?.trim();
		if (!brief) throw new Error("start requires a non-empty brief");
		const profileName = input.profile?.trim() || "worker";
		const profile = profiles[profileName];
		if (!profile) throw new Error(`Unknown delegate profile ${JSON.stringify(profileName)}`);
		const cwd = resolve(input.cwd || context.cwd);
		const agents = await this.listAgents(context.signal);
		const lane = input.name ? validateLaneName(input.name) : generatedLaneName(cwd, new Set(agents.map((agent) => agent.name).filter(isPresent)));
		if (agents.some((agent) => agent.name === lane)) throw new Error(`A live Herdr agent is already named ${JSON.stringify(lane)}`);
		const registryPath = this.registryPath(context.parentId);
		this.registries.add(registryPath);
		const handoff = input.handoff ? (isAbsolute(input.handoff) ? input.handoff : resolve(cwd, input.handoff)) : join(dirname(registryPath), `${lane}.md`);
		const chosenModel = input.model?.trim() || profile.model;
		const policy = toolPolicy(profile);
		const initial: LaneRecord = {
			lane,
			profile: profileName,
			pane: "",
			session: "",
			cwd,
			handoff,
			started: new Date().toISOString(),
			read: false,
			closed: false,
			model: chosenModel,
			status: "pending",
			ownerSession: context.parentId,
			ownerPid: process.pid,
		};
		await mutateRegistry(registryPath, (registry) => {
			if (registry.lanes.some((candidate) => !candidate.closed && candidate.lane === lane)) throw new Error(`Delegate lane ${JSON.stringify(lane)} already exists`);
			registry.lanes.push(initial);
		});

		let pane = "";
		let session = "";
		try {
			const split = await this.herdr([
				"pane", "split", "--current", "--direction", "right", "--ratio", "0.4", "--cwd", cwd,
				"--env", "PI_DELEGATE_ROLE=child", "--env", `PI_DELEGATE_PARENT=${context.parentId}`, "--no-focus",
			], context.signal, 10_000, "split pane");
			pane = findString(split, ["pane_id", "paneId"]);
			if (!pane) throw new Error("Herdr split a pane but returned no pane ID");
			await this.updateLane(registryPath, lane, (record) => { record.pane = pane; });
			await this.awaitAvailableShell(pane, context.signal);
			const started = await this.startAgent(pane, lane, chosenModel, policy, context.signal);
			const agent = toAgent(findObject(started, (value) => isObject(value) && (value.pane_id === pane || value.paneId === pane) ? value : undefined));
			if (!agent) throw new Error("Herdr did not confirm the started Pi agent");
			session = agent.session;
			await this.updateLane(registryPath, lane, (record) => {
				record.session = agent.session;
				record.sessionFile = agent.sessionFile;
				record.status = agent.status;
			});
			const contract = returnContract(brief, handoff, context.parentId);
			let transitionConfirmed = true;
			try {
				await this.herdr(["agent", "prompt", lane, contract, "--wait", "--until", "working", "--timeout", "10000"], context.signal, 11_000, "deliver brief");
			} catch (error) {
				if (!isTransitionTimeout(error)) throw error;
				transitionConfirmed = false;
			}
			await this.updateLane(registryPath, lane, (record) => {
				record.started = new Date().toISOString();
				if (transitionConfirmed) record.status = "working";
			});
			return { lane, pane, session: session || null, handoff, ...(transitionConfirmed ? {} : { transitionConfirmed: false }) };
		} catch (error) {
			const message = errorMessage(error);
			let registryError: string | undefined;
			try {
				await this.updateLane(registryPath, lane, (record) => {
					record.error = message;
					record.status = pane ? "unknown" : "closed";
					if (!pane) { record.closed = true; record.closedAt = new Date().toISOString(); }
				});
			} catch (updateError) { registryError = errorMessage(updateError); }
			const detail = registryError ? `${message}; registry update also failed: ${registryError}` : message;
			if (pane) return { lane, pane, session: session || null, handoff, transitionConfirmed: false, error: detail };
			throw new Error(`${detail}. Registry retained lane ${lane} before pane creation.`);
		}
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

	private async startAgent(pane: string, lane: string, modelSpec: string, policy: { tools?: string[]; excludeTools: string[] }, signal?: AbortSignal): Promise<unknown> {
		const { model, thinking } = splitModelSpec(modelSpec);
		const args = ["agent", "start", lane, "--kind", "pi", "--pane", pane, "--timeout", "30000", "--", "--name", lane, "--model", model];
		if (policy.tools?.length) args.push("--tools", policy.tools.join(","));
		if (policy.excludeTools.length) args.push("--exclude-tools", policy.excludeTools.join(","));
		if (thinking) args.push("--thinking", thinking);
		for (let attempt = 1; ; attempt += 1) {
			try { return await this.herdr(args, signal, 31_000, "start Pi agent"); }
			catch (error) {
				if (attempt >= 5 || !/agent_pane_busy|agent_not_ready/.test(errorMessage(error))) throw error;
				await sleep(500 * attempt);
			}
		}
	}

	private async read(laneName: string | undefined, context: ActionContext): Promise<Record<string, unknown>> {
		const found = await this.requireLane(laneName, context);
		await this.refresh(context);
		const current = (await readRegistry(found.path)).lanes.find((lane) => lane.lane === found.lane.lane) ?? found.lane;
		let body: string | null = null;
		try {
			const text = await readFile(current.handoff, "utf8");
			body = text.length > 50_000 ? `${text.slice(0, 50_000)}\n\n[handoff truncated at 50000 characters]` : text;
			await this.updateLane(found.path, current.lane, (record) => { record.read = true; });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		return { status: current.closed ? "closed" : current.status ?? "pending", handoffPresent: body !== null, handoff: current.handoff, body };
	}

	private async wait(laneNames: string[] | undefined, timeoutMs: number | undefined, context: ActionContext): Promise<Record<string, unknown>> {
		await this.ensureRegistries(context);
		const timeout = timeoutMs ?? DEFAULT_WAIT_MS;
		if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error("timeoutMs must be a positive integer");
		const all = (await this.allRecords()).filter(({ lane }) => !lane.closed && lane.pane);
		const names = laneNames?.length ? [...new Set(laneNames)] : all.map(({ lane }) => lane.lane);
		if (!names.length) throw new Error("No live delegate lanes to wait for");
		const selected = names.map((name) => {
			const matches = all.filter(({ lane }) => lane.lane === name);
			if (matches.length !== 1) throw new Error(matches.length ? `Delegate lane ${JSON.stringify(name)} is ambiguous` : `Unknown live delegate lane ${JSON.stringify(name)}`);
			return matches[0];
		});
		const controllers = selected.map(() => new AbortController());
		const abortFromParent = () => controllers.forEach((controller) => controller.abort());
		context.signal?.addEventListener("abort", abortFromParent, { once: true });
		try {
			const settled = await Promise.race(selected.map(({ lane }, index) => this.waitOne(lane, timeout, controllers[index]!.signal)));
			controllers.forEach((controller) => controller.abort());
			if (settled.timedOut) return { timedOut: true, lanes: names };
			const matched = selected.find(({ lane }) => lane.pane === settled.agent.pane || lane.lane === settled.agent.name);
			if (matched) await this.updateLane(matched.path, matched.lane.lane, (record) => { record.status = settled.agent.status; });
			return {
				timedOut: false,
				lane: matched?.lane.lane ?? settled.agent.name ?? null,
				status: settled.agent.status,
				handoffPresent: matched ? await fileExists(matched.lane.handoff) : false,
			};
		} finally {
			context.signal?.removeEventListener("abort", abortFromParent);
			controllers.forEach((controller) => controller.abort());
		}
	}

	private async waitOne(lane: LaneRecord, timeoutMs: number, signal: AbortSignal): Promise<{ timedOut: true } | { timedOut: false; agent: AgentInfo }> {
		let result;
		try {
			result = await this.runner.exec("herdr", waitArguments(lane.lane, timeoutMs), { signal, timeout: timeoutMs + 1_000 });
		} catch (error) {
			const raw = parsePossibleJson((error as { stdout?: unknown } | null)?.stdout);
			if (errorCode(raw) === "timeout") return { timedOut: true };
			throw error;
		}
		const raw = parsePossibleJson(result.stdout);
		if (errorCode(raw) === "timeout") return { timedOut: true };
		if (result.code !== 0) throw new Error(herdrFailure("wait for agent", raw, result.stderr));
		const agent = toAgent(findObject(raw, (value) => isObject(value) && typeof (value.agent_status ?? value.status) === "string" ? value : undefined));
		if (!agent) throw new Error("Herdr wait returned no agent state");
		return { timedOut: false, agent };
	}

	private async stop(laneName: string | undefined, context: ActionContext): Promise<Record<string, unknown>> {
		const found = await this.requireLane(laneName, context);
		const lane = found.lane;
		if (!lane.pane) {
			await this.closeRecord(found.path, lane.lane);
			return { lane: lane.lane, gone: true, alreadyGone: true };
		}
		const [agents, panes] = await Promise.all([this.listAgents(context.signal), this.listPanes(context.signal)]);
		const present = agents.some((agent) => agent.pane === lane.pane) || panes.has(lane.pane);
		if (!present) {
			await this.closeRecord(found.path, lane.lane);
			return { lane: lane.lane, pane: lane.pane, gone: true, alreadyGone: true };
		}
		const failures: string[] = [];
		try { await this.terminatePaneProcess(lane.pane, context.signal); }
		catch (error) { failures.push(errorMessage(error)); }
		try { await this.herdr(["pane", "close", lane.pane], context.signal, 5_000, "close pane"); }
		catch (error) { failures.push(errorMessage(error)); }
		const [afterAgents, afterPanes] = await Promise.all([this.listAgents(context.signal), this.listPanes(context.signal)]);
		const gone = !afterAgents.some((agent) => agent.pane === lane.pane) && !afterPanes.has(lane.pane);
		if (!gone) throw new Error(`stop left pane ${lane.pane} behind${failures.length ? `: ${failures.join("; ")}` : ""}`);
		await this.closeRecord(found.path, lane.lane);
		return { lane: lane.lane, pane: lane.pane, gone: true, alreadyGone: false, ...(failures.length ? { warnings: failures } : {}) };
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

	private async refresh(context: ActionContext, knownAgents?: AgentInfo[]): Promise<void> {
		await this.ensureRegistries(context);
		const [agents, panes] = await Promise.all([knownAgents ? Promise.resolve(knownAgents) : this.listAgents(context.signal), this.listPanes(context.signal)]);
		const byPane = new Map(agents.map((agent) => [agent.pane, agent]));
		const now = Date.now();
		for (const path of this.registries) {
			await mutateRegistry(path, (registry) => {
				registry.lanes = registry.lanes.filter((lane) => !lane.closedAt || now - Date.parse(lane.closedAt) <= CLOSED_RETENTION_MS);
				for (const lane of registry.lanes) {
					if (lane.closed) continue;
					const agent = lane.pane ? byPane.get(lane.pane) : undefined;
					if (agent) {
						lane.status = agent.status;
						lane.session ||= agent.session;
						lane.sessionFile ||= agent.sessionFile;
					} else if (lane.pane && panes.has(lane.pane)) lane.status = "unknown";
					else if (lane.pane || now - Date.parse(lane.started) > CLOSED_RETENTION_MS) {
						lane.closed = true;
						lane.status = "closed";
						lane.closedAt = new Date(now).toISOString();
					}
				}
			});
		}
	}

	private async ensureRegistries(context: ActionContext): Promise<void> {
		if (!this.registries.size) await this.adopt(context);
		else this.registries.add(this.registryPath(context.parentId));
	}

	private async allRecords(includeForeign = false): Promise<Array<{ path: string; lane: LaneRecord; owned: boolean; owner: string }>> {
		const all: Array<{ path: string; lane: LaneRecord; owned: boolean; owner: string }> = [];
		for (const path of this.registries) {
			for (const lane of (await readRegistry(path)).lanes) all.push({ path, lane, owned: true, owner: lane.ownerSession ?? basename(dirname(path)) });
		}
		if (includeForeign) {
			for (const [path, fallbackOwner] of this.foreignRegistries) {
				for (const lane of (await readRegistry(path)).lanes) all.push({ path, lane, owned: false, owner: lane.ownerSession ?? fallbackOwner });
			}
		}
		return all;
	}

	private async requireLane(name: string | undefined, context: ActionContext): Promise<{ path: string; lane: LaneRecord }> {
		if (!name?.trim()) throw new Error("A lane name is required");
		await this.ensureRegistries(context);
		const matches = (await this.allRecords()).filter(({ lane }) => lane.lane === name);
		if (matches.length !== 1) throw new Error(matches.length ? `Delegate lane ${JSON.stringify(name)} is ambiguous` : `Unknown delegate lane ${JSON.stringify(name)}`);
		return matches[0]!;
	}

	private async closeRecord(path: string, lane: string): Promise<void> {
		await this.updateLane(path, lane, (record) => { record.closed = true; record.status = "closed"; record.closedAt = new Date().toISOString(); });
	}

	private async updateLane(path: string, lane: string, update: (record: LaneRecord) => void): Promise<void> {
		await mutateRegistry(path, (registry) => {
			const record = registry.lanes.find((candidate) => candidate.lane === lane);
			if (!record) throw new Error(`Delegate registry lost lane ${JSON.stringify(lane)}`);
			update(record);
		});
	}

	private registryPath(parentId: string): string { return join(this.root, parentId, "lanes.json"); }

	private async listAgents(signal?: AbortSignal): Promise<AgentInfo[]> {
		const raw = await this.herdr(["agent", "list"], signal, 5_000, "list agents");
		const values = nestedArray(raw, "agents");
		return values.map(toAgent).filter(isPresent);
	}

	private async listPanes(signal?: AbortSignal): Promise<Set<string>> {
		const raw = await this.herdr(["pane", "list"], signal, 5_000, "list panes");
		return new Set(nestedArray(raw, "panes").map((pane) => isObject(pane) ? text(pane.pane_id ?? pane.paneId) : undefined).filter(isPresent));
	}

	private async herdr(args: string[], signal: AbortSignal | undefined, timeout: number, action: string): Promise<unknown> {
		let result;
		try { result = await this.runner.exec("herdr", args, { signal, timeout }); }
		catch (error) {
			const raw = parsePossibleJson((error as { stdout?: unknown } | null)?.stdout);
			throw new Error(herdrFailure(action, raw, text((error as { stderr?: unknown } | null)?.stderr) ?? errorMessage(error)));
		}
		const raw = parsePossibleJson(result.stdout);
		if (result.code !== 0 || errorCode(raw)) throw new Error(herdrFailure(action, raw, result.stderr));
		if (!raw) throw new Error(`Herdr could not ${action}: response was not JSON`);
		return raw;
	}

	private async loadProfiles(): Promise<{ profiles: Record<string, DelegateProfile>; warning?: string }> {
		let raw: string;
		try { raw = await readFile(this.profilesPath, "utf8"); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { profiles: DEFAULT_PROFILES, warning: `${this.profilesPath} is missing; using built-in delegate profiles.` };
			return { profiles: DEFAULT_PROFILES, warning: `Could not read ${this.profilesPath}; using built-in delegate profiles.` };
		}
		try {
			const parsed: unknown = JSON.parse(raw);
			if (!isObject(parsed) || !Object.keys(parsed).length) throw new Error("profile map is empty");
			const profiles: Record<string, DelegateProfile> = {};
			for (const [name, value] of Object.entries(parsed)) {
				if (!isProfile(value)) throw new Error(`invalid profile ${name}`);
				profiles[name] = value;
			}
			return { profiles };
		} catch (error) {
			return { profiles: DEFAULT_PROFILES, warning: `${this.profilesPath} is malformed (${errorMessage(error)}); using built-in delegate profiles.` };
		}
	}
}

export function returnContract(brief: string, handoff: string, parent: string): string {
	return `${brief.trim()}\n\nYou are a worker. Implement the work yourself. Do not delegate.\nIf you need a decision before you can continue, use the intercom tool to ask\nsession ${parent} and wait for the reply. Never try to open a question dialog;\nnobody may be watching your pane, and a pane waiting on a dialog looks identical\nto a pane doing work. Say what you need in one line, offer the options you see,\nand name your own recommendation. If you are still stuck after the reply, write\nthe handoff describing the block rather than waiting again.\nWrite your handoff to ${handoff}. That file is your result; a terminal\nnobody reads is not.\nWhen the handoff is written, use the intercom tool to message session ${parent}\nwith the handoff path and a one-line outcome. Do this even if you failed or only\npartly finished.`;
}

export function toolPolicy(profile: DelegateProfile): { tools?: string[]; excludeTools: string[] } {
	const excluded = new Set(profile.excludeTools ?? []);
	if (profile.readOnly) excluded.add("edit");
	return { ...(profile.tools ? { tools: [...profile.tools] } : {}), excludeTools: [...excluded] };
}

export function intercomRings(entries: readonly unknown[]): Array<{ sender: string; messageId: string }> {
	const rings: Array<{ sender: string; messageId: string }> = [];
	for (const entry of entries) {
		if (!isObject(entry)) continue;
		const holder = entry.type === "custom_message" ? entry
			: isObject(entry.message) && entry.message.role === "custom" ? entry.message
			: undefined;
		if (!holder || holder.customType !== "intercom_message") continue;
		const details = isObject(holder.details) ? holder.details : undefined;
		const sender = isObject(details?.from) ? text(details.from.id) : undefined;
		if (!sender) continue;
		const messageId = (isObject(details?.message) ? text(details.message.id) : undefined) ?? `${text(entry.timestamp) ?? ""}:${sender}`;
		rings.push({ sender, messageId });
	}
	return rings;
}

export function waitArguments(lane: string, timeoutMs: number): string[] {
	return ["agent", "wait", lane, "--until", "idle", "--until", "done", "--until", "blocked", "--timeout", String(timeoutMs)];
}

function validateLaneName(name: string): string {
	const trimmed = name.trim();
	if (!/^[a-z][a-z0-9_-]{0,31}$/.test(trimmed)) throw new Error("Lane names must match [a-z][a-z0-9_-]{0,31}");
	return trimmed;
}

function generatedLaneName(cwd: string, live: Set<string>): string {
	const stem = basename(cwd).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 10) || "work";
	for (;;) {
		const suffix = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
		const lane = validateLaneName(`lane-${stem}-${suffix}`.slice(0, 32).replace(/-+$/, ""));
		if (!live.has(lane)) return lane;
	}
}

function splitModelSpec(spec: string): { model: string; thinking?: string } {
	const match = spec.match(/^(.*):(off|minimal|low|medium|high|xhigh|max)$/);
	return match ? { model: match[1]!, thinking: match[2] } : { model: spec };
}

function toAgent(value: unknown): AgentInfo | undefined {
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

function sessionIdFromPath(path: string): string {
	const filename = basename(path).replace(/\.jsonl$/, "");
	return filename.slice(filename.lastIndexOf("_") + 1);
}

async function sessionStats(path: string | undefined, configuredWindow: number | null): Promise<{ contextPct: number | null; spendUsd: number | null }> {
	if (!path) return { contextPct: null, spendUsd: null };
	let source: string;
	try { source = await readFile(path, "utf8"); }
	catch { return { contextPct: null, spendUsd: null }; }
	let tokens: number | null = null;
	let window = configuredWindow;
	let spend = 0;
	let sawCost = false;
	for (const line of source.split("\n")) {
		if (!line) continue;
		const parsed = parsePossibleJson(line);
		if (!isObject(parsed) || !isObject(parsed.message) || parsed.message.role !== "assistant") continue;
		const usage = isObject(parsed.message.usage) ? parsed.message.usage : undefined;
		const total = numberValue(usage?.totalTokens);
		if (total !== undefined) tokens = total;
		const cost = isObject(usage?.cost) ? numberValue(usage.cost.total) : undefined;
		if (cost !== undefined) { spend += cost; sawCost = true; }
		window ??= numberValue(parsed.message.contextWindow) ?? null;
	}
	return { contextPct: tokens !== null && window ? Math.round(tokens / window * 1_000) / 10 : null, spendUsd: sawCost ? Math.round(spend * 1000) / 1000 : null };
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

function errorCode(raw: unknown): string | undefined { return isObject(raw) && isObject(raw.error) ? text(raw.error.code) : undefined; }
function parsePossibleJson(value: unknown): unknown { if (typeof value !== "string") return undefined; try { return JSON.parse(value); } catch { return undefined; } }
function nestedArray(value: unknown, key: string): unknown[] { const found = findObject(value, (candidate) => isObject(candidate) && Array.isArray(candidate[key]) ? candidate : undefined); return found && Array.isArray(found[key]) ? found[key] : []; }
function findString(value: unknown, keys: string[]): string { for (const key of keys) { const found = findObject(value, (candidate) => isObject(candidate) && text(candidate[key]) ? candidate : undefined); if (found) return text(found[key]) ?? ""; } return ""; }
function findObject<T>(value: unknown, convert: (value: unknown) => T | undefined): T | undefined { const direct = convert(value); if (direct) return direct; if (!isObject(value) && !Array.isArray(value)) return undefined; for (const child of Object.values(value)) { const found = findObject(child, convert); if (found) return found; } return undefined; }
function isProfile(value: unknown): value is DelegateProfile { return isObject(value) && Boolean(text(value.model)) && (value.readOnly === undefined || typeof value.readOnly === "boolean") && stringArrayOrUndefined(value.tools) && stringArrayOrUndefined(value.excludeTools); }
function stringArrayOrUndefined(value: unknown): boolean { return value === undefined || Array.isArray(value) && value.every((item) => Boolean(text(item))); }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): string | undefined { return typeof value === "string" && value.length ? value : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function isPresent<T>(value: T | undefined): value is T { return value !== undefined; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function isTransitionTimeout(error: unknown): boolean { return /\btime(?:d\s*)?out\b/i.test(errorMessage(error)); }
function fileExists(path: string): Promise<boolean> { return access(path, constants.F_OK).then(() => true, () => false); }
function processAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; } }
function processGroupAlive(group: number): boolean { try { process.kill(-group, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; } }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function statusRank(status: string): number { return status === "blocked" ? 0 : status === "working" ? 1 : status === "done" || status === "idle" ? 2 : status === "unknown" || status === "pending" ? 3 : 4; }
