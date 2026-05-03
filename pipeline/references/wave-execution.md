# Wave Execution Reference

## Compute waves

Topologically sort runnable subtasks:
- Wave 1: runnable subtasks whose deps are already `done`
- Wave N: subtasks whose deps are satisfied by earlier waves
- skip `done` and `cancelled`
- stop on cycles, missing deps, or ambiguous `review` blockers

Show the plan before execution:

```md
**Pipeline: <task-id>** — <N> subtasks across <W> waves

| Wave | Task | Description | Needs | Status |
|------|------|-------------|-------|--------|
| 1 | T1 | <short> | — | open |
```

## Pre-read

Before spawning agents, read target files/modules or discover likely targets with grep/find/read. Give agents only useful context:
- existing patterns
- signatures/import conventions
- nearby tests
- architecture rules if defined
- relevant PRD/log notes
- obvious traps

## Child agent prompt

Spawn one agent per subtask in the current wave. Required report:

```md
RESULT: DONE | NO-OP | BLOCKED

Commands run:
- <command>

Files changed:
- <path>

Validation run:
- <command> — PASS/FAIL

Evidence:
- <acceptance item> → <artifact/command/diff proving it>

Summary:
- <what changed>
- <concern or 'none'>
```

Child rules:
- implement only the assigned subtask
- keep imports sorted
- report `NO-OP` if no files changed or diff is empty
- report `BLOCKED` if the task is underspecified or needs a product/design decision
- do not claim done without changed files or evidence, unless the task is truly documentation/verification-only and explains why

## Collect and update

After each wave:
1. Validate child reports include all required sections.
2. Spot-check with `git diff`, `git status --short`, and targeted tests/typechecks where cheap.
3. Mark subtasks `done` only if report + spot-check + evidence are credible.
4. Keep blocked/no-op subtasks open or review with blockers filled.
5. Add discovered tasks/dependency fixes to `tasks.md`, then recompute waves.
6. Append a concise wave summary to `log.md`.

Pause only when:
- an agent reports BLOCKED or a design/product question
- the implementation reveals a PRD mismatch
- task graph needs new work or changed dependencies
- child output looks fake, empty, or unverifiable

Otherwise auto-continue to the next wave.
