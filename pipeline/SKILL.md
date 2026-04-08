---
name: pipeline
description: >
  Execute a todo task tree in dependency-ordered waves using parallel agents.
  Reads subtasks from todo, computes waves from dependsOnIds, runs wave-by-wave
  with review after the final wave. Pauses on decisions or review blockers.
  Trigger on: "run pipeline", "execute tasks", "implement tasks", "start pipeline".
disable-model-invocation: true
user-invocable: true
argument-hint: [task-id-or-project]
---

# Pipeline

Execute a todo task tree in parallel waves. You are an **orchestrator** — you delegate all implementation to agents and never write code yourself.

## Phase 1: Load Tasks

1. **Locate the parent task.** `$ARGUMENTS` is either:
   - A todo task ID (or unique prefix)
   - A project name to filter by
   - If empty, check the current project context or ask which task tree to run
2. **Read the parent task** via `todo show <parent-id>` — this contains the PRD/description
3. **List subtasks** via `todo list --project <project> --tree` and filter to children of the parent
4. **Parse each subtask**: extract id, title, description, status, dependsOnIds
5. **Read the parent task log** for any notebook context, challenge findings, or prior session notes

## Phase 2: Compute Waves

Build waves by topological sort on `dependsOnIds`:

- **Wave 0**: all subtasks with no dependencies (or dependencies already `done`)
- **Wave N**: subtasks whose dependencies are all satisfied by waves 0..(N-1)
- Skip subtasks already marked `done`
- Flag any dependency cycles as errors — stop and report

## Phase 2.5: Architecture Pre-Flight

Check whether the project has defined architecture rules:

1. Look at what's already in your context: AGENTS.md, CLAUDE.md, project instructions, repo root README.
2. If any of those mention or link to an architecture document, follow it and read it.
3. Classify:

**If ✅ architecture defined:**
- For each subtask, quick-check: do the target files match the expected layer/module?
- If any subtask description implies cross-module orchestration in a domain facade, mark it with ⚠️ in the wave plan table.
- Store the architecture rules excerpt — it will be included in every child agent's prompt in Phase 4b.

**If 🏗️ not defined:**
- Add a header line to the wave plan display:
  `🏗️ Architecture: Not defined. Agents will implement without architecture constraints.`
- Do NOT block — proceed normally. The flag is informational.

## Phase 3: Show the Plan

Display the full wave plan **before executing anything** as a markdown table:

```
**Pipeline: <parent task title>** — <N> tasks across <W> waves

| Wave | Task | Description | Needs | Status |
|------|------|-------------|-------|--------|
| 1 | [id1] | Remove relationship declarations | — | pending |
| 1 | [id2] | Remove reverse relationships | — | pending |
| 2 | [id3] | Refactor RepoCustomerAccounts | id1 | pending |
| 2 | [id4] | Refactor RepoProviderAccounts | id1 | pending |
| 3 | [id5] | Refactor payouts facade | id4 | pending |
```

Review the wave plan for sanity. If it looks correct, **auto-proceed**. If something looks off, fix it yourself and proceed.

## Phase 4: Execute Waves

For each wave:

### 4a. Pre-read

Before launching agents, **read the target files** mentioned in each subtask's description. Summarize what agents need to know (existing patterns, function signatures, import conventions).

### 4b. Launch

Spawn one agent per subtask **in parallel** using background agents. Each agent gets:
- The subtask's description (from todo)
- Relevant PRD context from the parent task description
- Key context from pre-read: existing patterns, function signatures, conventions
- **Architecture rules** from Phase 2.5 (if defined): "This project follows these architecture rules: [relevant excerpt]. Ensure your implementation complies."
- Instruction: "Implement this task. Keep imports sorted."
- A **required completion report format**. Every child agent must finish with this exact structure:

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
- If `git diff` is empty or no files were changed, report `RESULT: NO-OP` explicitly.
- Do not claim success without listing concrete changed files.
- Include the exact validation commands you ran.

Re-render the pipeline table with updated statuses (`running`, `done`).

### 4c. Collect Results

As agents complete, update the table. After all agents in the wave finish:
1. Collect summaries — what each agent changed, any concerns raised
2. **Check the child completion report format**. Treat the task as failed / not done if any required section is missing.
3. If an agent reports `RESULT: NO-OP`, do **not** mark the task done.
4. Quick-verify changes, especially for deterministic tasks, using targeted checks like `git diff -- <expected files>` or `git status --short`.
5. Check for new tasks discovered mid-flight
6. **Update subtask statuses** via `todo status <subtask-id> done` only after the child report and spot-check both look real
7. **Log progress** via `todo log <parent-id> "Wave N complete: <summary>" --author lucy`

If the child claims success but provides no changed files, no validation commands, or an empty diff, treat that as `NO-OP` and pause instead of pretending the wave completed.

### 4d. Wave Summary

After updating statuses, show a one-line summary and **auto-continue** to the next wave unless there are concerns:

```
**Wave 2 complete** — 3/3 done. Next: Wave 3 ([id5], [id9])
```

**Pause and ask** only when:
- An agent raised a concern or design question
- New tasks were discovered that need to be folded into the plan
- An agent's output looks wrong after spot-check

When pausing, offer these actions:
- **continue** — proceed to next wave
- **review** — run review on changes so far
- **pause** — stop here, user will resume later
- **add task** — create new subtask via todo, recompute waves
- **abort** — stop pipeline

### 4e. Review Gate (after final wave)

After the **last wave**, always run a review:

1. Spawn a review subagent (read-only code review of all changes)
2. Present the review verdict
3. If NEEDS WORK:
   - Show findings
   - Ask: fix now or defer?
   - If fix: **delegate fixes to agents**. Do not implement fixes yourself.
   - Re-review after fixes. Max 3 fix-review loops before forcing a pause.
4. If READY:
   - Show final summary
   - Offer to commit

### 4f. Update Docs

After the review passes, run update-docs on modules affected by the pipeline's changes.

## Phase 5: Final Summary

When the pipeline completes, re-render the full table with all statuses as `done`:

```
**Pipeline complete: <parent task title>** — <N>/<N> done, <W> waves, review READY

| Wave | Task | Description | Status |
|------|------|-------------|--------|
| 1 | [id1] | Remove relationship declarations | done |
| 1 | [id2] | Remove reverse relationships | done |
| 2 | [id3] | Refactor RepoCustomerAccounts | done |
| ... | ... | ... | ... |

Ready to commit.
```

**Log final status** to the parent task:
```
todo log <parent-id> "Pipeline complete: <N>/<N> tasks done across <W> waves. Review: READY." --author lucy
```

### Guided Review

After the final table, produce a **review guide** grouping changed files by review priority:

1. **Core changes** — files where the primary intent lives
2. **Dependent changes** — files that had to change because core changed
3. **Test updates** — new or modified test files
4. **Docs & config** — READMEs, configs, migrations

Keep each group to the most important files. Use actual paths from `git diff --name-only`.

## Rules

1. **Never implement code yourself** — all implementation goes to agents. Exception: trivial cleanup that would be slower to delegate.
   - If a small deterministic task (schema line, config tweak, migration file, one-file rename) no-ops after a delegated retry, use this exception instead of repeating the same failed delegation pattern.
2. **Never skip the wave plan display** — the user must see what's coming
3. **Always update todo** after each wave — statuses and log entries
4. **Pause on architecture decisions** — if an agent reports a design choice is needed, stop and ask
5. **Auto-continue between waves** — don't block unless there are concerns
6. **Discovered tasks go into the next available wave** — create via todo, recompute dependencies
7. **Max 3 fix-review loops** — after 3 rounds, pause and escalate
8. **Pre-read before launch** — read target files so agents get informed prompts
9. **Tell agents to keep imports sorted** — remind them of conventions
10. **Always review at end** — never skip the post-pipeline review gate
