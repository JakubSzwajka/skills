# delegate

A pi extension that gives one session the `delegate` tool: it runs work in other pi
sessions, and those workers report back through a handoff file and an intercom ring.
A lane runs either as a Herdr pane or as a detached headless process. Design:
`~/.agents/audit/experiments/herdr-orchestration/DELEGATE-DESIGN.md`; the transport seam:
`~/.agents/audit/experiments/subprocess-transport/SEAM-ANALYSIS-2026-09-10.md`.

## Tool surface

```ts
delegate({ action: "start", profile?, brief, name?, cwd?, model?, handoff? })
  → { lane, transport, handoff, session, pane?, pid?, logFile?,
      transitionConfirmed?: false, error? }
delegate({ action: "list" })
  → { lanes: [{ lane, profile, status, transport, contextPct, spendUsd, rang,
                handoffPresent, unread, pane, pid, logFile, session, sessionFile,
                model, handoff, ownership, owner }],
      staleTransports?: ["herdr: …"] }
delegate({ action: "read", lane })   → { status, handoffPresent, handoff, body }
delegate({ action: "wait", lanes?, timeoutMs? })  → blocks until one lane settles
delegate({ action: "stop", lane })   → kills the process group, closes the pane, deregisters
```

The tool owns three things the caller must never write: the appended worker return
contract, the assigned handoff path, and the doorbell line naming the parent session.
If a worker needs a decision, the contract tells it to ask the orchestrator through
intercom and wait for the reply. The orchestrator answers the question directly instead
of forwarding it blindly.

## Files

- `index.ts` — registration, timer, turn-end nudge, doorbell correlation, load guards
- `widget.ts` — widget layout, theme painting, the incremental transcript reader
- `delegate.ts` — the five actions, profiles, handoff reads, the registry refresh
- `runners/herdr.ts` — the pane transport; every herdr call in the extension lives here
- `runners/subprocess.ts` — the headless transport: detached spawn, ps witness, group kill
- `runners/support.ts` — the few primitives both runners and the service share
- `registry.ts` — `~/.pi/agent/delegate/<parent>/lanes.json`, atomic write behind a lock dir
- `types.ts` — records, the `LaneRunner` port, the status sort key
- `delegate.test.ts` — `node --experimental-strip-types delegate.test.ts`

## Transports

A lane runs through one `LaneRunner`: `liveNames`, `spawn`, `probe`, `settle`, `kill`.
`probe` takes the whole lane list and answers with a map, because a pane probe is one
`agent list` plus one `pane list` for every lane at once and a headless probe is one `ps`
for every pid at once. A per-lane signature would push the pane model onto both.

`transport` is a field on a profile, defaulting to `herdr`, and **only the operator sets it**. There
is no `transport` argument on `start`; a call that names one is refused, not quietly obeyed. The
choice decides whether a worker runs where the operator can see it, which is theirs to make. `model`
is the deliberate opposite: it stays overridable per call, because matching a model to a lane's
difficulty is the orchestrator's job and `ORCHESTRATION.md` tells it to do that. The herdr path is
unchanged: a split pane, an interactive pi agent, the brief delivered as a prompt.

A `subprocess` lane is a detached `pi --print` with its stdout and stderr appended to
`lanes/<lane>/worker.log`. Its session id is assigned before it starts and passed with
`--session-dir` and `--session-id`, so the transcript is findable and context use and spend
read exactly as they do for a pane. The brief and its contract go in as one argument, not as
keystrokes, so there is no pane-busy retry and no unconfirmed transition. `PI_DELEGATE_ROLE=child`
goes into the environment, so depth stays 1. Session-scoped variables of the parent
(`PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_INTERCOM_SESSION_ID`, `PI_MODEL`, …) are stripped so a
nested pi never reports its parent's state, and so is the whole `HERDR_` set (`HERDR_ENV`,
`HERDR_PANE_ID`, `HERDR_SOCKET_PATH`, `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID`), because a headless
worker has no pane, no tab and no workspace of its own.

Liveness needs two witnesses. Records live for 24 hours and pids get reused, so the lane also
records the process start time `ps` reports and compares it on every probe. `stop` signals the
process group, `SIGTERM` then `SIGKILL`; there is no pane to close.

A probe has three answers, not two, and the third one is why a wedged worker cannot be lost:

- **Ours.** The pid is listed and its start time matches the record. Status `working`, or `blocked`.
- **Gone.** `ps` answered and the pid is free, or it is held by a process that started at another
  time. Status `done`, and the record stays open so the handoff can still be read.
- **Unproven.** `ps` could not be read, or the record carries no start time. Status `unknown`:
  `stop` refuses to signal and says so, `wait` times out rather than reporting `done`, and nothing
  closes the record. A group signal to a pid that may have been recycled would kill a stranger's
  process group, so the operator is handed the pid, the log and the `kill -TERM -<pid>` instead.

`ps` is asked with `LC_ALL=C`, because `lstart` is locale-formatted and the same process reads as
`Thu Sep 10 19:43:39 2026` or `Do. 10 Sep. 19:43:39 2026` depending on the parent's `LANG`. A
witness recorded under another locale still matches: when the strings differ, the digits decide.
A pid no kernel could hand out is dropped when the registry loads, and a batch `ps` that fails as a
whole is retried one pid at a time, so one corrupt entry costs only its own lane.

What the headless transport gives up, on purpose:

- **No `idle` distinct from `done`.** A print-mode worker runs or has exited.
- **No eyes on the lane.** No `lucy show`, no `lucy steer`. The output is a log file.
- **`blocked` only for an intercom ask.** The one blocking event a parent can observe is an
  inbound ask carrying `expectsReply`, which already arrives in the parent's own entries. The
  lane clears itself when its transcript grows more than 3 seconds after the ask, which is the
  reply landing. Anything else that could stall a worker is invisible.
- **Project-local extensions, skills and settings.** Non-interactive pi never prompts for
  trust, so under `defaultProjectTrust: "ask"` those resources are silently skipped.
- **Nothing watches it.** A wedged headless lane burns tokens until someone runs `list`.

## Widget

A widget above the editor lists one row per lane: a one-character gutter mark, the lane name, its
profile, its model, status, context use, spend, and a note. A muted rule in the theme's `dim` color
tops the block, so the lanes do not read as the tail of whatever widget sits above them. There is no
bottom rule and no side border, and a hidden widget draws no rule.

```
 ──────────────────────────────────────────────────────────────────
 delegate  1 live · 3 done · 1 needs you · $12.30
     scout-drift    scout   gpt-5.6-luna      working  28% ctx  $0.90
     widget-fix     worker  gpt-5.6-sol:high  done     —        $3.20  read
     transport      worker  gpt-5.6-sol:high  done     —        $6.30  read
   • page-lucy      worker  gpt-5.6-sol:high  done     —        $1.90  unread handoff
```

Live lanes come first, in the order that puts what needs the operator on top. Finished lanes follow,
dimmed, oldest first, so a lane that closes appends to the bottom instead of shoving the rows already
on screen down by one. The header counts live lanes, finished ones, how many still need the operator,
and the session's whole bill across both groups, so closing a lane never makes the spend look smaller
than it was.

Column widths come from the data, and every text column is clipped: a lane name at 24 characters, a
profile at 10, a model id at 24. No id and no name can push the status or the note sideways. The
model is shown without its provider prefix, which is the same on every lane and buys nothing:
`openai-codex/gpt-5.6-sol:high` reads as `gpt-5.6-sol:high`, and a bare dotted id keeps its own shape
until it hits the limit.

Rows that need the operator are the loud ones. `blocked` paints its mark, status, and `needs you` in
the theme's error color and bold; an unread handoff uses the warning color, and keeps it after the
lane closes, because an uncollected handoff is still work that has not reached anyone. A finished
lane that was collected reads `read`; one that never produced a file reads `no handoff` rather than
claiming otherwise. Colors always come from the theme passed to the component factory, never from a
literal escape, so a theme switch repaints. A color the theme rejects costs that cell its color, not
the widget.

A finished lane stays for the rest of the session, not for the life of the registry. The registry
drops a closed record 24 hours after it closed, so the widget keeps its own memory of the lanes this
session finished with, keyed by lane name plus start time so a reused name cannot inherit an older
lane's row. A pruned record therefore does not make a row vanish mid-session, and the row keeps the
last spend figure its transcript ever reported. A closed lane is only shown when this session owns
it: ownership, not the working directory, is the test, or a second orchestrator in the same checkout
would leave dimmed rows for lanes this session never ran. An adopted lane has had its ownership
rewritten to this session, so it counts as ours once we are the one who closed it.

Empty now means no lane at all, live or finished. A session that never delegated shows nothing, and
once a lane exists the widget stays for the rest of the session.

Context use comes from the model registry's window for the lane's model. The transcript carries no
window of its own, so a registry miss shows `— ctx` while spend keeps counting. A finished lane shows
`—` there instead: its context use is history nobody can act on, while its bill is not.

A 1.5 second timer keeps the numbers moving during a long turn, instead of freezing them between
turn boundaries. Most ticks spawn nothing: they read the registry files and only the bytes each
worker transcript grew by, then skip the repaint when nothing an operator can see has changed.
Every fourth tick, and only while a lane that can still move is on screen, also asks each transport in
use for its statuses, which is ~2 herdr calls per 6 seconds for pane lanes and one `ps` for headless
ones. A screen with nothing but finished rows asks nobody anything.
That sync is `refreshStatus`, which writes statuses back to the registry and stops there; `list`
additionally re-reads every handoff and every transcript, and the widget does not need it. A failing herdr keeps that rate: the
tick counter is spent before the call, not after it. The timer starts at `session_start`, never in
the extension factory, and it starts even when the startup adopt or refresh fails, because the timer
is the only retry path the widget has. `session_shutdown` clears the timer and the widget, and a
tick that was already in flight drops its repaint instead of putting the cleared widget back.

## Profiles

`~/.agents/pi/delegate/profiles.json`, keyed by name, each with `model` and optional
`readOnly`, `tools`, and `excludeTools`. `readOnly` becomes `--exclude-tools edit` and
keeps `write`, because a worker without `write` cannot produce a handoff. A missing or
malformed file falls back to built-in profiles (worker, scout, reviewer, oracle) and says
so in the tool result. Every built-in profile excludes `ask_user_question` on purpose, so
a worker cannot stall in a dialog that nobody may be watching. The reviewer and oracle
fallbacks use `anthropic/claude-opus-5`; worker and scout keep their existing models. A
profile may also carry `transport`, which is the only place a transport can be set. There is no
automatic provider-failure retry.

## Safety

- A worker runs with `PI_DELEGATE_ROLE=child`, and the extension registers nothing when
  that variable is set. Depth is 1 by construction, on both transports.
- Without `HERDR_ENV=1` or the `herdr` binary, only the pane transport refuses, and it says
  so in its own words. Headless lanes still start, list, read, wait and stop, even when a pane
  lane sits in the same registry: a transport that cannot be reached costs its own lanes their
  fresh status, which `list` reports as `staleTransports`, and nothing else. Such a lane is never
  closed by the refresh either, because an unreachable transport says nothing about its lanes.
- The registry entry is written before any pane or process exists, so a failed spawn leaves an
  addressable lane instead of an orphan. Once the lane has a home, `start` returns it even if
  the runner could not finish; for a pane that not-confirmed case sets `transitionConfirmed`
  to `false`.
- Registry files are not created for sessions with no lanes. Pruning the final lane removes
  the empty file and its directory when no handoff files remain.
- Each lane records its parent process. A new session adopts it only after that process is
  confirmed gone. Lanes with a live or unknown parent stay visible in `list` with
  `ownership: "other-parent"`, but cannot be read, waited on, or stopped by that session.
