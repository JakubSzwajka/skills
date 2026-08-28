# Agent collaboration audit

This directory tracks how the operator, main agent, and delegated workers collaborate. It keeps evidence and improvement work outside the global instruction file so `AGENTS.md` stays small and neutral.

## Start here

1. Copy the prompt from [`PROMPT.md`](PROMPT.md) into a new session.
2. Read the current work in [`PLAN.md`](PLAN.md).
3. Use the latest dated findings as the comparison baseline.
4. Open the matching JSON under [`baselines/`](baselines/) when exact counts matter.

Current baseline:

- [`FINDINGS-2026-08-28.md`](FINDINGS-2026-08-28.md)
- [`baselines/2026-08-28-mega-assessment.json`](baselines/2026-08-28-mega-assessment.json)

## What belongs here

```text
audit/
├── README.md                         # index and audit rules
├── PROMPT.md                         # reusable session opener
├── PLAN.md                           # living improvement ledger
├── FINDINGS-YYYY-MM-DD.md            # append-only dated interpretation
└── baselines/
    └── YYYY-MM-DD-<source>.json       # append-only raw measurement
```

## Audit loop

```text
read latest baseline and plan
  select at most two active weaknesses
  change the smallest owning rule or tool
  exercise it in real work
  collect the evidence named in PLAN.md
  keep, revise, or reverse the change
  record a new dated baseline when the window is large enough
```

## Rules

1. Dated findings and raw baselines are append-only. Add a newer file instead of rewriting history.
2. `PLAN.md` is mutable. It holds current work, evidence, and decisions.
3. Change at most two collaboration mechanisms per iteration. Otherwise the evidence cannot identify what helped.
4. Improve real work, not the assessment score. A low score can be acceptable when a standing rule deliberately owns the behavior.
5. Separate three actors in every review: the operator, the main agent, and delegated workers.
6. Do not mark an item addressed because the rule was written. Mark it addressed only after the stated evidence appears in real sessions.
7. Preserve strengths while fixing weak seams. Approval boundaries, clear outcomes, evidence-first corrections, and durable learning are regression guards.
