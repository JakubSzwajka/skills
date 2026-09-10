import type { ContextEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, discover, pickerLabel, renderNote, sanitizeDisplay, type SpecLink } from "./discovery.ts";

const LINK_ENTRY = "spec-link:link";
const NOTE_TYPE = "spec-link:note";
const STATUS_KEY = "spec-link";

type StoredLink = SpecLink | { path: null };

export default function specLinkExtension(pi: ExtensionAPI): void {
	// Children get their brief, not the operator's context.
	if (process.env.PI_DELEGATE_ROLE === "child") return;

	let link: SpecLink | undefined;

	const showStatus = (ctx: ExtensionContext): void => {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus(STATUS_KEY, link ? `spec: ${sanitizeDisplay(link.title, 40)}` : undefined);
	};

	const setLink = (next: SpecLink | undefined, ctx: ExtensionContext): void => {
		link = next;
		pi.appendEntry<StoredLink>(LINK_ENTRY, next ?? { path: null });
		showStatus(ctx);
	};

	const restore = (ctx: ExtensionContext): void => {
		let stored: SpecLink | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== LINK_ENTRY) continue;
			const data = entry.data as StoredLink | undefined;
			stored = data && typeof data === "object" && typeof data.path === "string" ? (data as SpecLink) : undefined;
		}
		// A spec that moved or was deleted is no longer a link worth carrying.
		link = stored && describe(stored.path, ctx.cwd) ? stored : undefined;
		showStatus(ctx);
	};

	pi.registerCommand("spec", {
		description: "Link a spec or ticket to this session",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/spec needs the interactive TUI.", "error");
				return;
			}
			const candidates = discover(ctx.cwd);
			if (candidates.length === 0) {
				ctx.ui.notify(`No specs or tickets found under ${ctx.cwd}.`, "warning");
				return;
			}
			const now = Date.now();
			const labels = candidates.map((candidate) => pickerLabel(candidate, now));
			const clearLabel = link ? `Clear the linked ${link.kind}` : undefined;
			const choice = await ctx.ui.select("Link a spec or ticket", clearLabel ? [clearLabel, ...labels] : labels);
			if (!choice) return;
			if (choice === clearLabel) {
				const previous = link;
				setLink(undefined, ctx);
				ctx.ui.notify(`Cleared: ${sanitizeDisplay(previous?.title ?? "")}`, "info");
				return;
			}
			const chosen = candidates[labels.indexOf(choice)];
			if (!chosen) return;
			setLink({ path: chosen.path, title: chosen.title, kind: chosen.kind }, ctx);
			ctx.ui.notify(`Linked ${chosen.kind}: ${sanitizeDisplay(chosen.title)}`, "info");
		},
	});

	pi.registerCommand("spec:clear", {
		description: "Clear the linked spec or ticket",
		handler: async (_args, ctx) => {
			if (!link) {
				ctx.ui.notify("No spec is linked.", "warning");
				return;
			}
			const previous = link;
			setLink(undefined, ctx);
			ctx.ui.notify(`Cleared: ${sanitizeDisplay(previous.title)}`, "info");
		},
	});

	// Provider-only: the note lives in this call's message copy, never in the session.
	pi.on("context", (event, _ctx) => {
		const messages = event.messages.filter((message) => !(message.role === "custom" && message.customType === NOTE_TYPE));
		if (!link) return messages.length === event.messages.length ? undefined : { messages };
		const note: ContextEvent["messages"][number] = {
			role: "custom",
			customType: NOTE_TYPE,
			content: renderNote(link),
			display: false,
			timestamp: Date.now(),
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
