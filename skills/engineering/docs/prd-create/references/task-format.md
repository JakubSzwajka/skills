# Task Format Reference

`tasks.md` is an executable task graph for humans, default execution, and AFK continuation.

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

Emit **all eight fields on every subtask**, even when a field is empty (`evidence:` blank, `blockers: []`). It's tempting to drop them on later tasks once the pattern is established, but execution/AFK automation reads these fields to decide runnability: a missing `blockers` is ambiguous (it can't distinguish "no blockers" from "not yet assessed"), and a missing `evidence` slot removes the place a later agent records proof before `done`. `scripts/validate_prd.py` fails the artifact if any are missing, so keep them present from the first draft.

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
- Final validation belongs in explicit late subtasks, not only in per-task `verification:` fields. Build a repo-aware validation ladder:
  - static/local health: format, lint, typecheck, build, or closest repo equivalent
  - automated tests: focused unit, integration, API, component, e2e, or smoke tests
  - runtime/manual verification: run the app/service and exercise the touched workflow; use Browser/Playwright for web UI when feasible
- For Docker Compose web stacks, plan manual verification through `engineering:local-docker-gateway`: isolated `docker compose -p <project>` stack, no fixed host ports or `container_name`, browser-facing services on `dev-ingress`, same-origin `/api` where applicable, and evidence that includes project name, URL, stop command, and the route/workflow checked.
- If a validation level does not apply, keep the final validation task and record why plus the nearest equivalent check. Do not silently drop the level.
- Add review gates as explicit subtasks. Count only meaningful implementation subtasks; exclude validation, review, release, and bookkeeping tasks. For now, insert one checkpoint review after the first 4 implementation subtasks when there are more than 4, and always add a final review after final validation. Example: a 9-task implementation gets a checkpoint review after the first 4 implementation tasks and a final review after validation, not a review after every small step.
- Review gates must be independent: delegate to a fresh read-only reviewer subagent using curated context only (PRD intent, completed tasks since the previous gate, diffs/files, validation evidence, and repo doctrine). Do not give the reviewer implementation conversation history; it should not feel like it built the change.

Placement sketch for 9 meaningful implementation subtasks:

```md
T1-T4   implementation batch 1
T5      checkpoint review of T1-T4
T6-T10  implementation batch 2
T11     final validation: static/local health
T12     final validation: automated tests
T13     final validation: runtime/manual verification
T14     final independent review after validation
```

The exact IDs can differ, but the dependency shape should not: checkpoint review depends on the first 4 implementation tasks; final review depends on implementation plus final validation evidence.

Update behavior:
- Preserve completed evidence unless the user explicitly invalidates the task.
- Add newly discovered tasks when scope/codebase demands it.
- Do not silently change product scope; ask.
