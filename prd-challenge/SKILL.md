---
name: prd-challenge
description: >
  Stress-test a PRD against the real codebase to find feasibility gaps, ambiguities, missing details,
  and risks before implementation begins. Produces a structured feasibility report in conversation.
  Trigger on: "challenge prd", "stress-test prd", "review prd feasibility", "is this PRD doable",
  "poke holes in this PRD", "challenge the X PRD".
---

# PRD Challenger

Critically review a PRD by cross-referencing it against the actual codebase. Produce an honest feasibility report — not a rubber stamp.

## Workflow

### 1. Identify the PRD

Look in `docs/prds/` for available PRDs. If the user specified a PRD name, use it. Otherwise, list available PRDs and ask which one to review.

Read ALL files in the PRD directory (README.md, tasks.md, data-shape.md, any supporting docs).

### 2. Deep-dive the codebase

For each major claim or assumption in the PRD, verify it against the codebase. Use `/_research` or the Explore agent for thorough investigation. Focus on these verification axes:

**Structural accuracy**
- Models & schemas referenced — do they exist? Do they have the fields/relationships described?
- Facades & repos referenced — do they exist? Do their APIs match what the PRD assumes?
- Enums & constants — do referenced values exist? Would new ones conflict?

**Architectural compliance**
- Module boundaries — does the PRD respect the project's dependency rules?
- Are proposed cross-module calls legal per CLAUDE.md rules?
- Relationship direction — does the PRD follow child-owns-FK convention?

**Blast radius**
- Count affected test files accurately (unit + integration) — don't trust PRD estimates
- Count consumers of models/facades being changed (grep for imports)
- External integration points (Stripe, webhooks, cron jobs) — are all accounted for?

**Migration & data**
- Does existing data match PRD assumptions? Check for edge cases (NULLs, orphaned rows, enum values not in PRD)
- Is the migration strategy realistic? (backfill complexity, downtime implications)

**Dependency ordering** (if tasks.md exists)
- Are blocked-by relationships correct?
- Are there hidden dependencies the PRD missed?
- Can tasks actually be validated independently at each step?

### 3. Produce the report

Output directly in conversation using this structure:

```
## PRD Feasibility Review: {PRD Name}

### Verdict: {FEASIBLE | FEASIBLE WITH CONCERNS | NEEDS REWORK}

### What works
- Bullet points of things the PRD gets right, with file:line references

### Problems found
For each problem:
- **[P1/P2/P3]** {problem title}
  - What the PRD says: ...
  - What the code actually does: ... (with file:line references)
  - Impact: ...
  - Suggested fix: ...

### Ambiguities & underspecified areas
- Areas where the PRD is vague and implementation would require guessing
- Specific questions that need answers before starting

### Missing from the PRD
- Things the codebase reveals that the PRD doesn't address
- Edge cases, error paths, existing behaviors that would break

### Open questions
- Numbered list of questions for the PRD author

### Suggested checkpoints
- Natural stopping points where you can validate before continuing
- Each checkpoint: what to build, how to test it, what "done" looks like
```

## Severity guide

- **P1** — Blocker. PRD assumption is wrong or approach won't work as described. Must fix before starting.
- **P2** — Significant. Will cause rework or complications during implementation. Should fix before starting.
- **P3** — Minor. Ambiguity or missing detail that can be resolved during implementation.

## Principles

- Be specific. "This might be hard" is useless. "PayoutModel.bookings at finance/models/payout.py:42 has 3 consumers in query_engine/" is useful.
- Reference actual files and line numbers.
- Challenge whether the approach is the right one — not just whether it's described correctly.
- If the PRD has tasks, evaluate whether dependency ordering makes sense.
- Check if there are simpler alternatives the PRD didn't consider.
- Count affected files accurately — verify, don't trust PRD estimates.
- Look for things the PRD author couldn't know without reading the code (hidden coupling, undocumented behaviors, surprising data shapes).
