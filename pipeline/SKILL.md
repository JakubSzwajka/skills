---
name: pipeline
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

Display the full wave plan **before executing anything**. Format:

```
Pipeline: <PRD title>
Total: <N> tasks across <W> waves

🌊 **Wave 1**  ──────────────────────────────────
  [1] Remove relationship declarations from finance models
  [2] Remove reverse relationships from party models

🌊 **Wave 2**  ──────────────────────────────────
  [3] Refactor RepoCustomerAccounts         (needs: 1)
  [4] Refactor RepoProviderAccounts         (needs: 1)
  [6] Refactor payout queries               (needs: 1)

🌊 **Wave 3**  ──────────────────────────────────
  [5] Refactor payouts facade               (needs: 4)
  [9] Refactor query engine schemas         (needs: 6, 7, 8)

🔍 Review after final wave.
```

Ask the user to confirm before starting. The user may:
- Approve the full plan
- Skip specific tasks
- Adjust wave grouping
- Set a max wave count to stop after

Use your select tool to interactively select the user's approval or adjustments.

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

Display while running:

```
🌊 **Wave 2**  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [3] Refactor RepoCustomerAccounts ........... running
  [4] Refactor RepoProviderAccounts ........... running
  [6] Refactor payout queries ................. running
```

### 4c. Collect Results

As agents complete, update the display:

```
🌊 **Wave 2**  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [3] Refactor RepoCustomerAccounts ........... done
  [4] Refactor RepoProviderAccounts ........... done (concern: payouts eager-load)
  [6] Refactor payout queries ................. done
```

After all agents in the wave finish:
1. Collect summaries — what each agent changed, any concerns raised
2. Check for new tasks discovered mid-flight (agents may report "I also found X needs fixing")
3. Update tasks.md — mark completed tasks as `done`
4. Quick-verify changes if anything looks off (read modified files, spot-check)

### 4d. Wave Summary

After updating statuses, show a compact summary and **auto-continue** to the next wave unless there are concerns or discovered tasks:

```
🌊 **Wave 2** complete  ─────────────────────────
  3/3 tasks done
  Next: Wave 3 — [5], [9]
```

**Pause and ask** only when:
- An agent raised a concern or design question
- New tasks were discovered that need to be folded into the plan
- An agent's output looks wrong after spot-check

When pausing, offer these actions:
- **continue** — proceed to next wave
- **review** — run smart-review on changes so far
- **pause** — stop here, user will resume later
- **add task** — incorporate discovered tasks, recompute waves
- **abort** — stop pipeline

### 4e. Review Gate (after final wave)

After the **last wave**, always run a review:

1. Spawn an Agent with smart-review instructions (context: fork)
2. Present the review verdict
3. If NEEDS WORK:
   - Show findings
   - Ask: fix now or defer?
   - If fix: **delegate fixes to agents** (spawn one agent per finding or group of related findings). Do not implement fixes yourself.
   - Re-review after fixes. Max 3 fix-review loops before forcing a pause.
4. If READY:
   - Show final summary
   - Offer to commit

## Phase 5: Final Summary

When the pipeline completes (all waves done + review passed):

```
🎉 **Pipeline complete**  ═══════════════════════
  PRD: **Finance Module Detachment**
  Tasks: 15/15 done
  Waves: 4
  Review: READY

  🌊 **Wave 1**: [1] [2]                          2/2
  🌊 **Wave 2**: [2b] [3] [4] [6] [7] [8] [11a]  7/7
  🌊 **Wave 3**: [5] [9] [10] [11b]              4/4
  🌊 **Wave 4**: [11c] [12] [13] [13b]           4/4

  🔍 Ready to commit.
```

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
