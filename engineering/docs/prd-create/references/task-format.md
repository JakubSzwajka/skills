# Task Format Reference

`tasks.md` is an executable task graph for humans, pipeline, and AFK continuation.

```md
# Tasks

Overall status: open

## T1 <Imperative title>
- status: open
- deps: []
- intent: <one sentence describing the change and why>
- target: `path/to/file.ts`, `path/to/module/`
- acceptance:
  - <specific done criterion>
  - <specific done criterion>
- verification:
  - `<command>` or <manual inspection required>
- evidence:
  - <blank until implementation; fill before marking done>
- blockers: []
- notes: <2-5 sentences or bullets with concrete guidance>
```

Allowed statuses:
- `open` — queued, not started
- `in_progress` — actively being worked on
- `review` — implementation done enough for handoff/review, or waiting on external response
- `done` — completed and evidenced
- `cancelled` — intentionally dropped

Runnable subtask rule:
- status is `open` or `in_progress`
- every task listed in `deps` is `done`
- `blockers` is empty

Completion rule:
- Do not mark `done` until every acceptance item has concrete evidence.
- Evidence can be changed files, command output, test result, screenshot/route inspection, PR state, or documented manual verification.
- Passing tests are not enough unless they cover the acceptance criteria.

Sizing:
- A good subtask is reviewable in one pass, touches a coherent slice, has a clear done state, and includes verification.
- Split swamp-monsters. Merge microscopic chores into the nearest coherent task.
- Collateral work — tests, docs, config, schema, observability — must be represented as a subtask or folded into a clearly related one.

Update behavior:
- Preserve completed evidence unless the user explicitly invalidates the task.
- Add newly discovered tasks when scope/codebase demands it.
- Do not silently change product scope; ask.
