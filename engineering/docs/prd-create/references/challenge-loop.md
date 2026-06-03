# Challenge Loop Reference

After creating `prd.md`, `tasks.md`, and `log.md`, challenge the plan against the real codebase.

## Before challenge

Gather:
- full `prd.md`
- full `tasks.md`
- architecture rules from already-loaded context, `AGENTS.md`, README, or nearby docs when present
- relevant repo doctrine from `docs/knowledge/` when present, especially product glossary, architecture decisions, design copy voice, and quality validation docs

If architecture rules are not found, append to `log.md`:

```md
- YYYY-MM-DD HH:MM lucy: 🏗️ Architecture not defined. Could not verify module boundaries, layer placement, or integration patterns.
```

## Challenger subagent

Run one read-mostly challenger round. It may write only its verdict file.

Prompt shape:

```txt
You are a PRD challenger. Stress-test this PRD against the actual codebase.
Verify claims, module targets, dependencies, boundaries, terminology, tests, collateral, and completion criteria.
Flag contradictions between PRD wording, repo doctrine, docs, and actual code behavior.
Cite concrete files/lines. Look for simpler alternatives and hidden coupling.
Write the full verdict to: <task-folder>/challenge-r<N>.md
Return only the verdict line in chat.
```

Verdict file format:

```md
VERDICT: GO / NO-GO

What works:
- <with file:line refs>

Problems found:
- [P1] <blocker> — file:line
- [P2] <significant concern> — file:line
- [P3] <minor issue> — file:line

Missing from PRD:
- <gap>

Suggested changes:
- <specific edits to prd.md/tasks.md>

Decision holes needing grill-me:
- <product/scope/design/architecture/domain-language question that cannot be mechanically resolved, or "None">
```

## Convergence

- `GO` → present result.
- `NO-GO` with only mechanical issues → fix concrete issues, append log entry, and re-challenge the fixed areas.
- `NO-GO` with decision holes → return to `grill-me`: ask one question at a time, include your recommended answer, cross-check code/docs when useful, then update PRD/tasks/docs and re-challenge.

Limits:
- Maximum 3 challenge rounds before escalating to the user with the remaining blockers.
- Do not delete challenge files unless explicitly approved.
- Record verdicts, fixes, and grill-me decisions in `log.md`; propose durable `docs/knowledge/` updates when the decision is repo doctrine.
