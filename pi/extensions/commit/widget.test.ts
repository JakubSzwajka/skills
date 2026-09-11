import assert from "node:assert/strict";
import test from "node:test";
import {
	COMMIT_WIDGET_KEY,
	CommitStatusWidget,
	renderCommitWidget,
	shortCommitModel,
	type CommitWidgetClock,
} from "./widget.ts";

class FakeClock implements CommitWidgetClock {
	time = 1_000;
	callback?: () => void;
	cleared = false;

	now(): number { return this.time; }
	setInterval(callback: () => void): ReturnType<typeof setInterval> {
		this.callback = callback;
		return { unref() {} } as ReturnType<typeof setInterval>;
	}
	clearInterval(): void { this.cleared = true; }
	tick(ms: number): void {
		this.time += ms;
		this.callback?.();
	}
}

test("renders the approved command, model, phase, count, and staged path shape", () => {
	assert.equal(shortCommitModel("openai-codex/gpt-5.6-luna"), "luna");
	assert.equal(shortCommitModel("openrouter/anthropic/claude-haiku-4.5"), "haiku");
	assert.deepEqual(
		renderCommitWidget({
			phase: "staging",
			model: "openai-codex/gpt-5.6-luna",
			stagedPaths: ["src/a.ts", "src/b.ts", "src/a.ts"],
		}, 4_240),
		["/commit  luna  4.2s", "staging  2 files", "  src/a.ts", "  src/b.ts"],
	);
});

test("repaints elapsed time and clears exactly when stopped", () => {
	const updates: Array<{ key: string; lines: string[] | undefined }> = [];
	const clock = new FakeClock();
	const widget = new CommitStatusWidget({ setWidget: (key, lines) => updates.push({ key, lines }) }, clock);

	widget.start();
	widget.update({ phase: "inspecting", model: "openai-codex/gpt-5.6-luna", stagedPaths: [] });
	clock.tick(1_250);
	widget.update({ phase: "committing", stagedPaths: ["file.ts"] });
	widget.stop();
	widget.update({ phase: "staging", stagedPaths: ["late.ts"] });
	clock.tick(1_000);

	assert.equal(updates[0].key, COMMIT_WIDGET_KEY);
	assert.deepEqual(updates.at(-2)?.lines, ["/commit  luna  1.3s", "committing  1 file", "  file.ts"]);
	assert.deepEqual(updates.at(-1), { key: COMMIT_WIDGET_KEY, lines: undefined });
	assert.equal(clock.cleared, true);
});
