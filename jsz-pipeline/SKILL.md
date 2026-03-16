---
name: jsz-pipeline
description: >
  Execute a PRD's tasks in dependency-ordered waves using parallel agents.
  Computes waves from tasks.md, shows the execution plan, then runs wave-by-wave
  with review after the final wave. Pauses on decisions or review blockers.
  Trigger on: "run pipeline", "execute prd", "implement prd", "start pipeline".
disable-model-invocation: true
user-invocable: true
argument-hint: [prd-path-or-slug]
---

# Pipeline

Execute a PRD's task list in parallel waves. You are an **orchestrator** — you delegate all implementation to agents and never write code yourself.

## Phase 1: Load and Parse

1. Locate the PRD. `$ARGUMENTS` is either:
   - A path to a PRD directory (e.g. `docs/prds/finance-detachment/`)
   - A slug that resolves to `docs/prds/<slug>/`
   - If empty, ask which PRD to run
2. Read `tasks.md` from the PRD directory
3. Read `README.md` from the PRD directory for context
4. Parse every task: extract id, title, description, status, depends-on list, files, validates

## Phase 2: Compute Waves

Build waves by topological sort on dependencies:

- **Wave 0**: all tasks with no dependencies (or dependencies already `done`)
- **Wave N**: tasks whose dependencies are all satisfied by waves 0..(N-1)
- Skip tasks already marked `done`
- Flag any dependency cycles as errors — stop and report

## Phase 3: Show the Plan

Display the full wave plan **before executing anything** as a markdown table:

```
**Pipeline: <PRD title>** — <N> tasks across <W> waves

| Wave | Task | Description | Needs | Status |
|------|------|-------------|-------|--------|
| 1 | [1] | Remove relationship declarations from finance models | — | pending |
| 1 | [2] | Remove reverse relationships from party models | — | pending |
| 2 | [3] | Refactor RepoCustomerAccounts | 1 | pending |
| 2 | [4] | Refactor RepoProviderAccounts | 1 | pending |
| 2 | [6] | Refactor payout queries | 1 | pending |
| 3 | [5] | Refactor payouts facade | 4 | pending |
| 3 | [9] | Refactor query engine schemas | 6, 7, 8 | pending |
```

Ask the user to confirm before starting. The user may:
- Approve the full plan
- Skip specific tasks
- Adjust wave grouping
- Set a max wave count to stop after

## Phase 4: Execute Waves

For each wave:

### 4a. Pre-read

Before launching agents, **read the target files** listed in each task's **Files:** field. This gives you context to write better agent prompts and catch obvious issues early. Don't send raw file contents to agents — summarize what they need to know (existing patterns, function signatures, import conventions). Start with the tracing bullet and incrementally build a solution via delegating each iteration to an agent.

### 4b. Launch

Spawn one Agent per task **in parallel** using background agents. Each agent gets:
- The task's detail section from tasks.md (description, files, validates)
- Relevant PRD context (summary, decisions, constraints from README.md)
- Key context from pre-read: existing patterns, function signatures, conventions to follow
- Instruction: "Implement this task. Keep imports sorted. When done, report what you changed and any concerns."

Re-render the pipeline table with updated statuses. Running tasks show `running`, completed show `done`:

```
**Pipeline: <PRD title>** — Wave 2 of 3

| Wave | Task | Description | Needs | Status |
|------|------|-------------|-------|--------|
| 1 | [1] | Remove relationship declarations | — | done |
| 1 | [2] | Remove reverse relationships | — | done |
| 2 | [3] | Refactor RepoCustomerAccounts | 1 | running |
| 2 | [4] | Refactor RepoProviderAccounts | 1 | running |
| 2 | [6] | Refactor payout queries | 1 | running |
| 3 | [5] | Refactor payouts facade | 4 | pending |
| 3 | [9] | Refactor query engine schemas | 6, 7, 8 | pending |
```

### 4c. Collect Results

As agents complete, re-render the table again. Append concerns inline in the Status column:

```
| 2 | [3] | Refactor RepoCustomerAccounts | 1 | done |
| 2 | [4] | Refactor RepoProviderAccounts | 1 | done (concern: payouts eager-load) |
| 2 | [6] | Refactor payout queries | 1 | done |
```

After all agents in the wave finish:
1. Collect summaries — what each agent changed, any concerns raised
2. Check for new tasks discovered mid-flight (agents may report "I also found X needs fixing")
3. Update tasks.md — mark completed tasks as `done`
4. Quick-verify changes if anything looks off (read modified files, spot-check)

### 4d. Wave Summary

After updating statuses, show a one-line summary and **auto-continue** to the next wave unless there are concerns or discovered tasks:

```
**Wave 2 complete** — 3/3 done. Next: Wave 3 ([5], [9])
```

**Pause and ask** only when:
- An agent raised a concern or design question
- New tasks were discovered that need to be folded into the plan
- An agent's output looks wrong after spot-check

When pausing, offer these actions:
- **continue** — proceed to next wave
- **review** — run jsz-review on changes so far
- **pause** — stop here, user will resume later
- **add task** — incorporate discovered tasks, recompute waves
- **abort** — stop pipeline

### 4e. Review Gate (after final wave)

After the **last wave**, always run a review:

1. Spawn an Agent with jsz-review instructions (context: fork)
2. Present the review verdict
3. If NEEDS WORK:
   - Show findings
   - Ask: fix now or defer?
   - If fix: **delegate fixes to agents** (spawn one agent per finding or group of related findings). Do not implement fixes yourself.
   - Re-review after fixes. Max 3 fix-review loops before forcing a pause.
4. If READY:
   - Show final summary
   - Offer to commit

### 4f. Update READMEs

After the review passes (or after all fix loops complete), run jsz-update-docs on modules affected by the pipeline's changes. Invoke via the Skill tool:

```
Skill(jsz-update-docs)
```

This auto-detects changed modules from git diff and updates their README.md files. The agent running this should not need guidance — jsz-update-docs handles discovery, analysis, and writing on its own.

## Phase 5: Final Summary

When the pipeline completes (all waves done + review passed), re-render the full table one last time with all statuses as `done`, then a summary line:

```
**Pipeline complete: Finance Module Detachment** — 15/15 done, 4 waves, review READY

| Wave | Task | Description | Status |
|------|------|-------------|--------|
| 1 | [1] | Remove relationship declarations | done |
| 1 | [2] | Remove reverse relationships | done |
| 2 | [3] | Refactor RepoCustomerAccounts | done |
| ... | ... | ... | ... |

Ready to commit.
```

### Guided Review

After the final table, produce a **review guide** that helps the user navigate the changed files in logical order. Group files by review priority, not by wave or alphabetical order.

```
## Review Guide

**Core changes** — review these first, they carry the main intent:
- `src/finance/models.py` — relationship declarations removed
- `src/finance/repos.py` — query patterns rewritten

**Dependent changes** — flow from the core, check for consistency:
- `src/payouts/facade.py` — now uses new repo interface
- `src/payouts/queries.py` — updated joins

**Test updates** — verify they cover the new behavior:
- `tests/finance/test_repos.py` — new query assertions
- `tests/payouts/test_facade.py` — adapted to interface change

**Docs & config** — quick scan:
- `src/finance/README.md` — updated module contract
```

Rules for building the guide:
1. **Core changes** = files where the primary intent of the PRD lives. Usually the modules named in task descriptions.
2. **Dependent changes** = files that had to change because core changed. Imports, callers, wiring.
3. **Test updates** = new or modified test files. Group by the core/dependent file they cover.
4. **Docs & config** = READMEs, configs, migrations, type stubs — low-risk, quick scan.
5. Keep each group to the most important files. If a group has 10+ files, show the top 5 and note "and N more".
6. Use the actual file paths from `git diff --name-only`.

## Rules

1. **Never implement code yourself** — all implementation and review-fix work goes to agents. The only exception is trivial cleanup (removing an unused import, fixing a typo) that would be slower to delegate than to do inline.
2. **Never skip the wave plan display** — the user must see what's coming before anything runs
3. **Always update tasks.md** after each wave — this is your state file and enables resume
4. **Pause on architecture decisions** — if an agent reports a design choice is needed, stop and ask
5. **Auto-continue between waves** — don't block on a gate prompt when everything is clean. Only pause when there are concerns, discoveries, or errors.
6. **Discovered tasks go into the next available wave** — recompute dependencies when adding
7. **Max 3 fix-review loops** — after 3 rounds of review findings, pause and escalate to user
8. **Pre-read before launch** — read target files before each wave so agents get informed prompts
9. **Tell agents to keep imports sorted** — agents don't run linters, so remind them of conventions. Expect that pre-commit hooks will catch remaining style issues at commit time.
