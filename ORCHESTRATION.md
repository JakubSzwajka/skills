# Orchestration

How to run delegated work. `AGENTS.md` holds the rules that must hold even if
this file is never read. This file holds the detail.

Delegation runs on the `delegate` tool. A worker is a separate pi session, running
either in a herdr pane beside you or as a detached headless process. There is no
pi-subagents. Rollback plan and the reason for the switch:
`audit/experiments/herdr-orchestration/SETUP.md`. Tool design:
`audit/experiments/herdr-orchestration/DELEGATE-DESIGN.md`. The transport seam:
`audit/experiments/subprocess-transport/SEAM-ANALYSIS-2026-09-10.md`.

Written from a scan of 172 sessions and 367 child runs, 28 Aug to 9 Sep 2026,
plus a full-day measurement of 9 Sep. Evidence: `audit/FINDINGS-2026-09-09.md`
and `audit/baselines/2026-09-09-orchestration-latency.json`.

## The failure this file exists to stop

The parent hands off the *looking* and keeps the *doing*. In the measured
window children made 1142 file edits and the parent made 2899. Half of all
child runs never edited anything. So the child reads twenty files, reports,
and the parent opens the same twenty files to change them.

Build sessions where children did most of the editing landed **51 edits in
150 tool calls**. Where the parent kept the editing: **28 edits in 180 calls**.
Same effort, half the output, and three times the rework.

## The second failure, measured 9 Sep

Delegation ran, and it ran in a queue. Across 18 sessions the parallelism
factor was **1.0 to 1.43**. Two sessions were exactly 1.000, meaning no two
workers ever overlapped. **47% of active session time had no worker running at
all.** Calling something a fan-out does not make it one.

`delegate start` returns immediately and never blocks, so a queue is now a
choice you have to make on purpose. Before starting a second lane, say what the
first one owns and why the second cannot collide with it. If you cannot answer,
you have one lane.

## The loop

```
delegate start   →  a pane splits beside you, or a headless pi starts with no terminal
   (returns at once, you keep working or answer the operator)
worker writes its handoff file
worker rings you through intercom  →  your turn fires
delegate read    →  the handoff body
you verify       →  tests, git status, your own eyes
delegate stop    →  process group killed, pane closed if there is one, lane deregistered
```

Four tool actions, no polling, no guessing how long work takes.

## Two transports

`transport` is a field on a profile, and **only the operator sets it**. It defaults to
`herdr` (`pi/extensions/delegate/types.ts:13`, `pi/extensions/delegate/delegate.ts:164`). No profile in
`pi/delegate/profiles.json` sets it, so every lane is a pane unless the operator changes one.

There is no `transport` argument on `start`. Naming one is refused with an error, because
the choice decides whether the operator can watch a worker at all, and that is not yours
to take from them. If a lane genuinely needs to outlive the session, say so and ask for a
profile; do not look for a way around it.

`model` is the deliberate opposite. It stays overridable per call, because matching a model
to a lane's difficulty is your job and this file tells you to do it. One choice is about
the work, the other is about whether the human can see the work.

| | `herdr` | `subprocess` |
| --- | --- | --- |
| what it is | a split pane running interactive pi | a detached `pi --print`, no terminal |
| can you look at it | yes, it is on your screen | no, its output is `lanes/<lane>/worker.log` |
| statuses it can report | idle, working, blocked, done, unknown | working, blocked, done, unknown |
| outlives this session | the pane does | the process does |
| something watches it | you and the widget | nothing |

Everything else is shared. Same registry, same assigned handoff, same intercom ring,
same return contract, same depth-one guard. `PI_DELEGATE_ROLE=child` goes into the
headless environment too (`pi/extensions/delegate/runners/subprocess.ts:227`), so a headless worker cannot
delegate either.

What a headless lane costs you, on purpose:

- **`idle` and `done` collapse.** A print-mode worker runs or has exited. There is no
  state that means "finished its turn and waiting".
- **Nothing watches it.** A wedged headless lane burns tokens until you run `list`.
  A wedged pane at least sits in front of you.
- **`blocked` narrows to one cause.** It is set only when an intercom ask carrying
  `expectsReply` reaches you (`pi/extensions/delegate/delegate.ts:110-111`), and it clears itself when the
  worker's transcript grows more than 3 seconds after the ask
  (`pi/extensions/delegate/runners/subprocess.ts:13`). Any other stall is invisible.
- **Project-local extensions, skills and settings are skipped.** Non-interactive pi
  never prompts for trust, and `defaultProjectTrust` defaults to `ask`, which ignores
  those resources (pi `docs/settings.md:16`). A lane that needs a repo's own skill
  needs a pane.

What it buys: the worker survives the session that started it, and a fresh session
adopts it once the old parent's process is confirmed gone (`pi/extensions/delegate/delegate.ts:76-81`). It also
runs where there is no herdr at all. Without `HERDR_ENV=1` or the binary, only the
pane transport refuses; headless lanes still start, list, read and stop, and
`list` names the transport it could not reach as `staleTransports`.

Give a lane a pane when you may want to look at it, when it uses project-local skills
or extensions, or when it is the one thing you are doing. Headless suits work that must
outlive this session, or a screen panes would crowd. Neither is your call per lane: it
follows from the profile you pick, so say which profile you chose and why.

## Ownership

Every brief names the exact paths or area the worker owns.

Once a worker owns a path, you do not open it. You read its diff and its
evidence. If you catch yourself re-reading a file to check a worker, the brief
was wrong, not the worker.

- One writer per checkout. Run writers one at a time and check each result
  before starting the next.
- Concurrent writers need explicit operator approval and one isolated checkout
  each. There is no automatic worktree; create it yourself and pass it as `cwd`.
- Parallel lanes are read-only by default. Every lane needs a distinct
  contribution, not a distinct phrasing of the same question.
- Two lanes in **separate repositories** are safe to run together. Watch for
  shared surfaces that are not files: a CLI one lane is editing is a CLI the
  other lane must not call.
- Name the integration owner before any lane starts. That is you.

## Profiles

`pi/delegate/profiles.json`. A profile is a model plus a tool policy. The file
exists; if it is ever missing or malformed the tool falls back to built-in profiles and
says so in its result.

| Profile | For | Policy |
| --- | --- | --- |
| `scout` | lookup, extraction, comparing docs to code | readOnly |
| `worker` | scoped implementation, tests, fixes | full |
| `reviewer` | audit, verification, adversarial reading | readOnly |
| `oracle` | architecture, hard judgement calls | readOnly |

`readOnly` becomes `--exclude-tools edit` and **keeps `write`**, because a worker
that cannot write cannot produce a handoff. That was a real bug in this file.

Every profile also excludes `ask_user_question`, so a worker cannot stall in a dialog
nobody is watching. A profile may carry `transport`; none does today, and only the operator
can add it.

`reviewer` and `oracle` run `anthropic/claude-opus-5`. On 9 Sep that endpoint returned
14 consecutive 429s from 17:18 onward and every review silently fell back to one model
family. There is no automatic retry on a provider failure, so a review that dies on a
429 is yours to notice and restart.

Model routing from the pi-subagents era is preserved at
`audit/experiments/herdr-orchestration/snapshot/subagents-model-routing.json`. The
`subagents` block still in `~/.pi/agent/settings.json` is that same history and is read by
nothing.

Override the model per call when a lane deserves better or cheaper. Prefer the
cheapest model that can satisfy the lane, and escalate a miss rather than
retrying it at the same tier. For material judgement, use a different model
family from the one that produced the work.

## The brief

A brief a fresh worker can act on without asking you anything:

1. **Outcome** — what is true when this is done.
2. **Owned paths** — exactly what this worker may change.
3. **Inputs** — context it cannot inherit. Reference stable paths rather than
   pasting content.
4. **Non-goals** — what it must not touch.
5. **Stop conditions** — when to stop and report instead of pushing on.
6. **Acceptance** — the checks that decide done, and their exit codes.

`/spec` mounts one whole central spec to the master session. The spec-link extension
returns before it registers anything for delegate children
(`pi/extensions/spec-link/index.ts:29`), so children neither inherit nor discover that
mount. Read the relevant spec and ticket material yourself, then put the needed intent,
constraints, and acceptance checks directly in a self-contained brief. Do not tell a
child to inspect the whole central spec.

A research or prototype child may receive one exact owned artifact path under the
mounted spec's `research/` or `prototypes/` directory. This is an output contract, not a
mount. For other work, name only the specific inputs the child needs and include enough
content that it can act without the master's session context.

The tool appends the seventh part itself: the return contract, the assigned handoff path,
and the doorbell line. **Never write the contract or the doorbell.** You forgot the
doorbell twice before the tool owned it. The handoff path can be overridden when the
artifact has an exact final destination, such as one file under the mounted spec's
`research/` or `prototypes/` directory, or a repository atlas page. A hand-typed path
cost a lane its whole budget on 9 Sep, so check its parent exists first.

Two more rules bought with real losses:

- **Never paste a path you have not checked.** One typo, a slash instead of a
  dash, cost a reviewer 33 reads, 27 `ls`, 7 `find`, and then a deadline kill.
  Verify a path exists before it enters a brief, and tell the worker to fail
  fast rather than search.
- **Warn about shared surfaces.** If another lane is editing something this lane
  might invoke, say so.

## The return contract

The handoff file is the result. `delegate read` returns its body and marks it
read. It holds:

- what changed, as a diff summary or a path list
- the commands it ran, with exit codes
- what it could not do, and why
- what was already dirty before it started
- durable event candidates for the mounted spec, when the work found any

A child never writes the spec log. After reading the handoff, the master may use
`spec_log_append` for a durable approval, rejected alternative, material discovery or
scope change, verifier outcome, completion, or reopening. Routine handoffs, tool calls,
test runs, generated files, and ticket boxes do not belong in that log.

You read the file. You act on it. You do not re-derive it. **A lane that rang
without writing its file has failed**, whatever the terminal says.

Keep it short. Over about 60 lines means the work should have been two lanes.

## Verify it yourself

The worker's handoff is a claim. Before you accept a lane:

- run the tests and the checks yourself, after the last mutation
- `git status --short`, and confirm only owned paths moved
- for a review lane, spot-check one finding against the file it names

On 10 Sep two audit lanes found 14 real defects in the orchestration docs, all
of them mine. Workers are good at catching the orchestrator. Give them the
chance, and use a fresh session that did not write the code.

## After a review

A read-only reviewer never applies its own findings. Neither do you.

```
you → reviewer   readOnly profile, produces findings in its handoff
you → fixer      writer, owns the named files, applies the findings
you → verifier   fresh lane, did not write the code
you              integrate
```

Skipping the fixer lane is the single largest source of wasted context in the
scan: 68% of read-only children had their files edited by the parent afterwards.

## Size and fan-out

Prefer few large owned lanes over many small ones.

| Handoffs in a session | Calls per file | Sessions that compacted |
| --- | --- | --- |
| 2–4 | 10.1 | 4% |
| 5–9 | 16.8 | 29% |
| 10+ | 14.7 | 68% |

After four lanes, stop and re-plan. Say what is done, what is left, and what one
worker can own outright. A fifth lane is a smell.

Compaction is the same signal. If the window compacts, re-plan before
continuing.

## Watching, blocking, and death

`delegate list` and the widget show every live lane: status, context used, spend,
whether it rang, whether its handoff is unread.

- **`blocked` is the most expensive state on the board.** It means the worker hit
  an approval or a question. Eight lanes in the older window were lost to an
  unanswered pause. Answer it before anything else.
- **Intercom is the only completion wake.** A worker rings after writing its
  handoff. Use `read`, verify the result, then use `stop`. Do not poll with `list`.
- **There is no deadline.** Nothing kills a runaway worker, which is the point:
  on 9 Sep, 11 runs were killed mid-edit and returned nothing, about 250
  minutes. The cost is that a stuck lane is yours to notice. Watch the widget.
- **Do not poll.** Polling cost more context than every worker answer combined.
  The ring is the wake.

The widget repaints on a 1.5 second timer rather than at turn boundaries
(`pi/extensions/delegate/index.ts:17-18`), so the numbers move while you work. Most ticks
read files only; every fourth one asks the transports for statuses, and only while a lane
that can still move is on screen.

Each row also names the lane's model, and a lane you stopped stays on the list, dimmed,
for the rest of the session, with its final spend and whether its handoff was collected.
That is your own history: use it in the integration report instead of guessing what a
closed lane cost. An unread handoff stays loud after the lane closes, because it is still
work nobody has read.

### When a lane reads `unknown`

`unknown` means nothing proved the lane alive and nothing proved it dead. A headless
lane reads `unknown` when `ps` could not be read or the record carries no process start
time (`pi/extensions/delegate/runners/subprocess.ts:154-156`). A pane lane reads `unknown` when the pane is there
but herdr lists no agent in it (`pi/extensions/delegate/runners/herdr.ts:77`).

The tool then does nothing on your behalf, which is deliberate. The record stays open,
and `stop` on a headless lane refuses to signal and hands you the pid, the log path and
the `kill -TERM -<pid>` to run yourself.
Signalling a pid that may have been recycled would kill a stranger's process group.

Nothing nags about this state, so it is on you to check the widget. Open the log or the
pane and decide whether that process is your worker. If it is, kill it by hand. If it
already exited, the record closes itself the next time `ps` answers. Until you know,
do not start a replacement lane on the same paths: an `unknown` lane may still be
writing them.

A lane survives its orchestrator on both transports. The registry is a file, so a fresh
session adopts live panes and live headless processes rather than orphaning them, and
it only claims them after the previous parent's process is confirmed gone.

## Mechanics

```ts
delegate({ action: "start", profile: "scout", brief: "…", cwd?, name?, model?, handoff? })
  → { lane, transport, handoff, session, pane?, pid?, logFile? }   returns immediately

delegate({ action: "list" })
  → { lanes: [{ lane, profile, status, transport, contextPct, spendUsd, rang,
                handoffPresent, unread, pane, pid, logFile }], staleTransports? }

delegate({ action: "read", lane })          → { status, handoffPresent, handoff, body }
delegate({ action: "stop", lane })          → kills the process group, closes the pane, deregisters
```

There is no `steer`. The tool cannot correct a worker mid-flight. If a lane is
going wrong, stop it and start a new one with a better brief.

Full reference including profiles and failure modes:
`pi/extensions/delegate/README.md`.

## Integration

When lanes come back, say out loud:

- what they agree on
- what they conflict on, and which one you chose, and why
- what you rejected, and why

No worker conclusion disappears without being accepted, rejected, or marked
irrelevant. When you overrule a worker, say what evidence decided it.

## How we will know this worked

Compare against the 28 Aug to 9 Sep baseline and the 9 Sep day:

- child share of file edits: **34%**. Target above 60%.
- parent read/grep calls after a handoff that redo a worker's research: **33%**.
  Target below 15%.
- calls per edit in build sessions: **4.9**. Target near 2.7.
- work lost to a kill or a lost return: **about 250 minutes on 9 Sep**. Target
  zero, since nothing kills a pane and the registry cannot orphan one.
- parallelism factor: **1.0 to 1.43**. Target above 2.0 on any session with
  three or more lanes.

`audit/tools/analyze.py` reads pi-subagents artifacts, which delegate lanes do not
produce, so levels 1, 2, 3 and 5 are blind during this trial. Both transports still
write ordinary pi session logs, so the data exists and the tool can be pointed at it.
