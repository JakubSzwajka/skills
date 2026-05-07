---
name: work-unit-processor
description: >
  Iterate a repo-local work-unit plan one unit at a time. Reads
  docs/tasks/active/<task-id>/, picks the next runnable work unit, delegates to
  the configured flat task-force agent, verifies/reviews, updates artifacts, and
  stops. Use when the user says work-unit processor, process work units, run next
  work unit, iterate the plan, or Ralph loop.
user-invocable: true
argument-hint: [task-id]
---

# Work Unit Processor

Execute exactly one runnable work unit, then stop.

This is a new dedicated processor. Current `pipeline` stays as-is.

Canonical input:

```txt
docs/tasks/active/<task-id>/
  prd.md
  tasks.md
  log.md
```

Shared references:

- `../references/work-unit-contract.md`
- `../references/spawned-agent-contract.md`
- `../references/handoff-packet.md`

## Workflow

1. **Locate task folder**
   - Use `$ARGUMENTS` when provided.
   - Otherwise infer from branch/active folders.
   - Ask if ambiguous.

2. **Load plan**
   - Read `prd.md`, `tasks.md`, `log.md`.
   - Read `../references/work-unit-contract.md`.
   - Read repo guidance: `AGENTS.md`, `CLAUDE.md`, README, linked architecture docs.

3. **Pick next runnable unit**
   Runnable means:
   - `Status` is `open` or `in_progress`
   - all `Deps` are `done`
   - `Blockers` is `none` or empty
   - required fields are detailed enough to delegate

   If multiple are runnable:
   1. prefer `in_progress`
   2. prefer the unit unlocking most downstream deps
   3. prefer smaller/lower-risk unit
   4. avoid colliding with unreviewed pending changes

   If the selected unit is too vague, do not guess. Mark/leave it blocked for factory refinement and stop.

4. **Route minimally**
   - If `Agent` is set, use it.
   - Else map by `Kind` only when obvious:

```txt
architecture -> architect
product      -> product-owner
design       -> designer
test/quality -> qa
review       -> qa or architect depending on scope
decision     -> human/block
implementation -> direct parent execution when `Owner: agent` and `Agent` is blank
```

   - If `Kind: decision` or `Owner: human`, stop with a human handoff.
   - If `Kind: implementation`, `Owner: agent`, and `Agent` is blank, execute the unit directly in the parent session. This is the v0 default; do not block just because no generic worker agent exists yet.
   - If `Kind: implementation`, `Owner` is missing/unclear, and `Agent` is blank, stop and ask who should execute it.

5. **Execute or delegate**
   - Parent is the only orchestrator.
   - For direct parent execution, work the selected unit yourself using the normal tools. Stay strictly inside the unit scope.
   - For delegated steward/review/test/docs units, use `spawn` when available; fallback to `pi-subagents` only when named agents are required and available.
   - Use fresh context unless there is a deliberate reason to fork.
   - Pass the unit text, relevant PRD excerpt, log context, repo rules, expected validation, and handoff packet shape.
   - Child works only the selected unit.

6. **Verify**
   - Validate the child report has status, changed files, commands, evidence, blockers, next.
   - Spot-check `git status --short`, relevant diff, and cheap targeted checks.
   - Do not mark done without evidence mapped to acceptance.

7. **Review if needed**
   - If files changed, run the relevant steward reviewer (`architect`, `designer`, or `qa`) over the unit + diff + evidence.
   - If reviewer returns `NEEDS WORK` or `BLOCKER`, stop with `NEEDS REVIEW` / `BLOCKED` in v0.
   - Do not run fixer loops until dedicated execution workers exist.

8. **Update artifacts**
   - Parent updates `tasks.md` status/evidence/blockers.
   - Parent appends a concise handoff packet to `log.md`.
   - Add discovered work units before continuing, but stop after this pass.

9. **Stop**
   - Output the shared handoff packet.
   - Do not auto-run another unit unless a future explicit AFK/Ralph mode says so.

## Status rules

- `done` only when acceptance is satisfied and evidence exists.
- `blocked` when a missing human/product/access/architecture decision prevents safe work.
- `review` when implementation happened but review is not clean or not complete.
- `open` stays open for no-op, unclear, or failed attempts unless a blocker is explicit.

## Output shape

Use `../references/handoff-packet.md`.
