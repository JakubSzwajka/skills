---
name: task-knowledge-harvest
description: Harvest durable repo knowledge from completed PRDs, linked PRs, and task artifacts, verify implemented active work against code, update docs/knowledge, then archive or clean up stale task folders. Use when the user asks to squeeze completed PRDs into docs/knowledge, harvest lessons from archived tasks or PRs, archive implemented active tasks, clean docs/tasks, or remove old PRDs after knowledge capture.
---

# Task Knowledge Harvest

Consolidate completed task artifacts into durable repo documentation, then clean up only what is truly done.

## Goal

Turn finished PRDs, linked PR notes, task logs, and implementation notes into concise `docs/knowledge/` doctrine. Keep what will help future agents and humans understand the repo. Remove or archive task artifacts only after the useful knowledge has been captured and active work is proven implemented.

## Workflow

1. **Confirm target repo**
   - Work in the current repo unless the user names another one.
   - Do not run this against the `.agents` skills repo unless that is explicitly the target.
   - Read root `AGENTS.md`, `README.md`, and the current `docs/knowledge/` structure if present.

2. **Find candidate task artifacts**
   - Archived candidates: `docs/tasks/archive/**/{prd.md,tasks.md,log.md}`.
   - Active candidates: `docs/tasks/active/*` only when task status, logs, branch history, or the user says the work is implemented.
   - Include similarly named repo-local task folders only when the repo clearly uses that convention.
   - Skip ambiguous, blocked, abandoned, or partially implemented tasks and report why.

3. **Read the evidence**
   - For each candidate, read `prd.md`, `tasks.md`, `log.md`, and any linked notes or PR references.
   - Inspect related code, tests, docs, and recent commits mentioned by the task artifacts.
   - If a task links to a PR, inspect the merged diff and review decisions when available, but treat current code as the final authority.
   - For active tasks, confirm implementation in live code before treating them as complete. Look for the feature surface, runtime wiring, tests, and docs that prove the claimed behavior exists.

4. **Harvest durable knowledge**
   - Keep repo truths that should survive the task: architecture boundaries, product/domain rules, integration contracts, operational runbooks, validation commands, quality lessons, glossary terms, design/copy doctrine, and recurring gotchas.
   - Reject temporary task state, progress narration, PR mechanics, stale proposals, rejected designs, one-off implementation trivia, and anything not supported by code or explicit user decision.
   - Prefer updating existing `docs/knowledge/<domain>/...` files over creating new ones.
   - Create a new knowledge file only when the repo has a clear domain home or the user asked for one. Keep it short and link to code or source docs where useful.

5. **Update docs**
   - Edit only the knowledge docs that need real changes.
   - Preserve correct existing author-written context.
   - Remove contradictions when new harvested doctrine supersedes old text.
   - Use relative links for repo-local docs and code references.

6. **Archive or clean up task artifacts**
   - Active and confirmed implemented: move to `docs/tasks/archive/<task-id>/` only if the repo uses archive folders or the user requested archiving.
   - Already archived and fully harvested: mark as cleanup candidates.
   - Permanent deletion is a two-step operation unless the user already gave exact-path approval. First list the exact paths proposed for removal and ask for approval.
   - Never delete active, ambiguous, unverified, blocked, or still-useful task artifacts.

7. **Validate**
   - Re-read touched `docs/knowledge/` files and check that claims match the current code and task evidence.
   - Run focused docs checks if the repo has them.
   - Run code tests only when the harvest changed behavior-adjacent docs that reference commands, config, or runtime contracts.

## Output

End with:

```md
STATUS: DONE | NO-OP | NEEDS_INPUT
Harvested:
- `<docs/knowledge/path>` - <durable knowledge captured>
Archived:
- `<docs/tasks/archive/task-id>` - <evidence active work was implemented, or `none`>
Cleanup candidates:
- `<exact/path>` - <why it is safe to remove, or `none`>
Rejected:
- `<task-id>` - <why not harvested/archived, or `none`>
Evidence:
- <code refs, tests, docs checks, or `not run` with reason>
Next:
- <approval needed for exact deletions, or `none`>
```
