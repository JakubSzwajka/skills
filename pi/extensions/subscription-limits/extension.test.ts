import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import subscriptionLimits, {
	LimitsWidget,
	showLimits,
	SUBSCRIPTION_LIMITS_WIDGET_KEY,
} from "./index.ts";

export default function limitsSmoke(): void {}

void (async () => {
const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};
let command: any;
subscriptionLimits({ registerCommand(name: string, spec: any) { assert.equal(name, "limits"); command = spec; } } as any);
assert.ok(command, "limits command registered");

let component: any;
let handler: ((data: string) => { consume?: boolean }) | undefined;
let placement: string | undefined;
let clears = 0;
let unsubscribes = 0;
let editor = "limits draft\nunchanged";
let editorWrites = 0;
let renderRequests = 0;
const notices: string[] = [];
const tui = {
	terminal: { rows: 24 },
	requestRender() { renderRequests++; },
};
const baseUi = {
	setWidget(key: string, factory: any, options?: { placement?: string }) {
		assert.equal(key, SUBSCRIPTION_LIMITS_WIDGET_KEY);
		if (!factory) { clears++; return; }
		placement = options?.placement;
		component = factory(tui, theme);
	},
	onTerminalInput(next: typeof handler) { handler = next; return () => { unsubscribes++; }; },
	notify(message: string) { notices.push(message); },
	getEditorText: () => editor,
	setEditorText(value: string) { editorWrites++; editor = value; },
};
const emptyCtx = {
	mode: "tui",
	hasUI: true,
	ui: baseUi,
	modelRegistry: {
		getProviderAuthStatus: () => ({ configured: false }),
		getProviderAuth: async () => undefined,
	},
} as any;
const emptyPending = command.handler("", emptyCtx);
assert.equal(placement, "aboveEditor");
assert.ok(component.render(50).some((line: string) => line.includes("Checking subscription limits")));
assert.equal(handler?.("x")?.consume, true, "ordinary input is consumed while loading");
await emptyPending;
assert.equal(clears, 1);
assert.equal(unsubscribes, 1);
assert.ok(notices.some((message) => message.includes("No Codex")));
assert.equal(editorWrites, 0);
assert.equal(editor, "limits draft\nunchanged");

let fetchSignal: AbortSignal | undefined;
const originalFetch = globalThis.fetch;
globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
	fetchSignal = init?.signal ?? undefined;
	return new Promise((_resolve, reject) => {
		fetchSignal?.addEventListener("abort", () => reject(fetchSignal?.reason), { once: true });
	});
}) as typeof fetch;
try {
	const loadingCtx = {
		...emptyCtx,
		modelRegistry: {
			getProviderAuthStatus: (id: string) => ({ configured: id === "openai-codex" }),
			getProviderAuth: async () => ({ auth: { apiKey: "x.e30.x", headers: {} } }),
		},
	} as any;
	const loadingPending = command.handler("", loadingCtx);
	await Promise.resolve();
	assert.equal(handler?.("\r")?.consume, true, "enter is consumed while loading");
	assert.equal(fetchSignal?.aborted, false, "enter does not cancel loading");
	assert.equal(handler?.("\u001b[113u")?.consume, true, "Kitty-encoded q is consumed and cancels loading");
	await loadingPending;
	assert.equal(fetchSignal?.aborted, true, "loading request is aborted");
	assert.equal(clears, 2);
	assert.equal(unsubscribes, 2);
} finally {
	globalThis.fetch = originalFetch;
}

let directCloses = 0;
const loadingWidget = new LimitsWidget(tui as any, theme as any, () => { directCloses++; });
loadingWidget.handleInput("\u001b[13u");
assert.equal(directCloses, 0, "Kitty-encoded enter is ignored while loading");
loadingWidget.handleInput("\u001b[113u");
assert.equal(directCloses, 1, "Kitty-encoded q closes while loading");

const widget = new LimitsWidget(tui as any, theme as any, () => {});
widget.setProviders([{ id: "anthropic", title: "Claude", windows: [], notes: [], error: "Login expired" }]);
const rendered = widget.render(32);
assert.ok(rendered.some((line) => line.includes("Claude")), "provider result is rendered");
assert.ok(rendered.length <= 20, "dashboard height stays bounded on a short terminal");
assert.ok(rendered.every((line) => visibleWidth(line) <= 32), "dashboard rows fit the supplied width");
assert.ok(rendered[0] && rendered.at(-1), "dashboard has a frame");

const overflowingProviders = [{
	id: "anthropic" as const,
	title: "Claude",
	windows: Array.from({ length: 16 }, (_, index) => ({
		label: `Quota ${String(index + 1).padStart(2, "0")}`,
		usedPercent: index + 1,
		resetCadence: "weekly",
	})),
	notes: [],
}];
const tinyTui = {
	terminal: { rows: 12 },
	requestRender() {},
};
const tinyWidget = new LimitsWidget(tinyTui as any, theme as any, () => {});
tinyWidget.setProviders(overflowingProviders);
assert.ok(tinyWidget.render(60).length <= 12, "overflowing dashboard fits a short terminal");

const tallTui = {
	terminal: { rows: 40 },
	requestRender() { renderRequests++; },
};
const scrollingWidget = new LimitsWidget(tallTui as any, theme as any, () => {});
scrollingWidget.setProviders(overflowingProviders);
const topPage = scrollingWidget.render(60);
assert.ok(topPage.length > 20, "dashboard grows when the terminal has room");
assert.ok(topPage.length <= 32, "tall dashboard remains capped");
assert.ok(topPage.some((line) => line.includes("Quota 01")), "first result starts in view");
assert.ok(!topPage.some((line) => line.includes("Quota 16")), "later results start below the viewport");
const requestsBeforeScroll = renderRequests;
scrollingWidget.handleInput("\u001b[6~");
assert.equal(renderRequests, requestsBeforeScroll + 1, "page down requests a render");
const bottomPage = scrollingWidget.render(60);
assert.ok(bottomPage.some((line) => line.includes("Quota 16")), "page down reveals the last result");
assert.ok(!bottomPage.some((line) => line.includes("Quota 01")), "page down moves the first result out of view");
scrollingWidget.handleInput("\u001b[5~");
assert.ok(scrollingWidget.render(60).some((line) => line.includes("Quota 01")), "page up returns to the first result");
scrollingWidget.handleInput("\u001b[F");
assert.ok(scrollingWidget.render(60).some((line) => line.includes("Quota 16")), "end reveals the last result");
scrollingWidget.handleInput("\u001b[H");
assert.ok(scrollingWidget.render(60).some((line) => line.includes("Quota 01")), "home returns to the first result");

const codexPayload = {
	plan_type: "prolite",
	rate_limit: {
		primary_window: { used_percent: 11, limit_window_seconds: 604_800, reset_at: 1_788_680_989 },
		secondary_window: null,
	},
	additional_rate_limits: [],
};
globalThis.fetch = (async () => ({ ok: true, json: async () => codexPayload })) as typeof fetch;
try {
	const resultCtx = {
		...emptyCtx,
		modelRegistry: {
			getProviderAuthStatus: (id: string) => ({ configured: id === "openai-codex" }),
			getProviderAuth: async () => ({ auth: { apiKey: "x.e30.x", headers: {} } }),
		},
	} as any;
	const resultPending = command.handler("", resultCtx);
	await new Promise((resolve) => setImmediate(resolve));
	assert.ok(component.render(40).some((line: string) => line.includes("ChatGPT Codex")), "command transitions the same widget to results");
	assert.equal(handler?.("\u001b[13u")?.consume, true, "result enter is consumed and closes");
	await resultPending;
	assert.equal(clears, 3);
	assert.equal(unsubscribes, 3);

	const clearsBeforeNonTui = clears;
	await command.handler("", { ...resultCtx, mode: "rpc", hasUI: true });
	assert.equal(clears, clearsBeforeNonTui, "non-TUI output does not install or clear a widget");
	assert.ok(notices.some((message) => message.includes("Subscription limits")), "non-TUI UI path keeps plain-text notification output");
} finally {
	globalThis.fetch = originalFetch;
}

globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
	fetchSignal = init?.signal ?? undefined;
	return new Promise((_resolve, reject) => {
		fetchSignal?.addEventListener("abort", () => reject(fetchSignal?.reason), { once: true });
	});
}) as typeof fetch;
try {
	const timeoutCtx = {
		...emptyCtx,
		modelRegistry: {
			getProviderAuthStatus: (id: string) => ({ configured: id === "openai-codex" }),
			getProviderAuth: async () => ({ auth: { apiKey: "x.e30.x", headers: {} } }),
		},
	} as any;
	await showLimits(timeoutCtx, 1);
	assert.equal(fetchSignal?.aborted, true, "timeout aborts the loading request");
	assert.ok(notices.some((message) => message.includes("timed out")), "timeout remains visible to the user");
	assert.equal(clears, 4);
	assert.equal(unsubscribes, 4);

	await assert.rejects(showLimits({
		...emptyCtx,
		modelRegistry: {
			getProviderAuthStatus: () => { throw new Error("registry failed"); },
		},
	} as any, 50), /registry failed/);
	assert.equal(clears, 5, "global loading errors clear the widget");
	assert.equal(unsubscribes, 5, "global loading errors unsubscribe terminal input");
} finally {
	globalThis.fetch = originalFetch;
}

})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
