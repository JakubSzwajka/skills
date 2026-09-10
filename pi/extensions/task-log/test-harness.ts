import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import taskLog from "./index.ts";

interface CustomEntry {
	type: "custom";
	customType: string;
	data: unknown;
}

interface SentMessage {
	message: unknown;
	options: unknown;
}

export interface HarnessContextOptions {
	cwd?: string;
	mode?: "tui" | string;
	sessionId?: string;
	branch?: CustomEntry[];
	pickerInputs?: string[];
	inputs?: Array<string | undefined>;
	selects?: Array<string | undefined>;
	confirms?: boolean[];
}

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

export class FakeExtensionHost {
	readonly commands = new Map<string, any>();
	readonly tools = new Map<string, any>();
	readonly hooks = new Map<string, Array<(event: any, ctx: any) => any>>();
	readonly customEntries: CustomEntry[] = [];
	readonly contextMessages: SentMessage[] = [];
	activeTools: string[] = [];
	private loadingExtension = false;
	private runtimeStarted = false;

	private requireRuntime(): void {
		if (this.loadingExtension) throw new Error("Extension runtime not initialized. Action methods cannot be called during extension loading.");
	}

	readonly api: ExtensionAPI = {
		registerCommand: (name: string, spec: any) => { this.commands.set(name, spec); },
		registerTool: (spec: any) => {
			this.tools.set(spec.name, spec);
			if (!this.activeTools.includes(spec.name)) this.activeTools.push(spec.name);
		},
		on: (event: string, handler: (event: any, ctx: any) => any) => {
			const handlers = this.hooks.get(event) ?? [];
			handlers.push(handler);
			this.hooks.set(event, handlers);
		},
		appendEntry: (customType: string, data?: unknown) => {
			this.requireRuntime();
			this.customEntries.push({ type: "custom", customType, data });
		},
		sendMessage: (message: unknown, options?: unknown) => {
			this.requireRuntime();
			this.contextMessages.push({ message, options });
		},
		getActiveTools: () => {
			this.requireRuntime();
			return [...this.activeTools];
		},
		getAllTools: () => {
			this.requireRuntime();
			return [...this.tools.values()];
		},
		setActiveTools: (names: string[]) => {
			this.requireRuntime();
			this.activeTools = [...names];
		},
	} as ExtensionAPI;

	constructor(load = true) {
		if (!load) return;
		const child = process.env.PI_SUBAGENT_CHILD;
		delete process.env.PI_SUBAGENT_CHILD;
		try { this.load(taskLog); }
		finally {
			if (child !== undefined) process.env.PI_SUBAGENT_CHILD = child;
		}
	}

	load(extension: (api: ExtensionAPI) => void): void {
		this.loadingExtension = true;
		this.runtimeStarted = false;
		try { extension(this.api); }
		finally { this.loadingExtension = false; }
	}

	private async ensureRuntimeStarted(ctx: any): Promise<void> {
		if (!this.runtimeStarted) await this.emit("session_start", { reason: "startup" }, ctx);
	}

	createContext(options: HarnessContextOptions = {}): any {
		const pickerInputs = [...(options.pickerInputs ?? [])];
		const inputs = [...(options.inputs ?? [])];
		const selects = [...(options.selects ?? [])];
		const confirms = [...(options.confirms ?? [])];
		const notifications: Array<{ message: string; level: string }> = [];
		const statuses = new Map<string, string | undefined>();
		let terminalHandler: ((data: string) => { consume?: boolean }) | undefined;
		return {
			cwd: options.cwd ?? mkdtempSync(join(tmpdir(), "task-log-context-")),
			mode: options.mode ?? "tui",
			hasUI: true,
			notifications,
			statuses,
			sessionManager: {
				getSessionId: () => options.sessionId ?? "12345678-abcd-efab-cdef-123456789abc",
				getBranch: () => options.branch ?? this.customEntries,
			},
			ui: {
				theme,
				setStatus: (key: string, value: string | undefined) => { statuses.set(key, value); },
				notify: (message: string, level: string) => { notifications.push({ message, level }); },
				input: async () => inputs.shift(),
				select: async () => selects.shift(),
				confirm: async () => confirms.shift() ?? false,
				setWidget: (_key: string, factory: any) => {
					if (!factory) return;
					factory({ requestRender() {} }, theme);
				},
				onTerminalInput: (handler: typeof terminalHandler) => {
					terminalHandler = handler;
					const input = pickerInputs.shift();
					if (input !== undefined) queueMicrotask(() => terminalHandler?.(input));
					return () => { terminalHandler = undefined; };
				},
			},
		};
	}

	async invokeCommand(name: string, ctx: any, args = ""): Promise<void> {
		const command = this.commands.get(name);
		if (!command) throw new Error(`Command not registered: ${name}`);
		await this.ensureRuntimeStarted(ctx);
		await command.handler(args, ctx);
	}

	async invokeTool(name: string, params: unknown, ctx: any): Promise<any> {
		const tool = this.tools.get(name);
		if (!tool) throw new Error(`Tool not registered: ${name}`);
		await this.ensureRuntimeStarted(ctx);
		if (!this.activeTools.includes(name)) throw new Error(`Tool is not active: ${name}`);
		if (!Value.Check(tool.parameters, params)) throw new Error(`Tool parameters failed schema validation: ${name}`);
		const event = { type: "tool_call", toolName: name, toolCallId: "call-1", input: params };
		for (const handler of this.hooks.get("tool_call") ?? []) {
			const result = await handler(event, ctx);
			if (result?.block) throw new Error(result.reason || `Tool call blocked: ${name}`);
		}
		return tool.execute("call-1", event.input, new AbortController().signal, () => {}, ctx);
	}

	async emit(event: string, payload: unknown, ctx: any): Promise<unknown[]> {
		if (event === "session_start") this.runtimeStarted = true;
		const results: unknown[] = [];
		for (const handler of this.hooks.get(event) ?? []) results.push(await handler(payload, ctx));
		return results;
	}
}

export function temporaryRepository(): string {
	const path = mkdtempSync(join(tmpdir(), "task-log-repository-"));
	execFileSync("git", ["init", "-q", path]);
	return path;
}
