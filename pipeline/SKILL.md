---
name: pipeline
description: >
  Execute a repo-local task plan from docs/tasks/active/<task-id>/ in dependency-ordered waves.
  Reads prd.md, tasks.md, and log.md, computes waves from task dependencies, runs wave-by-wave,
  and reviews changes before handoff. Pauses on design decisions, malformed task plans, or review blockers.
  Trigger on: "run pipeline", "execute tasks", "implement tasks", "start pipeline".
disable-model-invocation: true
user-invocable: true
argument-hint: [task-id]
---

# Pipeline

Execute a repo-local task plan in parallel waves. You are an **orchestrator** — you delegate implementation to agents and only do tiny deterministic cleanup yourself when delegation would be silly.

Canonical task location:

```txt
docs/tasks/active/<task-id>/
  prd.md
  tasks.md
  log.md
```

Archived tasks live in `docs/tasks/archive/` and are read only for old context, never as the active execution source.

## Expected task format

The pipeline expects `tasks.md` to contain:
- parent task metadata in frontmatter or a clearly readable header
- a subtask list with stable subtask IDs
- per-subtask status
- per-subtask dependencies
- enough implementation notes to identify target files or modules

If `tasks.md` is ambiguous, malformed, or missing dependencies/statuses, stop and ask for a fix instead of inventing structure.

Example acceptable subtask shape:

```md
## T1 Design schema
- status: done
- deps: []
- files: docs/tasks, skills/todo
- notes: Define repo-local storage layout.

## T2 Rewrite pipeline skill
- status: in_progress
- deps: [T1]
- files: /Users/kuba.szwajka/.agents/skills/pipeline/SKILL.md
- notes: Replace todo CLI assumptions with docs/tasks parsing.
```

## Phase 1: Load Task Context

1. **Locate the parent task folder.** `$ARGUMENTS` is either:
   - an exact task ID like `2026-04-10-repo-local-todo`
   - a unique prefix
   - empty, in which case inspect `docs/tasks/active/` and infer the most likely task from branch, recent edits, and active context; ask if unclear
2. Resolve the parent folder under `docs/tasks/active/<task-id>/`
3. Read:
   - `prd.md` — spec / intent / scope
   - `tasks.md` — execution plan and dependency graph
   - `log.md` — notebook context, prior decisions, gotchas
4. Parse subtasks from `tasks.md`: extract **id, title, status, deps, notes, target files/modules if present**
5. Validate the task plan:
   - every dependency references an existing subtask ID
   - no duplicate subtask IDs
   - statuses are recognizable (`open`, `in_progress`, `review`, `done`, `cancelled`) or clearly expressed as checkboxes / equivalent markers
   - enough context exists to delegate work sanely
6. If there are no actionable subtasks left, stop and say so plainly

## Phase 2: Compute Waves

Build waves by topological sort on subtask dependencies:

- **Wave 0**: all subtasks with no dependencies, or only dependencies already `done`
- **Wave N**: subtasks whose dependencies are all satisfied by waves `0..N-1`
- Skip subtasks already marked `done` or `cancelled`
- Treat `review` as not done yet unless the task text makes clear it is safe to continue
- Flag dependency cycles or references to missing IDs as errors — stop and report

## Phase 2.5: Architecture Pre-Flight

Check whether the project has defined architecture rules:

1. Look at what's already in your context: AGENTS.md, CLAUDE.md, repo root README, project instructions
2. If any of those mention or link to architecture documents, follow them and read them
3. Classify:

**If ✅ architecture defined:**
- For each subtask, quick-check whether the likely target files match the expected layer/module
- If a subtask smells like cross-module orchestration in the wrong layer, mark it with ⚠️ in the wave plan
- Store the relevant architecture excerpt; include it in every child agent prompt

**If 🏗️ not defined:**
- Add a header line to the wave plan display:
  `🏗️ Architecture: Not defined. Agents will implement without architecture constraints.`
- Do not block; just surface the risk

## Phase 3: Show the Plan

Display the full wave plan **before executing anything** as a markdown table:

```md
**Pipeline: <task-id>** — <N> subtasks across <W> waves

| Wave | Task | Description | Needs | Status |
|------|------|-------------|-------|--------|
| 1 | T1 | Remove relationship declarations | — | pending |
| 1 | T2 | Remove reverse relationships | — | pending |
| 2 | T3 | Refactor RepoCustomerAccounts | T1 | pending |
| 2 | T4 | Refactor RepoProviderAccounts | T1 | pending |
| 3 | T5 | Refactor payouts facade | T4 | pending |
```

Review the wave plan for sanity. If it looks correct, auto-proceed. If it looks off, fix your interpretation first. If the source task plan is the problem, stop and say exactly what needs to be clarified in `tasks.md`.

## Phase 4: Execute Waves

For each wave:

### 4a. Pre-read

Before launching agents, read the target files or modules mentioned in each subtask's notes. If no concrete files are listed, find the likely targets yourself using code search / grep / file reads.

Summarize what agents need to know:
- existing patterns
- function signatures
- import conventions
- nearby tests
- obvious traps

### 4b. Launch

Spawn one agent per subtask **in parallel** using background agents. Each agent gets:
- the subtask's title, status, deps, and notes from `tasks.md`
- relevant PRD context from `prd.md`
- key context from pre-read
- relevant notebook context from `log.md` if it changes execution
- architecture rules excerpt from Phase 2.5, if defined
- instruction: `Implement this task. Keep imports sorted.`
- this **required completion report format**:

```md
RESULT: DONE | NO-OP | BLOCKED

Commands run:
- <command>
- <command>

Files changed:
- <path>
- <path>

Validation run:
- <command> — PASS/FAIL
- <command> — PASS/FAIL

Summary:
- <what changed>
- <concern or 'none'>
```

Rules for child agents:
- If `git diff` is empty or no files were changed, report `RESULT: NO-OP` explicitly
- Do not claim success without listing concrete changed files
- Include exact validation commands actually run
- If the subtask cannot be completed because `tasks.md` is underspecified, report `BLOCKED` and say what is missing

Re-render the pipeline table with updated statuses like `running`, `done`, `blocked`.

### 4c. Collect Results

After all agents in the wave finish:
1. Collect summaries — what changed, what concerns were raised
2. **Check the child completion report format**. Missing required sections means the task is not done
3. If an agent reports `RESULT: NO-OP`, do **not** mark the subtask done
4. Quick-verify changes with targeted checks like:
   - `git diff -- <expected files>`
   - `git status --short`
   - targeted test/typecheck commands
5. Check for newly discovered subtasks or dependency corrections
6. Update `tasks.md` only after the child report and spot-check both look real:
   - mark completed subtasks `done`
   - mark blocked subtasks clearly as blocked / still open with a short note
   - update timestamps or summary metadata if the file uses them
7. Append to `log.md` with a concise wave summary

If a child claims success but provides no changed files, no validation commands, or an empty diff, treat it as `NO-OP` and pause instead of cosplaying progress.

### 4d. Wave Summary

After updating the task files, show a one-line summary and auto-continue to the next wave unless there are concerns:

```md
**Wave 2 complete** — 3/3 done. Next: Wave 3 (T5, T9)
```

**Pause and ask** only when:
- an agent raised a concern or design question
- `tasks.md` needs to be amended with new subtasks or changed dependencies
- an agent output looks wrong after spot-check
- the implementation exposed a mismatch with the PRD

When pausing, offer these actions:
- **continue** — proceed to next wave
- **review** — run review on changes so far
- **pause** — stop here, user will resume later
- **add task** — update `tasks.md`, recompute waves
- **abort** — stop pipeline

### 4e. Review Gate (after final wave)

After the **last wave**, always run a review:

1. Spawn a review subagent (read-only review of all changes)
2. Present the review verdict
3. If NEEDS WORK:
   - show findings
   - ask: fix now or defer?
   - if fix: **delegate fixes to agents**. Do not implement non-trivial fixes yourself
   - re-review after fixes
   - max 3 fix-review loops before forcing a pause
4. If READY:
   - show final summary
   - offer to commit

### 4f. Update Docs

After the review passes, run `update-docs` on affected modules if code changes altered module contracts, runtime wiring, env config, or module relationships.

## Phase 5: Final Summary

When the pipeline completes, re-render the full table with all completed statuses shown:

```md
**Pipeline complete: <task-id>** — <N>/<N> done, <W> waves, review READY

| Wave | Task | Description | Status |
|------|------|-------------|--------|
| 1 | T1 | Remove relationship declarations | done |
| 1 | T2 | Remove reverse relationships | done |
| 2 | T3 | Refactor RepoCustomerAccounts | done |
| ... | ... | ... | ... |
```

Then:
- append a final completion note to `log.md`
- if the parent task is complete, update `tasks.md` to mark the task complete
- recommend moving the folder from `docs/tasks/active/` to `docs/tasks/archive/` only when the work is genuinely done or cancelled

### Guided Review

After the final table, produce a review guide grouping changed files by priority:
1. **Core changes** — where the primary intent lives
2. **Dependent changes** — files changed because core changed
3. **Test updates** — new or modified test files
4. **Docs & config** — READMEs, configs, migrations, task docs

Keep each group to the important files. Use actual paths from `git diff --name-only`.

## Rules

1. **Never treat the old todo/Obsidian system as canonical.** This skill reads repo-local task artifacts only
2. **Never implement major code yourself** — delegate to agents. Exception: tiny deterministic cleanup that would be slower to delegate
3. **Never skip the wave plan display** — the user must see what's coming
4. **Always update the repo-local task artifacts after each wave** — `tasks.md` and `log.md` are the continuity source
5. **Pause on architecture decisions** — if an agent reports a design choice is needed, stop and ask
6. **Auto-continue between waves** — do not block unless there are concerns
7. **Discovered tasks must be added to `tasks.md` before execution** — then recompute waves
8. **Max 3 fix-review loops** — after that, pause and escalate
9. **Pre-read before launch** — agents should not go in blind
10. **Tell agents to keep imports sorted** — boring but necessary
11. **Always review at the end** — never skip the post-pipeline review gate
12. **Prefer `docs/tasks/active/` only** when loading current work; use `archive/` only for background context