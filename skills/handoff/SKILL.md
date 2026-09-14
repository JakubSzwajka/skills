---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Include a "suggested skills" section in the document, which suggests skills that the agent should invoke.

Do not duplicate content already captured in other artifacts such as specs, plans, ADRs, tickets, commits, and diffs. Reference them by path or URL instead. If the master session has a mounted central spec, include its exact `~/.pi/specs/<YYYY-MM-DD>_<feature-slug>/` path for the next master session. A delegate child still needs a self-contained brief and must not be told to inspect the whole folder.

`/spec:log:append` is the operator command; `spec_log_append` is the master-only LLM tool. Use either only for a durable approval or amendment, rejected alternative, material discovery or scope change, verifier outcome, completion, or reopening. Do not log the handoff itself, prompts, ordinary tool calls, every test, generated files, or ticket boxes.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.

## When an orchestrator hands over

An orchestrator or conductor hands over at roughly 80 assistant turns. Do it at an atomic boundary: after a lane is read, verified and stopped, or right after a commit. Never mid-lane.

Turn count is the trigger. A context percentage is not, because it needs a provider that reports one and it does not cover every session. You can always count turns.

Cost and reliability drive this, not only the context limit. Cost per assistant turn rises sharply the longer a session runs, and a long session rarely compacts, so it does not correct itself. Late turns also degrade: a very long session starts emitting malformed tool arguments of a kind that never appears early.

A rotating parent carries these across, beyond the usual handoff content:

- decisions already made, and what decided them
- the branch, and the commits made so far
- live child lanes, each with its handoff path
- gates still open: tests, reviews, approvals not yet given
- questions outstanding for the operator
