---
name: repo-learnings
description: Capture durable lessons from current work so future agents are faster and less likely to repeat corrections. Use when the user asks for repo learnings, says to remember something for future agents, asks to update AGENTS.md with lessons, or after a meaningful correction reveals a repo-specific convention, source of truth, validation command, workflow rule, or recurring mistake.
---

# Repo Learnings

Turn hard-won context into concise repo instructions. This is a correction loop, not a diary.

## Goal

Make future agents avoid the same confusion, wrong default, missed command, or repo-specific mistake. Prefer a small precise update over a broad rule.

## Workflow

1. Confirm the target repo from the current working directory and user request. Do not update this skills repo unless that is the repo being worked on.
2. Identify candidate learnings from the current conversation, diffs, test failures, review comments, task logs, or repeated user corrections.
3. Keep only durable lessons. A lesson is durable when it should change how future agents work in this repo.
4. Reject temporary task state, one-off implementation details, secrets, credentials, vague preferences, stale observations, and claims not grounded in the repo or explicit user instruction.
5. Locate the right target:
   - Repo-wide agent behavior, commands, source-of-truth rules, and gotchas -> root `AGENTS.md`.
   - Domain doctrine already owned by repo docs -> `docs/knowledge/<domain>/...`.
   - Current task progress, blockers, evidence, or decisions that are not durable doctrine -> `docs/tasks/active/<task-id>/log.md`.
   - Global skill or persona behavior -> the relevant skill file only when the user explicitly asks to improve that skill.
6. If the target file is missing, create it only when the target is unambiguous and the user asked to persist repo guidance. Otherwise propose the exact file and ask.
7. Read the target file before editing. Update the most relevant existing section instead of appending a duplicate section.
8. If no section fits in `AGENTS.md`, create a short section named `Agent Learnings` or `Repo Gotchas`.
9. Rewrite unclear or stale existing instructions when the new learning supersedes them. Do not leave contradictory guidance in place.
10. Keep entries short, operational, and repo-specific. State what to do, when to do it, and where to look.
11. If the learning is plausible but not confirmed, label it `Proposed doctrine` and ask before treating it as source of truth.
12. If nothing durable should be saved, return `NO-OP` and briefly say why.

## Good Learning Shape

Use this form when adding or updating guidance:

```md
- When <situation>, do <action> because <repo-specific reason>. Source of truth: `<path-or-command>`.
```

Examples:

```md
- Before editing billing flows, read `docs/knowledge/architecture/data.md`; billing state is owned by the ledger module, not feature routes.
- Use `pnpm agent-check` as the default validation command after code changes; it wraps the repo's lint, typecheck, and focused tests.
- Do not infer product copy from screenshots. Product-facing copy doctrine lives in `docs/knowledge/design/copy-voice.md`.
```

## Bad Learnings

Do not save these as durable repo instructions:

```md
- Today we fixed bug X.
- The user sounded annoyed about Y.
- This task changed `src/foo.ts`.
- Maybe we should use Playwright more.
- Remember that the API was down this morning.
```

## Output

End with:

```md
STATUS: DONE | NO-OP | NEEDS_INPUT
Updated:
- `<path>` — <what changed>
Captured:
- <durable lesson saved, or `none`>
Rejected:
- <candidate not saved and why, or `none`>
Next:
- <one useful follow-up, or `none`>
```
