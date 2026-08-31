import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, loadConfig, type ConnectorConfig, type ConfigResult } from "./config.ts";
import { createPiHost, registerPiTools } from "./host/pi.ts";
import { createInboundBroker } from "./inbound/broker.ts";
import { createHandler } from "./net/handler.ts";
import { ensureRegistered, runBlocksRegister } from "./net/register.ts";
import { createHumanBridge } from "./operator/bridge.ts";
import { startWithConfiguredApiKey } from "./sdk-start.ts";

interface AgentInstanceHandleLike {
	stop(): void;
	instanceId: string;
}

export default function (pi: ExtensionAPI) {
	let handle: AgentInstanceHandleLike | undefined;
	let config: ConnectorConfig | undefined;
	let starting = false;
	const broker = createInboundBroker(createPiHost(pi));
	const human = createHumanBridge(pi, broker);

	registerPiTools(pi, {
		broker,
		getConfiguredName: () => config?.card.identity.agentName,
		getOnlineInfo: () => handle && config
			? { agentName: config.card.identity.agentName, instanceId: handle.instanceId }
			: undefined,
	});

	function refreshConfig(ctx: ExtensionContext): ConfigResult {
		if (!ctx.isProjectTrusted()) {
			config = undefined;
			return { ok: false, reason: "The current directory is not trusted, so its Blocks configuration was not read." };
		}
		const loaded = loadConfig(ctx.cwd);
		config = loaded.ok ? loaded.config : undefined;
		return loaded;
	}

	async function connect(ctx: ExtensionContext): Promise<void> {
		if (handle) {
			ctx.ui.notify(`blocks: already online as ${config?.card.identity.agentName}`, "info");
			return;
		}
		if (starting) {
			ctx.ui.notify("blocks: already connecting…", "info");
			return;
		}
		const loaded = refreshConfig(ctx);
		if (!loaded.ok) {
			ctx.ui.notify(`blocks: cannot go online — ${loaded.reason}`, "warning");
			return;
		}
		starting = true;
		human.setStatusLine(undefined);
		try {
			const { startAgentInstance, getAgent, fetchCdmConfig } = await import("@blocks-network/sdk");
			const { card } = loaded.config;
			const cdm = await fetchCdmConfig(loaded.config.cdmUrl);
			const outcome = await ensureRegistered(card.identity.agentName, loaded.config.cardPath, loaded.config.apiKey, {
				getAgent: (name, options) => getAgent(name, { ...options, baseUrl: cdm.api.baseUrl }) as never,
				runRegister: runBlocksRegister,
			});
			if (outcome.action === "failed") {
				human.setStatusLine(undefined);
				human.notify(`registration failed: ${outcome.detail}`, "error");
				return;
			}
			if (outcome.action === "registered") human.notify(`registered ${card.identity.agentName} (private, free)`);

			const started = await startWithConfiguredApiKey(loaded.config.apiKey, () =>
				startAgentInstance({
					card: card as never,
					agentName: card.identity.agentName,
					description: card.identity.description,
					cdmUrl: loaded.config.cdmUrl,
					concurrency: loaded.config.maxConcurrent,
					expectedInstances: card.runtime?.expectedInstances ?? 1,
					maxPendingBacklog: card.runtime?.maxPendingBacklog,
					maxRunningTimeSec: card.runtime?.maxRunningTimeSec,
					handler: createHandler({
						broker,
						streamKey: loaded.config.streamKey,
						maxConcurrent: loaded.config.maxConcurrent,
						replyTimeoutMs: loaded.config.replyTimeoutMs,
						notify: (message, level) => human.notify(message, level),
					}) as never,
				}),
			);
			handle = started as unknown as AgentInstanceHandleLike;
			human.setStatusLine(`🟢 blocks (${card.identity.agentName})`);
			human.notify(`online as ${card.identity.agentName} (instance ${handle.instanceId.slice(0, 8)})`);
		} catch (error) {
			handle = undefined;
			human.setStatusLine(undefined);
			human.notify(`could not come online: ${describe(error)}`, "error");
		} finally {
			starting = false;
		}
	}

	function disconnect(): void {
		broker.cancelAll();
		try { handle?.stop(); } catch { /* Going away anyway. */ }
		handle = undefined;
		human.setStatusLine(undefined);
	}

	pi.registerCommand("blocks:online", {
		description: "Connect this Pi session to Blocks Network",
		handler: async (_args, ctx) => connect(ctx),
	});

	pi.registerCommand("blocks:offline", {
		description: "Disconnect this Pi session from Blocks Network",
		handler: async (_args, ctx) => {
			if (!handle) return void ctx.ui.notify("blocks: already offline", "info");
			const name = config?.card.identity.agentName;
			disconnect();
			ctx.ui.notify(`blocks: offline${name ? ` (was ${name})` : ""}`, "info");
		},
	});

	pi.registerCommand("blocks:status", {
		description: "Show Blocks Network configuration and listener status",
		handler: async (_args, ctx) => {
			const loaded = refreshConfig(ctx);
			if (handle) ctx.ui.notify(`blocks: online as ${config?.card.identity.agentName}; ${broker.pending().length} pending`, "info");
			else if (loaded.ok) ctx.ui.notify(`blocks: configured as ${loaded.config.card.identity.agentName}, offline — /blocks:online to connect`, "info");
			else ctx.ui.notify(`blocks: not configured — ${loaded.reason}`, "warning");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		human.setContext(ctx);
		const loaded = refreshConfig(ctx);
		if (!loaded.ok) {
			human.setStatusLine(undefined);
			pi.appendEntry("blocks-connector-notice", { message: `not configured — ${loaded.reason}`, level: "info", at: Date.now() });
			return;
		}
		human.setStatusLine(undefined);
		pi.appendEntry("blocks-connector-notice", { message: `configured as ${loaded.config.card.identity.agentName}, offline until /blocks:online`, level: "info", at: Date.now() });
	});

	pi.on("session_shutdown", async () => {
		disconnect();
		config = undefined;
		human.clear();
		human.setContext(undefined);
	});
}
