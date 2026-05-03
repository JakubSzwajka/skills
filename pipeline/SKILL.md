---
name: pipeline
description: >
  Execute a repo-local task plan from docs/tasks/active/<task-id>/ in dependency-ordered waves.
  Reads prd.md, tasks.md, and log.md, computes runnable subtasks from deps/status/blockers,
  delegates implementation, updates task artifacts, and reviews changes before handoff.
  Trigger on: "run pipeline", "execute tasks", "implement tasks", "start pipeline".
disable-model-invocation: true
user-invocable: true
argument-hint: [task-id]
---

# Pipeline

Execute a repo-local task plan. You are the orchestrator: load the task artifact, compute runnable work, delegate implementation (spawn tool), verify results, update state, and hand off cleanly.

Canonical source:

```txt
docs/tasks/active/<task-id>/
  prd.md
  tasks.md
  log.md
```

`prd-create` owns the artifact format. Pipeline consumes and updates it; never invent a second tracker.

Workflow:
1. Locate the task folder from `$ARGUMENTS`, active tasks, branch, or recent context; ask if ambiguous.
2. Read `prd.md`, `tasks.md`, and `log.md`; parse subtasks using the contract in `references/task-contract.md`.
3. Validate the graph: known statuses, unique IDs, valid deps, no cycles, enough target/context to delegate. Stop if malformed.
4. Check architecture rules from loaded repo docs/AGENTS/README; include them in child prompts when defined.
5. Compute dependency waves and show the plan before executing anything.
6. Execute waves using `references/wave-execution.md`: pre-read targets, spawn one agent per subtask, collect reports, spot-check diffs/checks, update `tasks.md` and `log.md`.
7. Auto-continue between waves unless blocked, underspecified, mismatched with PRD, or a design/product decision appears.
8. If a design/product decision appears, use `grill-me`: ask one question at a time with your recommended answer, then update task artifacts and recompute waves.
9. After the final wave, run the review gate in `references/review-handoff.md`; fix/re-review up to 3 loops, then pause if still not ready.
10. Produce final summary, changed-file review guide, verification, and archive recommendation.

Hard rules:
- Only execute runnable subtasks: `open|in_progress`, deps `done`, blockers empty.
- Mark `done` only when evidence maps to acceptance criteria.
- Treat empty diffs, missing child reports, or missing validation as not done.
- Add discovered work to `tasks.md` before executing it, then recompute waves.
- Always update `tasks.md` and `log.md` after each wave.
- Never skip final review.
- Never commit or delete files without explicit approval.

Output default:
- current wave/result
- files changed
- validation run
- blockers or next step
