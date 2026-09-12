import type { ContextEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { basename } from "node:path";
import {
	defaultSpecRoot,
	describeSpec,
	discover,
	pickerLabels,
	renderNote,
	sanitizeDisplay,
	type SpecRecord,
	type SpecStatus,
} from "./discovery.ts";
import { appendSpecLog, transitionStatus } from "./progress.ts";

const LINK_ENTRY = "spec-link:link";
const NOTE_TYPE = "spec-link:note";
const STATUS_KEY = "spec-link";

type StoredLink = { path: string | null };

export interface SpecLinkOptions {
	root?: string;
	now?: () => number;
}

export default function specLinkExtension(pi: ExtensionAPI, options: SpecLinkOptions = {}): void {
	// A delegate child gets its owned brief only. Registering nothing also keeps the master-only log tool out of child prompts.
	if (process.env.PI_DELEGATE_ROLE === "child") return;

	const root = options.root ?? defaultSpecRoot();
	const now = options.now ?? Date.now;
	let link: SpecRecord | undefined;

	const showStatus = (ctx: ExtensionContext): void => {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus(STATUS_KEY, link ? `spec: ${sanitizeDisplay(link.title, 40)} [${link.status}]` : undefined);
	};

	const setLink = (next: SpecRecord | undefined, ctx: ExtensionContext): void => {
		link = next;
		pi.appendEntry<StoredLink>(LINK_ENTRY, { path: next?.path ?? null });
		showStatus(ctx);
	};

	const restore = (ctx: ExtensionContext): void => {
		let storedPath: string | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== LINK_ENTRY) continue;
			const data = entry.data as Partial<StoredLink> | undefined;
			if (!data || typeof data !== "object") storedPath = undefined;
			else storedPath = typeof data.path === "string" ? data.path : undefined;
		}
		if (!storedPath) {
			link = undefined;
			showStatus(ctx);
			return;
		}
		const restored = describeSpec(storedPath, root);
		if (restored.kind === "invalid") {
			link = undefined;
			showStatus(ctx);
			if (ctx.hasUI) ctx.ui.notify(`Cannot restore mounted spec: ${sanitizeDisplay(restored.error)}`, "error");
			return;
		}
		link = restored;
		showStatus(ctx);
	};

	pi.registerCommand("spec", {
		description: "Mount a global spec folder to this session",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/spec needs the interactive TUI.", "error");
				return;
			}
			const records = discover(root, now(), link?.path);
			if (records.length === 0) {
				ctx.ui.notify(`No pending or recently completed specs found under ${root}.`, "warning");
				return;
			}
			const labels = pickerLabels(records);
			const choices = new Map(labels.map((label, index) => [label, records[index]]));
			const clearLabel = link ? "Clear the mounted spec" : undefined;
			const choice = await ctx.ui.select("Mount a spec", clearLabel ? [clearLabel, ...labels] : labels);
			if (!choice) return;
			if (choice === clearLabel) {
				const previous = link;
				setLink(undefined, ctx);
				ctx.ui.notify(`Cleared: ${sanitizeDisplay(previous?.title ?? "")}`, "info");
				return;
			}
			const chosen = choices.get(choice);
			if (!chosen) return;
			if (chosen.kind === "invalid") {
				ctx.ui.notify(`Cannot mount ${sanitizeDisplay(chosen.folder)}: ${sanitizeDisplay(chosen.error)}`, "error");
				return;
			}
			setLink(chosen, ctx);
			ctx.ui.notify(`Mounted spec: ${sanitizeDisplay(chosen.title)} [${chosen.status}]`, "info");
		},
	});

	pi.registerCommand("spec:clear", {
		description: "Unmount the current spec",
		handler: async (_args, ctx) => {
			if (!link) {
				ctx.ui.notify("No spec is mounted.", "warning");
				return;
			}
			const previous = link;
			setLink(undefined, ctx);
			ctx.ui.notify(`Cleared: ${sanitizeDisplay(previous.title)}`, "info");
		},
	});

	pi.registerCommand("spec:status", {
		description: "Set the mounted spec status to pending or done",
		handler: async (args, ctx) => {
			const requested = args.trim();
			if (requested !== "pending" && requested !== "done") {
				ctx.ui.notify("Usage: /spec:status pending|done", "error");
				return;
			}
			if (!link) {
				ctx.ui.notify("No spec is mounted.", "warning");
				return;
			}
			try {
				const result = transitionStatus(link, requested as SpecStatus, root, now());
				link = result.record;
				showStatus(ctx);
				ctx.ui.notify(result.changed ? `Spec status: ${requested}` : `Spec is already ${requested}.`, "info");
			} catch (error) {
				ctx.ui.notify(`Could not change spec status: ${sanitizeDisplay(error instanceof Error ? error.message : String(error))}`, "error");
			}
		},
	});

	const appendLog = (text: string): string => {
		if (!link) throw new Error("No spec is mounted");
		return appendSpecLog(link, text, root, now());
	};

	pi.registerCommand("spec:log:append", {
		description: "Append text as a new immutable file in the mounted spec log",
		handler: async (args, ctx) => {
			try {
				const path = appendLog(args);
				ctx.ui.notify(`Added spec log: ${sanitizeDisplay(basename(path))}`, "info");
			} catch (error) {
				ctx.ui.notify(`Could not append spec log: ${sanitizeDisplay(error instanceof Error ? error.message : String(error))}`, "error");
			}
		},
	});

	pi.registerTool({
		name: "spec_log_append",
		label: "Append spec log",
		description: "Create one immutable timestamped Markdown log file in the mounted spec. This tool is available only to the master orchestrator.",
		promptSnippet: "Append a note to the mounted spec log",
		executionMode: "sequential",
		parameters: Type.Object({ text: Type.String({ minLength: 1, description: "Markdown text for the new log entry" }) }),
		async execute(_toolCallId, params) {
			try {
				const path = appendLog(params.text);
				return { content: [{ type: "text", text: `Added spec log: ${path}` }], details: { path } };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { content: [{ type: "text", text: `spec_log_append failed: ${message}` }], details: { error: message } };
			}
		},
	});

	// The provider sees a short pointer inserted before the latest user turn. It never enters the saved transcript.
	pi.on("context", (event, ctx) => {
		const messages = event.messages.filter((message) => !(message.role === "custom" && message.customType === NOTE_TYPE));
		if (link) {
			const current = describeSpec(link.path, root);
			if (current.kind === "invalid") {
				link = undefined;
				showStatus(ctx);
				if (ctx.hasUI) ctx.ui.notify(`Mounted spec became invalid: ${sanitizeDisplay(current.error)}`, "error");
			} else {
				const displayChanged = current.title !== link.title || current.status !== link.status;
				link = current;
				if (displayChanged) showStatus(ctx);
			}
		}
		if (!link) return messages.length === event.messages.length ? undefined : { messages };
		const note: ContextEvent["messages"][number] = {
			role: "custom",
			customType: NOTE_TYPE,
			content: renderNote(link),
			display: false,
			timestamp: now(),
		};
		let insertion = messages.length;
		for (let index = messages.length - 1; index >= 0; index--) {
			if (messages[index].role === "user") {
				insertion = index;
				break;
			}
		}
		messages.splice(insertion, 0, note);
		return { messages };
	});

	pi.on("session_start", (_event, ctx) => restore(ctx));
	pi.on("session_tree", (_event, ctx) => restore(ctx));
	pi.on("session_shutdown", (_event, ctx) => {
		link = undefined;
		showStatus(ctx);
	});
}
