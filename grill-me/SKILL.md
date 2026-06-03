---
name: grill-me
description: Interview the user relentlessly about a plan, design, or missing repo doctrine until reaching shared understanding. Stress-test against existing docs, code, terminology, and decisions; capture resolved outcomes in task artifacts or canonical docs. Use when user wants to stress-test a plan, get grilled on their design, resolve product/design/architecture/domain-language gaps, or mentions "grill me".
---

# Grill Me

Interview the user until the plan is precise enough to execute without hidden product, design, architecture, quality, or domain-language guesses.

## Core loop

1. Establish the decision tree: what must be decided now, what depends on it, and what can wait.
2. Before asking, inspect repo docs/code when the answer might already exist.
3. Ask exactly one question at a time and wait for the user's answer before continuing.
4. For each question, include your recommended answer and a short reason.
5. Walk dependencies in order. Do not jump to implementation until the blocking branch is resolved.

If a question can be answered by exploring the codebase, explore the codebase instead.

## Repo-aware grilling

When operating inside a repo, read the relevant sources before or during the session:

- task artifacts: `docs/tasks/active/<task-id>/{prd.md,tasks.md,log.md}`
- durable doctrine: `docs/knowledge/<domain>/`
- project guidance: `AGENTS.md`, `CLAUDE.md`, `README.md`, linked docs
- source files/configs needed to verify how the system actually behaves

Use the repo's existing convention if it differs. In this setup, durable doctrine belongs in `docs/knowledge/<domain>/`; do not introduce a root `CONTEXT.md` or new ADR system unless the repo already uses that convention.

## What to challenge

- **Terminology drift:** call out vague, overloaded, or conflicting terms. Propose one canonical term and list aliases to avoid.
- **Code/doc contradictions:** if the user says X but code or docs show Y, surface the conflict immediately and ask which source should win.
- **Concrete scenarios:** test domain relationships with specific examples, edge cases, empty/error states, migration paths, and permission boundaries.
- **Hidden coupling:** look for decisions that affect downstream subtasks, data ownership, UX behavior, validation, or release risk.
- **False certainty:** label inferred defaults as `Proposed doctrine` until the user confirms them.

## Capture rules

Capture decisions as they crystallize; do not save everything at the end.

- Task-specific details go to `docs/tasks/active/<task-id>/log.md` or the PRD/task artifact.
- Durable product/domain language goes to `docs/knowledge/product/glossary.md` when the repo uses the recommended structure.
- User-facing copy and UI terminology rules go to `docs/knowledge/design/copy-voice.md`.
- Durable technical decisions go to `docs/knowledge/architecture/decisions.md`, or to `docs/decisions/` only when the repo already uses ADR files.
- Quality/release doctrine goes to `docs/knowledge/quality/`.

Only edit durable docs when the user explicitly authorizes update mode or has clearly asked you to implement the doc update. Otherwise, propose the exact doc updates.

Offer an ADR-style decision record only when all three are true:

1. The decision is hard to reverse.
2. The choice will be surprising without context.
3. Real alternatives existed and a tradeoff was made.

If any condition is missing, keep the note in the relevant task artifact or steward-owned knowledge doc instead.

## Stopping point

End when the blocking branch is resolved or when the next question would be non-blocking. Report:

- decisions made
- docs updated or proposed updates
- remaining blockers
- next workflow step (`prd-create`, `pipeline`, role steward, or implementation)
