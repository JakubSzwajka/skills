# Orchestration

How to run delegated work. `AGENTS.md` holds the rules that must hold even if
this file is never read. This file holds the detail.

Written from a scan of 172 sessions and 367 child runs, 28 Aug to 9 Sep 2026.
The evidence page for that scan has been deleted. Current system map:
`~/.agents/system.html`.

## The failure this file exists to stop

The parent hands off the *looking* and keeps the *doing*. In the measured
window children made 1142 file edits and the parent made 2899. Half of all
child runs never edited anything. So the child reads twenty files, reports,
and the parent opens the same twenty files to change them.

Build sessions where children did most of the editing landed **51 edits in
150 tool calls**. Where the parent kept the editing: **28 edits in 180 calls**.
Same effort, half the output, and three times the rework.

## Ownership

Every handoff names the exact paths or area the child owns.

Once a child owns a path, you do not open it. You read the child's diff and
its evidence. If you catch yourself re-reading a file to check a child, the
brief was wrong, not the child.

- One writer per checkout. Run writers one at a time and check each result
  before starting the next.
- Concurrent writers need explicit operator approval and one isolated
  worktree each.
- Parallel fan-out is read-only by default. Every lane needs a distinct
  contribution, not a distinct phrasing of the same question.
- Name the integration owner before any lane starts. That is you.

## The brief

A brief a fresh worker can act on without asking you anything. Seven fields:

1. **Outcome** — what is true when this is done.
2. **Owned paths** — exactly what this child may change.
3. **Inputs** — context it cannot inherit. Reference stable paths rather than
   pasting content.
4. **Non-goals** — what it must not touch.
5. **Stop conditions** — when to stop and report instead of pushing on.
6. **Acceptance** — the check that decides done.
7. **Return format** — see below.

Repair an incomplete brief before launching. A child that has to guess costs
more than the time you saved writing the brief.

Task memory does not travel to a child. The child has no task log by design,
and its task tools are disabled. If it needs a fact, decision, or constraint,
the brief carries it. A brief that assumes inherited memory is a broken brief.

## The return contract

Every child returns:

- what changed, as a diff or a path list
- the commands it ran, with their output and exit codes
- what it could not do, and why

That is the evidence. You act on it. You do not re-derive it.

Large results go to a local artifact with a compact summary and its path.
Do not push a large payload back through chat.

When a lane closes, the coordinator records its run ID and artifact path in
the task log. Evidence that exists only in chat does not exist.

## After a review

A read-only reviewer never applies its own findings. Neither do you.

```
parent → reviewer   read-only, produces findings
parent → fixer      writer, owns the named files, applies the findings
parent → verifier   fresh read-only run, did not write the code
parent             integrates
```

The verifier must be a different run from the fixer. The thing that wrote the
code does not get to bless it.

Skipping the fixer lane is the single largest source of wasted context in the
scan: 68% of read-only children had their files edited by the parent
afterwards.

## Size and fan-out

Prefer few large owned lanes over many small ones.

| Handoffs in a session | Calls per file | Sessions that compacted |
| --- | --- | --- |
| 2–4 | 10.1 | 4% |
| 5–9 | 16.8 | 29% |
| 10+ | 14.7 | 68% |

After four handoffs, stop and re-plan. Say what is done, what is left, and
what one worker can own outright. A fifth child is a smell.

Compaction is the same signal. If the window compacts, re-plan before
continuing. Do not carry on with the same shape in a smaller window.

## Interrupts

A child that pauses for you is answered before anything else. Eight lanes in
the window were lost to an unanswered pause.

A child that is running needs nothing. Completion wakes you natively. Polling
status cost more context than every child answer combined.

## Routing

Provisional. Adjust from real work, not from theory.

| Task shape | Route | Candidate models |
| --- | --- | --- |
| Lookup, extraction, commands, mechanical edits | Utility, low thinking | GPT-5.6 Luna, Claude Haiku 4.5 |
| Scoped implementation, tests, routine review | Standard, medium thinking | GPT-5.6 Luna, Claude Sonnet 5 |
| Hard bugs, migrations, security, architecture | Strong, high thinking | GPT-5.6 Sol, Claude Opus 5 |
| Product intent, UX judgment, ambiguous planning, synthesis | Intent/strong, medium or high | Claude Fable 5, GPT-5.6 Sol, Claude Opus 5 |
| Independent challenge | Different-family strong | latest stable Grok or Kimi K2.5 after real-work validation |

Rules that go with the table:

- A family label means its latest stable model unless a task or a validated
  profile pins another version. Resolve the exact `provider/id` through the
  live registry before passing an explicit model. Do not silently substitute
  `preview`, `pro`, `fast`, or `batch` variants.
- Pick the cheapest model that can reliably satisfy the lane contract. Weigh
  ambiguity, risk, reversibility, and how easy the result is to verify.
- A cheap-model miss escalates a tier. It does not get retried at the same
  tier.
- For material decisions and hard reviews, get fresh independent opinions from
  different model families. Resolve disagreement with evidence, not a vote.
- Every agent inherits the parent model unless overridden, so one provider
  rate limit can stop every lane at once. Configure `fallbackModels` per agent
  in `~/.pi/agent/settings.json`.

## Integration

When lanes come back, say out loud:

- what they agree on
- what they conflict on, and which one you chose, and why
- what you rejected, and why

No child conclusion disappears without being accepted, rejected, or marked
irrelevant.

## Mechanics

For the `subagent` tool API, workflow scripts, lanes, worktrees, and
acceptance, read the `pi-subagents` skill. This file is about what to
delegate. That skill is about how to call it.

## How we will know this worked

Re-run the scan and compare against the 28 Aug to 9 Sep baseline:

- child share of file edits: **34%** with the orchestrate fragment, 15%
  without. Target above 60%.
- parent read/grep calls after a handoff that redo a child's research:
  **33%**. Target below 15%.
- calls per edit in build sessions: **4.9** with the fragment. Target near 2.7.
- sessions reading this file when they edit two or more files. Target above
  70%. Below that, the pointer in `AGENTS.md` is phrased wrong.
