import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "history-extension-home-")); process.env.HOME = home;
const { default: extension } = await import("../index.ts");
const { ledgerPath } = await import("../ledger.ts");
const piHandlers = new Map<string, (...args: any[]) => any>(); const eventHandlers = new Map<string, Set<(value: unknown) => void>>();
const pi = {
	on(name: string, handler: (...args: any[]) => any) { piHandlers.set(name, handler); }, registerCommand() {},
	events: { on(name: string, handler: (value: unknown) => void) { const set = eventHandlers.get(name) ?? new Set(); set.add(handler); eventHandlers.set(name, set); return () => set.delete(handler); }, emit(name: string, value: unknown) { for (const handler of eventHandlers.get(name) ?? []) handler(value); } },
};
extension(pi as any);
const manager = { getSessionId: () => "current", getSessionFile: () => undefined };
piHandlers.get("session_start")?.({}, { sessionManager: manager });
function run(owner: string) { const root = fs.mkdtempSync(path.join(os.tmpdir(), "history-owner-event-")); fs.writeFileSync(path.join(root, "status.json"), JSON.stringify({ runId: "run", sessionId: owner, mode: "single", state: "running", startedAt: 1 })); return root; }
const foreign = run("foreign"); pi.events.emit("subagent:child-status", { runId: "run", asyncDir: foreign }); assert.equal(fs.existsSync(ledgerPath("current")), false, "foreign ownerless event was rejected");
const owned = run("current"); pi.events.emit("subagent:child-status", { runId: "run", asyncDir: owned }); assert.equal(fs.existsSync(ledgerPath("current")), true, "authoritatively owned event was retained");
piHandlers.get("session_shutdown")?.(); fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(foreign, { recursive: true, force: true }); fs.rmSync(owned, { recursive: true, force: true });
console.log("Ownerless event ownership smoke checks passed");
