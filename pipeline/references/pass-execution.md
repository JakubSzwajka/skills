# Pass Execution Reference

A pipeline pass executes exactly one next runnable subtask, then stops. Goal runner may invoke another pass later.

## Pick one subtask

Find runnable subtasks:
- status is `open` or `in_progress`
- deps are already `done`
- blockers are empty
- skip `done` and `cancelled`
- treat `review` as not runnable unless the task explicitly says review is cleared

If several are runnable, pick one:
1. prefer an `in_progress` subtask over starting a new one
2. prefer the task that unlocks the most downstream deps
3. prefer lower-risk/smaller scope when unlock value is equal
4. avoid tasks likely to collide with unreviewed pending changes

Show the selected pass before executing:

```md
**Pipeline pass: <task-id>**
Selected: T3 <title>
Reason: <why this task next>
Next blocked by: <deps/blockers summary if useful>
```

## Pre-read

Before spawning the implementation agent, read target files/modules or discover likely targets with grep/find/read. Give the agent only useful context:
- existing patterns
- signatures/import conventions
- nearby tests
- architecture rules if defined
- relevant PRD/log notes
- obvious traps

## Spawn tactic

Use the subagent as a narrow specialist, not a feature swarm. Apply the shared contract in `../../references/spawned-agent-contract.md`.

- Spawn exactly one implementation agent for the selected subtask.
- If the subtask is unclear, spawn a read-only explorer first, update/clarify the plan, and stop before implementation if needed.
- Parent owns task status updates; child implements and reports evidence, it does not mark tasks done.
- Parent must not implement code/docs subtasks directly unless the change is tiny deterministic cleanup; spawn or stop.
- Use fixer agents scoped to one review finding or one blocked subtask, never “fix everything”.

Child system prompt:

```txt
You are an implementation agent for exactly one pipeline subtask.
Do not work on sibling tasks.
Do not update task status yourself unless explicitly asked.
Make the smallest correct change.
Return evidence mapped to acceptance criteria.
```

## Child agent prompt

Required report:

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

After the child finishes:
1. Validate the report includes all required sections.
2. Spot-check with `git diff`, `git status --short`, and targeted tests/typechecks where cheap.
3. Mark the subtask `done` only if report + spot-check + evidence are credible.
4. Keep blocked/no-op subtasks open or review with blockers filled.
5. Add discovered tasks/dependency fixes to `tasks.md`, then stop.
6. Append a concise pass summary to `log.md` using the shared handoff packet in `../../references/handoff-packet.md`.

Stop after this one subtask. Do not continue to another runnable task in the same pipeline invocation.
