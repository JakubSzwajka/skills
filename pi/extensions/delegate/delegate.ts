import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type {
	CommandRunner, DelegateInput, DelegateProfile, LaneObservation, LaneRecord, LaneRunner, Transport,
} from "./types.ts";
import { DEFAULT_TRANSPORT, TRANSPORTS, statusRank } from "./types.ts";
import { mutateRegistry, readRegistry, registryFiles } from "./registry.ts";
import { HerdrLaneRunner } from "./runners/herdr.ts";
import { SubprocessLaneRunner } from "./runners/subprocess.ts";
import { errorMessage, isObject, numberValue, processAlive, text } from "./runners/support.ts";

const CLOSED_RETENTION_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_PROFILES: Record<string, DelegateProfile> = {
	worker: { model: "openai-codex/gpt-5.6-sol:high", excludeTools: ["ask_user_question"] },
	scout: { model: "openai-codex/gpt-5.6-luna", readOnly: true, excludeTools: ["ask_user_question"] },
	reviewer: { model: "anthropic/claude-opus-5", readOnly: true, excludeTools: ["ask_user_question"] },
	oracle: { model: "anthropic/claude-opus-5", readOnly: true, excludeTools: ["ask_user_question"] },
};

interface ActionContext {
	parentId: string;
	cwd: string;
	signal?: AbortSignal;
	contextWindow?: (model: string) => number | null;
}

export class DelegateService {
	readonly root: string;
	readonly profilesPath: string;
	private readonly runners: Map<Transport, LaneRunner>;
	private readonly registries = new Set<string>();
	private readonly foreignRegistries = new Map<string, string>();
	/** Transports that could not be asked during the last refresh, so their lanes show stale status. */
	private probeFailures = new Map<Transport, string>();

	constructor(runner: CommandRunner, home: string, runners?: readonly LaneRunner[]) {
		const configured = runners ?? [new HerdrLaneRunner(runner), new SubprocessLaneRunner()];
		this.runners = new Map(configured.map((candidate) => [candidate.transport, candidate]));
		this.root = join(home, ".pi", "agent", "delegate");
		this.profilesPath = join(home, ".agents", "pi", "delegate", "profiles.json");
	}

	async execute(input: DelegateInput, context: ActionContext): Promise<Record<string, unknown>> {
		const profileState = await this.loadProfiles();
		let result: Record<string, unknown>;
		switch (input.action) {
			case "start": result = await this.start(input, context, profileState.profiles); break;
			case "list": {
				const lanes = await this.list(context);
				const stale = [...this.probeFailures].map(([transport, message]) => `${transport}: ${message}`);
				result = stale.length ? { lanes, staleTransports: stale } : { lanes };
				break;
			}
			case "read": result = await this.read(input.lane, context); break;
			case "stop": result = await this.stop(input.lane, context); break;
		}
		return profileState.warning ? { ...result, warning: profileState.warning } : result;
	}

	async adopt(context: ActionContext): Promise<void> {
		const own = this.registryPath(context.parentId);
		this.registries.add(own);
		this.foreignRegistries.clear();
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
		await this.refresh(context);
	}

	/**
	 * Write current lane statuses back to the registry and return nothing. The widget's timer
	 * wants exactly this: `list` additionally re-reads every handoff and every transcript, which
	 * is wasted work several times a minute.
	 */
	async refreshStatus(context: ActionContext): Promise<void> {
		await this.refresh(context);
	}

	async markRang(senderSessionId: string, context: ActionContext, options?: { expectsReply?: boolean }): Promise<string | undefined> {
		await this.ensureRegistries(context);
		for (const path of this.registries) {
			let matched: string | undefined;
			await mutateRegistry(path, (registry) => {
				const lane = registry.lanes.find((candidate) => !candidate.closed && candidate.session === senderSessionId);
				if (!lane) return;
				lane.rang = new Date().toISOString();
				// A pane reports its own blocked state. A headless lane cannot, so the one blocking
				// event the parent can actually see — an intercom ask — is the only one it gets.
				if (options?.expectsReply && transportOf(lane) === "subprocess") {
					lane.status = "blocked";
					lane.blockedAt = new Date().toISOString();
				}
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
				transport: transportOf(lane),
				contextPct: stats.contextPct,
				spendUsd: stats.spendUsd,
				rang: Boolean(lane.rang),
				handoffPresent: present,
				unread: present && !lane.read,
				pane: lane.pane || null,
				pid: lane.pid ?? null,
				logFile: lane.logFile ?? null,
				session: lane.session || null,
				sessionFile: lane.sessionFile ?? null,
				model: lane.model ?? null,
				handoff: lane.handoff,
				ownership: owned ? "owned" : "other-parent",
				owner,
			};
		}));
		return lanes.sort((left, right) => statusRank(String(left.status)) - statusRank(String(right.status)) || String(left.lane).localeCompare(String(right.lane)));
	}

	private async start(input: Extract<DelegateInput, { action: "start" }>, context: ActionContext, profiles: Record<string, DelegateProfile>): Promise<Record<string, unknown>> {
		// The transport decides whether the operator can watch a lane, so it is theirs alone: it comes
		// from the profile they maintain. A caller that names one is refused rather than quietly obeyed,
		// so a model that learned the old parameter finds out instead of guessing it worked.
		if ((input as { transport?: unknown }).transport !== undefined) {
			throw new Error("transport is not a per-call choice: a lane's transport comes from its profile, which the operator maintains in profiles.json. Pick a profile, or ask the operator to change one. model is still yours to choose.");
		}
		const brief = input.brief?.trim();
		if (!brief) throw new Error("start requires a non-empty brief");
		const profileName = input.profile?.trim() || "worker";
		const profile = profiles[profileName];
		if (!profile) throw new Error(`Unknown delegate profile ${JSON.stringify(profileName)}`);
		const transport = resolveTransport(profile.transport);
		const runner = this.runnerFor(transport);
		const cwd = resolve(input.cwd || context.cwd);
		const taken = await runner.liveNames(context.signal);
		const lane = input.name ? validateLaneName(input.name) : generatedLaneName(cwd, taken);
		if (taken.has(lane)) throw new Error(`A live ${transport} lane is already named ${JSON.stringify(lane)}`);
		const registryPath = this.registryPath(context.parentId);
		this.registries.add(registryPath);
		const handoff = input.handoff ? (isAbsolute(input.handoff) ? input.handoff : resolve(cwd, input.handoff)) : join(dirname(registryPath), `${lane}.md`);
		const chosenModel = input.model?.trim() || profile.model;
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
			transport,
			ownerSession: context.parentId,
			ownerPid: process.pid,
		};
		await mutateRegistry(registryPath, (registry) => {
			if (registry.lanes.some((candidate) => !candidate.closed && candidate.lane === lane)) throw new Error(`Delegate lane ${JSON.stringify(lane)} already exists`);
			registry.lanes.push(initial);
		});

		const spec = {
			lane, cwd, parentId: context.parentId, model: chosenModel, policy: toolPolicy(profile),
			prompt: returnContract(brief, handoff, context.parentId), handoff,
			stateDir: join(dirname(registryPath), "lanes", lane),
		};
		try {
			const handle = await runner.spawn(spec, (patch) => this.updateLane(registryPath, lane, (record) => Object.assign(record, patch)), context.signal);
			await this.updateLane(registryPath, lane, (record) => {
				record.started = new Date().toISOString();
				if (handle.pane) record.pane = handle.pane;
				if (handle.session) record.session = handle.session;
				if (handle.sessionFile) record.sessionFile = handle.sessionFile;
				if (handle.pid) record.pid = handle.pid;
				if (handle.pidStart) record.pidStart = handle.pidStart;
				if (handle.logFile) record.logFile = handle.logFile;
				record.status = handle.status ?? record.status ?? "pending";
			});
			return {
				lane, transport, handoff,
				...(handle.pane ? { pane: handle.pane } : {}),
				...(handle.pid ? { pid: handle.pid } : {}),
				...(handle.logFile ? { logFile: handle.logFile } : {}),
				session: handle.session || null,
				...(handle.transitionConfirmed === false ? { transitionConfirmed: false } : {}),
			};
		} catch (error) {
			const message = errorMessage(error);
			let registryError: string | undefined;
			let attached: LaneRecord | undefined;
			try {
				await this.updateLane(registryPath, lane, (record) => {
					record.error = message;
					attached = record;
					const live = Boolean(record.pane || record.pid);
					record.status = live ? "unknown" : "closed";
					if (!live) { record.closed = true; record.closedAt = new Date().toISOString(); }
				});
			} catch (updateError) { registryError = errorMessage(updateError); }
			const detail = registryError ? `${message}; registry update also failed: ${registryError}` : message;
			if (attached?.pane || attached?.pid) {
				return {
					lane, transport, handoff, transitionConfirmed: false, error: detail,
					...(attached.pane ? { pane: attached.pane } : {}),
					...(attached.pid ? { pid: attached.pid } : {}),
					session: attached.session || null,
				};
			}
			throw new Error(`${detail}. Registry retained lane ${lane} before the worker existed.`);
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

	private async stop(laneName: string | undefined, context: ActionContext): Promise<Record<string, unknown>> {
		const found = await this.requireLane(laneName, context);
		const lane = found.lane;
		const identity = { lane: lane.lane, ...(lane.pane ? { pane: lane.pane } : {}), ...(lane.pid ? { pid: lane.pid } : {}) };
		if (!spawned(lane)) {
			await this.closeRecord(found.path, lane.lane);
			return { ...identity, gone: true, alreadyGone: true };
		}
		const outcome = await this.runnerFor(transportOf(lane)).kill(lane, context.signal);
		if (!outcome.gone) throw new Error(outcome.detail ?? `stop left lane ${lane.lane} behind`);
		await this.closeRecord(found.path, lane.lane);
		return { ...identity, gone: true, alreadyGone: outcome.alreadyGone, ...(outcome.warnings.length ? { warnings: outcome.warnings } : {}) };
	}

	private async refresh(context: ActionContext): Promise<void> {
		await this.ensureRegistries(context);
		const live = (await this.allRecords()).map(({ lane }) => lane).filter((lane) => !lane.closed);
		this.probeFailures = new Map();
		const observations = await this.probe(live, context.signal);
		const now = Date.now();
		for (const path of this.registries) {
			await mutateRegistry(path, (registry) => {
				registry.lanes = registry.lanes.filter((lane) => !lane.closedAt || now - Date.parse(lane.closedAt) <= CLOSED_RETENTION_MS);
				for (const lane of registry.lanes) {
					if (lane.closed) continue;
					const observation = observations.get(lane.lane);
					if (observation?.kind === "status") {
						lane.status = observation.status;
						if (!lane.session && observation.session) lane.session = observation.session;
						lane.sessionFile ||= observation.sessionFile;
						if (lane.status !== "blocked") delete lane.blockedAt;
					// A transport nobody could reach says nothing about its lanes, so neither its silence nor
					// the lane's age is allowed to close one.
					} else if (!this.probeFailures.has(transportOf(lane)) && (observation?.kind === "gone" || now - Date.parse(lane.started) > CLOSED_RETENTION_MS)) {
						lane.closed = true;
						lane.status = "closed";
						lane.closedAt = new Date(now).toISOString();
					}
				}
			});
		}
	}

	/** One probe per transport, each seeing every one of its own lanes at once. */
	private async probe(lanes: readonly LaneRecord[], signal?: AbortSignal): Promise<Map<string, LaneObservation>> {
		const grouped = new Map<Transport, LaneRecord[]>();
		for (const lane of lanes) {
			const transport = transportOf(lane);
			if (!this.runners.has(transport)) continue;
			const group = grouped.get(transport) ?? [];
			group.push(lane);
			grouped.set(transport, group);
		}
		const merged = new Map<string, LaneObservation>();
		for (const [transport, group] of grouped) {
			// One transport that cannot be reached costs its own lanes their fresh status and nothing
			// else. A session outside Herdr has to be able to list, read and stop its headless lanes
			// even while a pane lane it cannot see sits in the same registry.
			try {
				for (const [lane, observation] of await this.runners.get(transport)!.probe(group, signal)) merged.set(lane, observation);
			} catch (error) {
				this.probeFailures.set(transport, errorMessage(error));
			}
		}
		return merged;
	}

	private runnerFor(transport: Transport): LaneRunner {
		const runner = this.runners.get(transport);
		if (!runner) throw new Error(`No delegate runner is configured for transport ${JSON.stringify(transport)}`);
		return runner;
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

export { statusRank } from "./types.ts";

export function returnContract(brief: string, handoff: string, parent: string): string {
	return `${brief.trim()}\n\nYou are a worker. Implement the work yourself. Do not delegate.\nIf you need a decision before you can continue, use the intercom tool to ask\nsession ${parent} and wait for the reply. Never try to open a question dialog;\nnobody may be watching your pane, and a pane waiting on a dialog looks identical\nto a pane doing work. Say what you need in one line, offer the options you see,\nand name your own recommendation. If you are still stuck after the reply, write\nthe handoff describing the block rather than waiting again.\nWrite your handoff to ${handoff}. That file is your result; a terminal\nnobody reads is not.\nThe handoff carries evidence, not a claim that you finished. Give the exact\npaths you changed, the commands you ran to verify with their exit codes and\nthe output that decided it, and what you could not verify, so the parent\nknows exactly what is left. Say whether anything you started is still\nrunning or still open when you stop. A parent who cannot see proof reopens\nyour files and redoes your work, which is what the proof is for.\nWhen the handoff is written, use the intercom tool to message session ${parent}\nwith the handoff path and a one-line outcome. Do this even if you failed or only\npartly finished.`;
}

export function toolPolicy(profile: DelegateProfile): { tools?: string[]; excludeTools: string[] } {
	const excluded = new Set(profile.excludeTools ?? []);
	if (profile.readOnly) excluded.add("edit");
	return { ...(profile.tools ? { tools: [...profile.tools] } : {}), excludeTools: [...excluded] };
}

export function intercomRings(entries: readonly unknown[]): Array<{ sender: string; messageId: string; expectsReply: boolean }> {
	const rings: Array<{ sender: string; messageId: string; expectsReply: boolean }> = [];
	for (const entry of entries) {
		if (!isObject(entry)) continue;
		const holder = entry.type === "custom_message" ? entry
			: isObject(entry.message) && entry.message.role === "custom" ? entry.message
			: undefined;
		if (!holder || holder.customType !== "intercom_message") continue;
		const details = isObject(holder.details) ? holder.details : undefined;
		const sender = isObject(details?.from) ? text(details.from.id) : undefined;
		if (!sender) continue;
		const message = isObject(details?.message) ? details.message : undefined;
		const messageId = text(message?.id) ?? `${text(entry.timestamp) ?? ""}:${sender}`;
		rings.push({ sender, messageId, expectsReply: message?.expectsReply === true });
	}
	return rings;
}

export function resolveTransport(value: unknown): Transport {
	if (value === undefined || value === null || value === "") return DEFAULT_TRANSPORT;
	if (typeof value === "string" && (TRANSPORTS as readonly string[]).includes(value)) return value as Transport;
	throw new Error(`Unknown delegate transport ${JSON.stringify(value)}; expected ${TRANSPORTS.join(" or ")}`);
}

function transportOf(lane: LaneRecord): Transport {
	return lane.transport ?? DEFAULT_TRANSPORT;
}

/** A lane has a home once its runner created something: a pane, or a process. */
function spawned(lane: LaneRecord): boolean {
	return Boolean(lane.pane || lane.pid);
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
		let parsed: unknown;
		try { parsed = JSON.parse(line); } catch { continue; }
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

function isProfile(value: unknown): value is DelegateProfile {
	return isObject(value)
		&& Boolean(text(value.model))
		&& (value.readOnly === undefined || typeof value.readOnly === "boolean")
		&& (value.transport === undefined || (typeof value.transport === "string" && (TRANSPORTS as readonly string[]).includes(value.transport)))
		&& stringArrayOrUndefined(value.tools)
		&& stringArrayOrUndefined(value.excludeTools);
}

function stringArrayOrUndefined(value: unknown): boolean { return value === undefined || Array.isArray(value) && value.every((item) => Boolean(text(item))); }
function fileExists(path: string): Promise<boolean> { return access(path, constants.F_OK).then(() => true, () => false); }
