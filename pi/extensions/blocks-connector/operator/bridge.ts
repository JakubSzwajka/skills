import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { InboundBroker } from "../inbound/broker.ts";

export interface HumanBridge {
	notify(message: string, level?: "info" | "warning" | "error"): void;
	clear(): void;
	setContext(ctx: ExtensionContext | undefined): void;
	setStatusLine(text: string | undefined): void;
}

const KEY = "blocks-connector";

export function createHumanBridge(pi: ExtensionAPI, broker: InboundBroker): HumanBridge {
	let ctx: ExtensionContext | undefined;
	let statusLine: string | undefined;

	function render(): void {
		if (!ctx?.hasUI) return;
		const pending = broker.pending();
		ctx.ui.setStatus(KEY, statusLine);
		ctx.ui.setWidget(
			KEY,
			pending.length === 0
				? undefined
				: [
						"── blocks inbound ──",
						...pending.map(
							(item) => `${item.reference.slice(0, 8)} · ${item.kind} · ${item.peer}`,
						),
					],
			"aboveEditor",
		);
	}

	broker.onChange(render);
	return {
		notify(message, level = "info") {
			pi.appendEntry("blocks-connector-notice", { message, level, at: Date.now() });
			ctx?.ui.notify(`blocks: ${message}`, level);
		},
		setContext(next) {
			ctx = next;
			render();
		},
		setStatusLine(text) {
			statusLine = text;
			render();
		},
		clear() {
			if (!ctx?.hasUI) return;
			ctx.ui.setWidget(KEY, undefined);
			ctx.ui.setStatus(KEY, undefined);
		},
	};
}
