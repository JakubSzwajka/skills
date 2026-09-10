# Subprocess transport for delegate — verdict

**MODERATE, and I would not build it yet.** The load-bearing risk clears: a print-mode pi with no pane connects to the intercom broker and sees peers (verified: `env PI_DELEGATE_ROLE=child pi -p '…intercom status…'` returned `Connected: Yes / Session ID: 01a08c18-… / Active sessions: 5`; registration needs no pane — `pi-intercom/index.ts:872-880` makes `tmuxPane` optional). So the ring, the handoff, the registry and the contract all survive. What does not survive is "everything it does today": `blocked` disappears, `idle` vs `done` collapses, nobody can look at the lane, and project-local resources go silently unloaded. The plumbing is also not a small swap, because `pi.exec` (`index.ts:26`, `types.ts:41`) runs to completion and a lane must outlive the call — so a second spawn primitive arrives, and `delegate.test.ts:24` ("the service only ever shells out to herdr") and all 15 tests get rewired. ~450 net new lines for a mode that is observably worse at the one state doctrine calls most expensive.

Stop condition cleared: `pi -p` supports `--tools/-t`, `--exclude-tools/-xt`, `--model`, `--thinking`, `--name`, `--session-dir`, `--session-id` (`README.md:545,585-592`, `pi --help`). The brief goes in as argv, not a keystroke — that is strictly easier than `agent prompt --wait` and deletes the `agent_pane_busy` retry (`delegate.ts:216-226`) and `transitionConfirmed`.

## 1. The seam — one interface, if `probe` is batched

Herdr call sites in `delegate.ts`: `herdr()` 430, `listAgents()` 419, `listPanes()` 424, `start()` 168-208 (split, `awaitAvailableShell` 212, `startAgent` 229, `agent prompt` 190), `waitOne()` 279, `waitArguments()` 487, `stop()` 300-321 (`terminatePaneProcess` 325), `refresh()` 366, name collision 137. Plus `unavailable()` in `index.ts:34-38`.

```ts
interface LaneRunner {                                        // runners/{herdr,subprocess}.ts
  liveNames(signal?): Promise<Set<string>>;                   // name collision
  spawn(spec: LaneSpec, signal?): Promise<LaneHandle>;        // create + deliver brief
  probe(lanes: LaneRecord[], signal?): Promise<Map<string, LaneObservation>>;  // batched
  settle(lane, timeoutMs, signal): Promise<Settled | "timeout">;
  kill(lane, signal?): Promise<{ gone: boolean; warnings: string[] }>;
}
```

`probe` is the only place it warps: herdr wants one global join keyed by pane (`refresh()` builds `byPane`, 368), a subprocess wants per-lane pid checks. The batched `lanes[] → Map` signature absorbs both. Keep the per-lane shape and you get a leak. Config key: add `transport?: "herdr" | "subprocess"` to `DelegateProfile` (widen `isProfile`, `delegate.ts:565`; default `herdr`), overridable per call. Per-profile beats a global file — a scout can go headless while a worker keeps a pane.

## 2–4. What the adapter can and cannot see

Verified: `--session-dir /tmp/lane-probe` put exactly one `.jsonl` there, growing mid-run (6 lines while a `sleep 20` was still running), and `--session-id 01a08c19-dead-…-001` was honored verbatim in the filename. Its assistant entries carry `usage.totalTokens` and `usage.cost.total`, the exact shape `sessionStats` parses (`delegate.ts:502-520`). So **status-ish, ctx %, spend, ring and unread all still work**: pre-assign the id, glob the lane's own session dir, done. `contextWindow` is null in the file but the model-registry fallback (`index.ts:41-50`) already covers that, same as panes.

- **`blocked` is genuinely lost.** No entry type in `docs/session-format.md:187-305` represents a pending approval or question. Print mode supplies a no-op UI (`pi-intercom/index.ts:763`) and every profile already excludes `ask_user_question` (`delegate.ts:10-13`), so a subprocess lane cannot reach the pane `blocked` state at all. Partial recovery for free: the parent already parses inbound intercom entries (`intercomRings`, `delegate.ts:465-482`) and the persisted `details.message` carries `expectsReply` (`pi-intercom/types.ts:56`, set at `index.ts:1987,2459`) — an ask *is* the blocked event, arriving at the parent without polling. Unverified: I never observed a live `intercom_message` entry, only the code that writes one. Everything that is not an intercom ask is unrecoverable.
- **`idle` vs `done` collapses** to exit code; `wait --until idle` (`delegate.ts:488`) becomes "process exited". `lucy steer <lane>` (ORCHESTRATION.md) dies for these lanes — a print-mode session cannot be steered.
- **`stop`** is simpler: `process.kill(-pgid)` on the recorded pid, no `pane process-info`, no `pane close`, no "stop left pane behind".
- **Adoption is weaker.** Today liveness comes from a herdr daemon that outlives the parent (`agent list`). A subprocess needs `detached: true` and stdio to files or it dies with the parent's terminal, and `processAlive(pid)` (`delegate.ts:583`) is unsound against pid reuse across the 24h retention (`CLOSED_RETENTION_MS`, `delegate.ts:7`). Needs a second witness: process start time, or session-file mtime.
- **Depth-one gets easier**, not harder: `PI_DELEGATE_ROLE=child` goes straight into `spawn`'s env instead of two `--env` flags (`delegate.ts:171`); the guard at `index.ts:19` is untouched.

## 5. File-by-file cost

| File | Change | Lines |
| --- | --- | --- |
| `types.ts` | `LaneRunner`/`LaneSpec`/`LaneHandle`/`LaneObservation`, `LaneRecord.pid`+`logFile`, `profile.transport` | +35 |
| `registry.ts` | persist and validate `pid`, `logFile` in `toLane` | +6 |
| `delegate.ts` | move every herdr call out; rewrite `start`, `refresh`, `stop`, `waitOne` against the port | −150 / +90 |
| `runners/herdr.ts` | new, mostly moved code | +200 |
| `runners/subprocess.ts` | new: detached spawn, session-dir, log files, pid+start-time probe, settle on exit or handoff watch | +160 |
| `index.ts` | transport-aware `unavailable()`, pass the spawn primitive, widget with no pane | +25 |
| `delegate.test.ts` | rewire the fake at :24 and every case block; add subprocess tests | +180 |
| `README.md`, `ORCHESTRATION.md` | document the lost states | +40 |

≈700 lines touched, ~450 net new, 7 files, 2 new.

## What subprocess mode silently loses — accept or reject

1. [ ] `blocked` as a widget state. Only intercom asks are recoverable, and only via the parent's own entries.
2. [ ] Eyes on a lane. No pane, no `lucy show`, no `lucy steer`. Output is a log file someone must open.
3. [ ] `idle` as distinct from `done`.
4. [ ] Project-local extensions, skills and settings. `docs/security.md:29`: non-interactive modes never prompt and, under `defaultProjectTrust: "ask"`, ignore those resources. A pane worker loads them; a subprocess worker does not, and says nothing. Fixing it means passing `-a`, which is a security decision, not a flag.
5. [ ] Sound liveness after the parent dies, unless a start-time witness is added.

## The one thing most likely to make this fail

Nothing watches it. Herdr's deliberate absence of a deadline (ORCHESTRATION.md, "There is no deadline") leaned entirely on the operator seeing a pane go still. A headless lane that wedges — an auth prompt, a 429 loop like the 17:18 run on 9 Sep, a model that never calls `write` — burns tokens invisibly until the parent happens to run `list`. That is the same blindness that cost about 250 minutes on 9 Sep, minus the pane that would have caught it.
