# Handoff Packet

Use this compact handoff shape at the end of execution/review/test skills and when writing progress into repo-local task logs.

```md
## Handoff

Status: DONE | BLOCKED | NEEDS REVIEW | NO-OP
Task: <task id / subtask id / scope, if any>

Changed:
- `<path>` — <what changed>

Evidence:
- <acceptance/check> → <proof, command, review result, or artifact>

Validation:
- `<command>` — PASS / FAIL / not run because <reason>

Decisions:
- <decision made, or `none`>

Blockers:
- <blocker, missing input, failing check, or `none`>

Next:
- <one exact next action / next owner / next runnable task>
```

Rules:
- Keep it short. This is operational state, not a blog post.
- Do not hide uncertainty. If evidence is partial, say partial.
- If files changed, include actual paths.
- If validation was skipped, say why.
- For pipeline work, append the same shape or a faithful summary to `log.md`.
