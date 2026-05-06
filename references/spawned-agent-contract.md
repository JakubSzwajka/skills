# Spawned Agent Contract

Use this contract whenever a skill delegates work to a spawned subagent.

## Baseline

- The subagent starts with no conversation history. Give it all required context explicitly.
- Assign one narrow job. Do not ask a subagent to "handle the whole feature" unless the feature is truly tiny.
- The subagent must stay inside the assigned scope and report scope gaps instead of expanding the task.
- The subagent must not ask the user questions. If it cannot proceed safely, it reports `BLOCKED` with the missing decision/context.
- Omit `model` by default so the harness uses the current/default model. Only specify a model when the caller explicitly asks or the runtime supports it. If spawn fails because of model/auth/quota, retry once with `model` omitted; if it still fails, stop as blocked.

## Write permissions

- Read-only jobs must never edit files, stage changes, commit, delete files, or run commands that write to disk.
- Implementation/fix jobs may edit only when the parent explicitly assigns edit mode.
- Destructive operations and commits always require explicit user approval in the parent session.

## Required final report

Every spawned agent should end with this compact shape unless a skill gives a stricter format:

```md
STATUS: DONE | BLOCKED | NEEDS REVIEW | NO-OP

Scope:
- <what was assigned>

Files read:
- `<path>` — why

Files changed:
- `<path>` — what changed

Commands run:
- `<command>` — PASS/FAIL/why relevant

Evidence:
- <acceptance/check> → <proof>

Blockers / concerns:
- <none or concrete blocker>

Next:
- <recommended next action>
```

If the job is read-only, use `Files changed: none`.
If there is no evidence, do not claim `DONE`; use `NEEDS REVIEW`, `BLOCKED`, or `NO-OP`.
