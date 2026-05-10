---
name: pipeline
description: >
  Execute exactly one next runnable subtask from docs/tasks/active/<task-id>/.
  Reads prd.md, tasks.md, and log.md, picks the next subtask from deps/status/blockers,
  delegates implementation, updates task artifacts, reviews that subtask, then stops.
  Trigger on: "run pipeline", "execute tasks", "implement tasks", "start pipeline".
disable-model-invocation: true
user-invocable: true
argument-hint: [task-id]
---

# Pipeline

Execute exactly one next runnable subtask from a repo-local task plan, then stop. You are the orchestrator for one bounded pass: load the task artifact, pick one subtask, delegate implementation with the spawn tool, verify/review it, update state, and hand off cleanly.

Canonical source:

```txt
docs/tasks/active/<task-id>/
  prd.md
  tasks.md
  log.md
```

`prd-create` owns the artifact format. Pipeline consumes and updates it; never invent a second tracker.

Workflow:
1. Locate the task folder from `$ARGUMENTS`, active tasks, branch, or recent context; ask if ambiguous.
2. Read `prd.md`, `tasks.md`, and `log.md`; parse subtasks using the contract in `references/task-contract.md`.
3. Validate the graph: known statuses, unique IDs, valid deps, no cycles, enough target/context to delegate. Stop if malformed.
4. Check architecture rules from loaded repo docs/AGENTS/README; include them in child prompts when defined. Use the shared spawned-agent contract in `../../../references/spawned-agent-contract.md` for all delegated work.
5. Pick exactly one next runnable subtask using `references/pass-execution.md`; if several are runnable, choose the lowest-risk/highest-dependency-unlocking task and say why.
6. Execute that one subtask: pre-read targets, spawn one implementation agent, collect report, spot-check diffs/checks, update `tasks.md` and `log.md`.
7. If a design/product decision appears, use `grill-me`: ask one question at a time with your recommended answer, then update task artifacts and stop.
8. Run the review gate for this subtask using `references/review-handoff.md`; fix/re-review up to 3 loops, then pause if still not ready.
9. Produce a compact pass summary using `../../../references/handoff-packet.md`, append the same operational state to `log.md`, and stop. Goal runner is responsible for invoking the next pass.

Hard rules:
- Only execute runnable subtasks: `open|in_progress`, deps `done`, blockers empty.
- Delegate implementation to subagents; the parent may only do deterministic task-artifact updates or tiny cleanup that would be silly to spawn. If spawn fails after one retry with `model` omitted, stop as blocked instead of implementing in-process.
- Mark `done` only when evidence maps to acceptance criteria.
- Treat empty diffs, missing child reports, or missing validation as not done.
- Add discovered work to `tasks.md` before executing it, then stop so the next pass can re-evaluate.
- Always update `tasks.md` and `log.md` after the pass.
- Never skip final review.
- Never commit or delete files without explicit approval.

Output default: use the handoff packet shape from `../../../references/handoff-packet.md`.
