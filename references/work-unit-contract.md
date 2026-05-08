# Work Unit Contract

A work unit is a task small and explicit enough that a fresh agent or human can pick it up without conversation history.

## Required fields

Use this shape inside each `tasks/<task-id>.md` file unless the repo has a stricter local format.

```md
# T1 — <short imperative title>

Status: open | in_progress | review | blocked | done | cancelled
Kind: implementation | research | test | review | docs | decision
Agent: <runtime agent name or blank; use `programmer` for implementation units unless there is a deliberate exception>
Review: <runtime review agent name or blank>
Deps: <comma-separated unit ids or `none`>
Owner: agent | human | either

Intent:
<why this unit exists and what outcome it creates>

Targets:
- `<path or module>` — <why likely relevant>

Context:
- <facts a fresh worker needs>
- <patterns/constraints/decisions already known>

Acceptance:
- <observable condition that must be true>
- <another condition>

Validation:
- `<command or check>` — <what it proves>

Evidence:
- pending

Discussion log:
- pending

Blockers:
- none

Deferred decisions:
- <known decision that does not block this unit, or `none`>

Handoff:
- <what to update/report when complete>
```

## Runnable rule

A unit is runnable only when:

- `Status` is `open` or `in_progress`
- all `Deps` are `done`
- `Blockers` is `none` or empty
- `Intent`, `Targets`, `Acceptance`, and `Validation` are specific enough to delegate

`Deferred decisions` do not block execution. Do not put deferred production choices in `Blockers` unless the current unit cannot be safely executed without them.

If the processor finds a weak unit, it should stop and route back to the factory instead of guessing.

## One-file-per-unit rule

Each work unit lives in its own `tasks/<task-id>.md` file. `tasks/index.md` is only the plan map: ordered unit list, dependencies, status summary, and routing. Do not duplicate full task bodies in the index.

During planning, delegated subagents may append clearly marked notes only to the `Discussion log` section of assigned task files when the parent explicitly grants that scope. Final task text, status, dependencies, blockers, acceptance, and validation are owned by the parent factory.

## Minimal routing

Keep routing dumb in v0:

- If `Agent` is set, processor uses it.
- Else processor maps by `Kind` only when obvious.
- Start with four role stewards: `product-owner`, `architect`, `designer`, `qa`.
- Use `programmer` for implementation units. If `Agent` is blank on an implementation unit with `Owner: agent`, the processor treats it as `programmer` for backward compatibility.
- The programmer is an execution role, not a decision owner: missing product/architecture/design/quality decisions must be escalated instead of guessed.
- Human decisions use `Owner: human`.

Avoid capability graphs, weights, pools, manager trees, or fake worker roles until the simple form breaks.
