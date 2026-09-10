---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

## Task continuity

After writing the handoff document, if `task_log` is active, add its path with the `task_manage` reference action. Then append a concise structured `handoff` that points to the document and records the current state, next action, blockers, branch or worktree, latest commit, and validation state. Do not copy the artifact body into the task log. If `task_log` is inactive, skip these calls and continue the skill normally.

Include a "suggested skills" section in the document, which suggests skills that the agent should invoke.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
