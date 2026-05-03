# Pipeline Task Contract

Pipeline consumes the `prd-create` task artifact.

Required files:
- `prd.md` — intent, scope, acceptance, stop conditions
- `tasks.md` — executable task graph
- `log.md` — continuity notebook

Each subtask in `tasks.md` must expose:
- `id` — stable ID like `T1`
- `title`
- `status` — `open | in_progress | review | done | cancelled`
- `deps` — sibling IDs only
- `intent`
- `target` — files/modules or enough notes to find them
- `acceptance`
- `verification`
- `evidence`
- `blockers`
- `notes`

Runnable rule:
- status is `open` or `in_progress`
- every dependency is `done`
- blockers are empty

Status transitions:
- `open → in_progress` when work starts
- `in_progress → done` only after evidence covers acceptance
- `in_progress → review` when implementation exists but needs user/external review
- blocked work stays `open` or `review` with blockers/notes filled; do not invent statuses
- parent task is complete when every subtask is `done` or intentionally `cancelled`

Graph validation:
- no duplicate IDs
- every dep references an existing subtask
- no dependency cycles
- `review` is not done unless the task text explicitly says downstream work may proceed
- if the plan is malformed or too vague to delegate safely, stop and ask for a task artifact fix
