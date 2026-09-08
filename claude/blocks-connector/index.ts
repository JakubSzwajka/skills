/**
 * Claude Code entry point: an MCP stdio server that hosts one inbound Blocks
 * agent for the session that started it.
 *
 * This is the Pi connector's `index.ts` with the host swapped out. Pi gave an
 * extension `registerCommand` and `registerTool` against a live session; here
 * the session starts us as an MCP server, so commands become tools and
 * delivery moves onto the loopback socket in host/inbound-ws.ts.
 *
 * Lifecycle mirrors the original deliberately. The MCP process lives and dies
 * with the session, and nothing touches the network until `blocks_online` is
 * called. The local socket does open at boot, so a Monitor can be armed before
 * going online and survive online/offline cycles without being re-armed.
 *
 * stdout belongs to the MCP protocol. Every log line goes to stderr.
 */

import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { describe, loadConfig, type ConfigResult, type ConnectorConfig } from "./config.ts";
import { createInboundChannel } from "./host/inbound-ws.ts";
import { createInboundBroker } from "./inbound/broker.ts";
import { createHandler } from "./net/handler.ts";
import { ensureRegistered, runBlocksRegister } from "./net/register.ts";
import { describeStatus } from "./operator/status.ts";
import { startWithConfiguredApiKey } from "./sdk-start.ts";

interface AgentInstanceHandleLike {
	stop(): void;
	instanceId: string;
}

const log = (message: string): void => void process.stderr.write(`blocks-connector: ${message}\n`);

/**
 * The agent directory holds `.env` and `agent-card.json`. Pi took it from the
 * session's trusted cwd; an MCP server's cwd is wherever the session happens
 * to be, which is the wrong thing to key an identity off, so it is passed in.
 */
function agentDir(argv: readonly string[]): string {
	const flag = argv.indexOf("--dir");
	return resolve(flag >= 0 && argv[flag + 1] ? argv[flag + 1]! : process.cwd());
}

/** `CC_BLOCKS_*` is the name here; `PI_BLOCKS_*` still works so one agent directory can serve both connectors. */
function connectorEnv(): NodeJS.ProcessEnv {
	const merged: NodeJS.ProcessEnv = { ...process.env };
	for (const [key, value] of Object.entries(process.env)) {
		if (key.startsWith("CC_BLOCKS_") && value !== undefined) merged[`PI_${key.slice(3)}`] = value;
	}
	return merged;
}

async function main(): Promise<void> {
	const dir = agentDir(process.argv.slice(2));
	const broker = createInboundBroker({ deliver: (message) => channel.deliver(message) });
	const channel = await createInboundChannel({ pending: () => broker.pending(), log });

	let handle: AgentInstanceHandleLike | undefined;
	let config: ConnectorConfig | undefined;
	let starting = false;

	function refreshConfig(): ConfigResult {
		const loaded = loadConfig(dir, connectorEnv());
		config = loaded.ok ? loaded.config : undefined;
		return loaded;
	}

	function disconnect(): void {
		broker.cancelAll();
		try { handle?.stop(); } catch { /* Going away anyway. */ }
		handle = undefined;
	}

	async function connect(): Promise<string> {
		if (handle) return `Already online as ${config?.card.identity.agentName}.\n${armLine()}`;
		if (starting) return "Already connecting. Try blocks_status in a moment.";
		const loaded = refreshConfig();
		if (!loaded.ok) return `Cannot go online — ${loaded.reason}`;

		starting = true;
		try {
			const { startAgentInstance, getAgent, fetchCdmConfig } = await import("@blocks-network/sdk");
			const { card } = loaded.config;
			const cdm = await fetchCdmConfig(loaded.config.cdmUrl);
			const outcome = await ensureRegistered(
				card.identity.agentName,
				loaded.config.cardPath,
				loaded.config.apiKey,
				{
					getAgent: (name, options) => getAgent(name, { ...options, baseUrl: cdm.api.baseUrl }) as never,
					runRegister: runBlocksRegister,
				},
			);
			if (outcome.action === "failed") return `Registration failed: ${outcome.detail}`;

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
						notify: (message, level) => log(`${level ?? "info"}: ${message}`),
					}) as never,
				}),
			);
			handle = started as unknown as AgentInstanceHandleLike;
			const registered = outcome.action === "registered" ? `Registered ${card.identity.agentName} (private, free).\n` : "";
			return `${registered}Online as ${card.identity.agentName} (instance ${handle.instanceId.slice(0, 8)}).\n${armLine()}`;
		} catch (error) {
			handle = undefined;
			return `Could not come online: ${describe(error)}`;
		} finally {
			starting = false;
		}
	}

	/**
	 * Without a Monitor the broker still accepts work, holds it, and times it
	 * out silently — so this instruction is repeated on every status and every
	 * online call rather than said once at startup.
	 */
	function armLine(): string {
		return channel.watchers() > 0
			? `Inbound watcher attached. Messages will arrive in the chat.`
			: `No inbound watcher yet. Arm one now, or nothing will reach the session:\n` +
				`  Monitor({ ws: { url: "${channel.url()}" }, description: "inbound Blocks messages", persistent: true })`;
	}

	const server = new McpServer({ name: "blocks-connector", version: "0.1.0" });

	server.registerTool("blocks_online", {
		title: "Blocks: go online",
		description:
			"Start listening for inbound Blocks Network requests and pipes. Registers this agent name first if it is not registered yet. Returns the Monitor WebSocket URL that delivers inbound messages into this session.",
		inputSchema: {},
	}, async () => ({ content: [{ type: "text", text: await connect() }] }));

	server.registerTool("blocks_offline", {
		title: "Blocks: go offline",
		description:
			"Stop listening for inbound Blocks work. Cancels every pending inbound message; each caller receives the truthful deadline fallback.",
		inputSchema: {},
	}, async () => {
		if (!handle) return { content: [{ type: "text", text: "Already offline." }] };
		const name = config?.card.identity.agentName;
		const dropped = broker.pending().length;
		disconnect();
		return { content: [{ type: "text", text: `Offline${name ? ` (was ${name})` : ""}. ${dropped} pending message(s) cancelled.` }] };
	});

	server.registerTool("blocks_status", {
		title: "Blocks: status",
		description:
			"Read-only Blocks listener status: online state, pending inbound messages with their reply references, and recent outcomes.",
		inputSchema: {},
	}, async () => {
		const loaded = refreshConfig();
		const text = describeStatus({
			online: Boolean(handle),
			agentName: config?.card.identity.agentName,
			instanceId: handle?.instanceId,
			pending: broker.pending(),
			recent: broker.recent(),
		});
		const trouble = loaded.ok ? "" : `\nConfiguration problem: ${loaded.reason}`;
		return { content: [{ type: "text", text: `${text}${trouble}\n\n${armLine()}` }] };
	});

	server.registerTool("blocks_reply", {
		title: "Blocks: reply to inbound message",
		description:
			"Immediately answer one pending inbound Blocks message using its opaque reference. Sends exactly the supplied text to the remote caller, with no further approval step. Use blocks_status to inspect pending references.",
		inputSchema: {
			reference: z.string().describe("Opaque reply reference shown in the inbound message"),
			text: z.string().describe("Exact text to return to the caller"),
		},
	}, async ({ reference, text }) => {
		const result = broker.reply(reference, text);
		return {
			content: [{
				type: "text",
				text: result === "sent"
					? "Reply sent."
					: result === "expired"
						? "That item is no longer pending; its deadline passed or it was cancelled. Nothing was sent."
						: "Unknown reply reference. Nothing was sent.",
			}],
			isError: result !== "sent",
		};
	});

	const shutdown = (): void => {
		disconnect();
		channel.close();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	await server.connect(new StdioServerTransport());
	log(`ready — agent directory ${dir}, inbound socket on 127.0.0.1`);
}

main().catch((error) => {
	log(`fatal: ${describe(error)}`);
	process.exit(1);
});
