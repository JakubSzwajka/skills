# PRD Format Reference

`prd.md` is the product/spec contract. Keep it readable, but make completion auditable.

```md
# <Title>

## Problem
<What's broken, missing, or suboptimal.>

## Goal
<What success looks like in user/product terms.>

## Scope
- <Included behavior/change>

## Acceptance Criteria
- <Observable requirement that can be verified against artifacts>
- <Observable requirement that can be verified against artifacts>

## Key Cases
- <Primary scenario to handle>

## Out of Scope
- <Explicit non-goal>

## Stop Conditions
- Ask user if <decision or tradeoff appears>
- Stop if <external dependency/blocker appears>
- Move to review when <handoff condition is reached>

## Collateral
Populate by scanning the codebase; do not guess.
- **Tests:** <coverage expected / infra status>
- **Docs:** <README/API/docs needing updates>
- **Config:** <env/config changes>
- **Observability:** <logs/metrics/tracing/alerts>
- **Schema:** <tables/columns/migrations/data implications>

## Notes
- Branch: TBD
- Notion task: <url or N/A>
- Relevant files: <paths if known>
- KB links: [[node-name]] or N/A
```

Rules:
- Acceptance criteria must be concrete enough for a later completion audit.
- Stop conditions are boundaries for AFK/pipeline; use them to prevent autonomous scope decisions.
- Collateral items become subtasks when meaningful.
