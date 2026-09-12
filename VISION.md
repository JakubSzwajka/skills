# Vision

What this repository is building, so that later decisions can be checked against it.

This file states intent. It is not a description of what works today. Where the
two differ, the gap is named in "Where we are now".

## The one rule

The human talks to one agent. That agent talks to the workers.

```
you  ──►  orchestrator  ──►  engines
          (this conversation)  (parallel sessions)
```

You never join a worker's session. You never read its terminal to find out what
happened. If something needs your judgement, it reaches you through the
orchestrator, in your conversation, in plain language.

That boundary is the product. Everything below serves it.

## The layers

```
  intent      you and the orchestrator decide what to build
     │        specs, tickets, trade-offs, approvals
     ▼
  record      what was decided, and why
     │        specs, tickets, decision log
     ▼
  execution   engines do the work in parallel
              implement, review, research, verify
```

**Intent.** You and the orchestrator argue about the problem. The orchestrator
pushes back, offers options, and names risk. You approve. Nothing is built from
a guess.

**Record.** The approved shape lives under
`~/.pi/specs/<YYYY-MM-DD>_<feature-slug>/`. `spec.json` holds schema version 1,
the title, and the `pending` or `done` lifecycle state. `SPEC.md` holds the
human intent. `USER_STORIES.md` and the `tickets/`, `research/`, `prototypes/`,
and `log/` directories appear only when used. `/to-spec` and `/to-tickets`
create this record. The append-only log keeps durable approvals, amendments,
rejected alternatives, material discoveries, verifier outcomes, and lifecycle
changes.

**Execution.** The orchestrator delegates to engines: separate sessions, each
with a brief, each owning named paths. They run in parallel where the work
allows it. They return a handoff file and ring back. The orchestrator verifies,
integrates, and reports. The master alone mounts the spec. Every child receives
a self-contained brief and never has to discover the central record.

Ticket boxes and blockers can guide this execution, but they do not control the
spec lifecycle. Only `/spec:status pending|done` changes that state.

## Engines, not subagents

An engine is a full session with its own model, context, and tools. It is not a
function call that blocks the parent.

- **Two-way.** An engine can ask the orchestrator a question mid-flight. The
  orchestrator answers it. The human is only pulled in when the orchestrator
  genuinely cannot decide.
- **Steerable.** The orchestrator can correct an engine while it works, rather
  than waiting for a wrong result and paying for the rerun.
- **Parallel by default.** Work that does not collide runs at the same time.
  Serial execution is a choice, not the shape of the tool.
- **Visible.** Cost, context use, and state are on screen while the work runs.

Intercom carries the messages. The handoff file carries the result.

## Triggers

Today one thing starts work: you type.

The system should also start work on its own signal. A Sentry alert, a failed
deploy, a webhook, a schedule. The orchestrator then does what it would do for
you: research the cause, draft the spec, delegate the fix, verify it, and report
back in the conversation.

Autonomy grows on that axis. Not "the agent decides alone", but "the agent
starts without being asked, and still ends in your conversation".

## Where we are now

Honest state, so the gap stays visible.

| Piece | State |
| --- | --- |
| Human-to-orchestrator boundary | holds in practice |
| Delegation to parallel sessions | works: `delegate`, in a Herdr pane or as a detached headless process |
| A lane that outlives the session that started it | works: the headless transport; a fresh parent adopts and stops it |
| Ask the orchestrator mid-flight | works: intercom, contract-enforced |
| Cost and state on screen while work runs | works for panes: the widget, on a 1.5 s timer. A headless lane shows the same numbers but nothing watches it |
| Steer a running engine | not in the tool. Stop the lane and start a better-briefed one |
| Central specs and tickets | works: `/to-spec` creates the central record, `/to-tickets` writes local tickets, and `/spec` mounts one whole spec to the master session |
| Spec lifecycle | works: `pending` and `done`; `/spec` lists all pending specs plus done specs from the last 72 hours, while a mounted spec stays mounted regardless of age |
| Durable work log and decision record | works: `/spec:log:append` for the operator and `spec_log_append` for the master each create one immutable Markdown entry |
| Automatic triggers | missing |
| Evidence linking a lane back to intent | works through self-contained briefs and handoffs; delegate children never inherit or discover the master's spec mount |
| Cross-project view of what is running | deliberately outside this repo; it is your terminal tool, not an agent surface |

## How to use this file

Before a change, ask which layer it serves and which gap it closes. A change
that serves none of them needs a reason.

Two failure modes to watch:

1. **Adding a mechanism the human has to operate.** If a change means you must
   watch a pane, open a log, or chase a worker, it broke the one rule.
2. **Losing the record.** Work whose reasoning survives only in a chat window is
   work that will be redone.
