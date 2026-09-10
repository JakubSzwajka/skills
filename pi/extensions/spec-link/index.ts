import type { ContextEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describeFeature, discover, type FeatureLink, pickerLabels, renderNote, sanitizeDisplay } from "./discovery.ts";

const LINK_ENTRY = "spec-link:link";
const NOTE_TYPE = "spec-link:note";
const STATUS_KEY = "spec-link";

type StoredLink = FeatureLink | { path: null };

export default function specLinkExtension(pi: ExtensionAPI): void {
	// Children get their brief, not the operator's context.
	if (process.env.PI_DELEGATE_ROLE === "child") return;

	let link: FeatureLink | undefined;

	const showStatus = (ctx: ExtensionContext): void => {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus(STATUS_KEY, link ? `spec: ${sanitizeDisplay(link.title, 40)}` : undefined);
	};

	const setLink = (next: FeatureLink | undefined, ctx: ExtensionContext): void => {
		link = next;
		pi.appendEntry<StoredLink>(LINK_ENTRY, next ?? { path: null });
		showStatus(ctx);
	};

	const restore = (ctx: ExtensionContext): void => {
		let stored: FeatureLink | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== LINK_ENTRY) continue;
			const data = entry.data as StoredLink | undefined;
			stored = data && typeof data === "object" && typeof data.path === "string" ? (data as FeatureLink) : undefined;
		}
		// A feature that moved or lost its records is no longer a link worth carrying.
		link = stored ? describeFeature(stored.path, ctx.cwd) : undefined;
		showStatus(ctx);
	};

	pi.registerCommand("spec", {
		description: "Link a feature — its spec and tickets — to this session",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/spec needs the interactive TUI.", "error");
				return;
			}
			const features = discover(ctx.cwd);
			if (features.length === 0) {
				ctx.ui.notify(`No specs or tickets found under ${ctx.cwd}.`, "warning");
				return;
			}
			const labels = pickerLabels(features, Date.now());
			const clearLabel = link ? "Clear the linked feature" : undefined;
			const choice = await ctx.ui.select("Link a feature", clearLabel ? [clearLabel, ...labels] : labels);
			if (!choice) return;
			if (choice === clearLabel) {
				const previous = link;
				setLink(undefined, ctx);
				ctx.ui.notify(`Cleared: ${sanitizeDisplay(previous?.title ?? "")}`, "info");
				return;
			}
			const chosen = features[labels.indexOf(choice)];
			if (!chosen) return;
			setLink(
				{ path: chosen.path, title: chosen.title, specPath: chosen.specPath, ticketsPath: chosen.ticketsPath, ticketCount: chosen.ticketCount },
				ctx,
			);
			ctx.ui.notify(`Linked feature: ${sanitizeDisplay(chosen.title)}`, "info");
		},
	});

	pi.registerCommand("spec:clear", {
		description: "Clear the linked feature",
		handler: async (_args, ctx) => {
			if (!link) {
				ctx.ui.notify("No feature is linked.", "warning");
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
