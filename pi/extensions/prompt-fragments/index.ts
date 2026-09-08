import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
	CONFIG_DIR_NAME,
	getAgentDir,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { composePrompt, discoverFragments } from "./fragments.ts";
import { openFragmentPicker, sanitizeFragmentDisplay } from "./picker.ts";

export default function promptFragmentsExtension(pi: ExtensionAPI): void {
	const openInCursor = async (directory: string, ctx: ExtensionContext): Promise<void> => {
		try {
			mkdirSync(directory, { recursive: true });
			const command = process.platform === "darwin" ? "open" : "cursor";
			const args = process.platform === "darwin" ? ["-a", "Cursor", directory] : [directory];
			const result = await pi.exec(command, args, { signal: ctx.signal });
			if (result.code !== 0) {
				throw new Error(result.stderr.trim() || `${command} exited with code ${result.code}`);
			}
			ctx.ui.notify(`Opened ${sanitizeFragmentDisplay(directory)} in Cursor.`, "info");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Could not open Cursor: ${sanitizeFragmentDisplay(message)}`, "error");
		}
	};

	const open = async (ctx: ExtensionContext): Promise<void> => {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("Prompt fragments need the interactive TUI.", "error");
			return;
		}

		const globalDir = join(getAgentDir(), "prompt-fragments");
		const projectDir = join(ctx.cwd, CONFIG_DIR_NAME, "prompt-fragments");
		const projectTrusted = ctx.isProjectTrusted();
		const { fragments, warnings } = discoverFragments({
			globalDir,
			projectDir,
			includeProject: projectTrusted,
		});
		for (const warning of warnings) {
			ctx.ui.notify(`Prompt fragment skipped: ${sanitizeFragmentDisplay(warning)}`, "warning");
		}

		const editorText = ctx.ui.getEditorText();
		const result = await openFragmentPicker(ctx, fragments);
		if (result === "open-global") {
			await openInCursor(globalDir, ctx);
			return;
		}
		if (result === "open-project") {
			if (!projectTrusted) {
				ctx.ui.notify("Trust this project before opening its prompt-fragments directory.", "warning");
				return;
			}
			await openInCursor(projectDir, ctx);
			return;
		}
		if (!result || result.length === 0) return;
		ctx.ui.setEditorText(composePrompt(editorText, result));
	};

	pi.registerCommand("fragments", {
		description: "Select prompt fragments to add around the editor text",
		handler: async (_args, ctx) => open(ctx),
	});

	pi.registerShortcut("super+shift+r", {
		description: "Select prompt fragments",
		handler: open,
	});
}
