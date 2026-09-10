---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

## Task continuity

When implementation produces a durable output such as a commit, pull request, review, or validation report, if `task_log` is active, add its identifier, path, or URL with the `task_manage` reference action. Then append a concise structured `handoff` with the current state, next action, blockers, branch or worktree, latest commit, validation state, and references. Do not copy the artifact body into the task log. If `task_log` is inactive, skip these calls and continue the skill normally.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use /code-review to review the work.

Commit your work to the current branch.
