# Work Unit Factory + Processor Plan

Date: 2026-05-06
Status: v0 implemented for factory planning; processor is still a sketch

## Goal

Build a repo-local planning/execution system where:

1. **Work Unit Factory** produces high-quality, loopable work units.
2. **Work Unit Processor** later iterates those units one at a time.

`prd-create` and current `pipeline` stay as-is while this proves itself.

The point is not "better PRDs". The point is:

> manufacture work units that a fresh agent, worker, or human can execute safely without the original conversation.

## Current focus

V0 focuses on **planning**.

The juice is the parent/operator running `work-unit-factory`:

```txt
work-unit-factory parent
  -> product-owner
  -> architect
  -> designer   # only when user-facing design/brand/copy matters
  -> qa
  -> parent asks blocking questions
  -> parent updates repo knowledge docs
  -> parent synthesizes executable work units
  -> parent self-redteams executability
```

No managers. No recursive subagents. No generic implementer/reviewer/fixer roles yet. No `work-unit.` prefix in agent runtime names.

## Role stewards

An agent is:

```txt
role + responsibility + owned knowledge paths + decision rights + escalation rules + update rules
```

Initial role stewards:

| Agent | Owns | Guards |
| --- | --- | --- |
| `product-owner` | `docs/knowledge/product/` | users, workflows, scope, non-goals, product decisions |
| `architect` | `docs/knowledge/architecture/` | stack, boundaries, data ownership, runtime/deployment, technical decisions |
| `designer` | `docs/knowledge/design/` | UX, brand, copy voice, UI states, accessibility |
| `qa` | `docs/knowledge/quality/` | validation doctrine, tests, evidence, release checks |

Each steward:

1. reads existing repo knowledge first
2. reports current doctrine
3. reports blocking questions when doctrine is missing
4. recommends defaults with rationale
5. identifies docs to create/update
6. gives guidance for work units

Subagents do **not** ask the user directly. The parent asks Kuba, records answers, and updates repo docs.

## Repo knowledge layout

Preferred convention:

```txt
docs/knowledge/
  product/
    vision.md
    users.md
    workflows.md
    scope.md
  architecture/
    principles.md
    boundaries.md
    runtime.md
    data.md
    decisions.md
  design/
    principles.md
    brand.md
    copy-voice.md
    components.md
  quality/
    test-strategy.md
    validation.md
    release-checklist.md
```

If a repo already has equivalents (`docs/architecture.md`, ADRs, `docs/design.md`, README sections), stewards use those and report the mapping.

Task state still lives in:

```txt
docs/tasks/active/<task-id>/
  prd.md
  tasks.md
  log.md
```

Knowledge docs store durable “how this repo works.” Task artifacts store task-specific state.

## Work Unit Factory

### Job

Create or improve work units that are:

- independently understandable
- dependency-aware
- scoped enough for one pass
- explicit about target files/modules
- explicit about acceptance and validation
- honest about blockers and deferred decisions
- reviewable before execution

The factory must not silently invent foundational decisions.

If architecture, stack, product scope, design direction, auth, data ownership, deployment, or external-service boundaries would materially change the plan, the factory asks the smallest set of blocking questions with recommended defaults before creating work units.

### Inputs

- user idea/request
- existing task folder, if any
- repo knowledge docs
- repo guidance (`AGENTS.md`, `CLAUDE.md`, README, architecture/design docs)
- existing codebase structure/patterns/tests when present

### Outputs

Usually writes/refines:

```txt
docs/tasks/active/<task-id>/
  prd.md
  tasks.md
  log.md
```

May create/update durable knowledge docs under:

```txt
docs/knowledge/<domain>/...
```

Optional planning evidence can be written when useful:

```txt
work-unit-review.md
```

Keep optional artifacts useful, not ceremonial.

## Planning decision gate

Before work units are finalized, the parent synthesizes steward blockers and asks Kuba when missing choices materially affect the plan.

Examples:

- no architecture/stack in an empty repo
- unclear product/user workflow
- missing UI/design/brand direction for user-facing work
- unclear auth/security/multi-tenancy assumptions
- uncertain persistence/runtime/deployment target
- unsafe ambiguity around external systems

Use this distinction:

- **Blockers** — current planning/unit execution cannot proceed safely without this decision.
- **Deferred decisions** — known future/production choice, but current POC/local work can proceed.

## Work unit contract

Each unit should follow this shape:

```md
## T3 — Add run retry endpoint

Status: open
Kind: implementation | research | design | review | test | docs | decision
Owner: agent | human | either
Agent: <optional role steward/runtime agent>
Review: <optional role steward/runtime agent>
Deps: T1, T2

Intent:
<why this unit exists and what outcome it creates>

Targets:
- `path/or/module` — why likely relevant

Context:
- facts a fresh worker needs
- repo doctrine/constraints already decided

Acceptance:
- observable condition that must be true

Validation:
- `command or check` — what it proves

Evidence:
- pending

Blockers:
- none

Deferred decisions:
- none

Handoff:
- what to update/report when complete
```

A unit is runnable only when:

- status is `open` or `in_progress`
- dependencies are done
- blockers are empty/none
- intent, targets, acceptance, and validation are specific enough to delegate

## Minimal routing

Keep routing dumb:

- If `Agent` is set, use it.
- Else route by `Kind` only when obvious.
- Human decisions use `Owner: human`.
- Implementation units may leave `Agent` blank until execution roles exist.

Avoid capability graphs, weights, pools, managers, or fake worker roles until the simple form breaks.

## Work Unit Processor

Processor is the planned second skill.

Intended job:

```txt
1. load task folder
2. pick one runnable work unit
3. delegate/assign the unit
4. collect evidence
5. review if needed
6. update tasks.md/log.md
7. emit handoff packet
8. stop
```

Processor must not guess around weak units. If a unit is vague, it routes back to factory/repair instead of improvising.

V0 note: real execution workers are intentionally not defined yet. First prove that `work-unit-factory` can produce good plans.

## Handoff packet

Processor passes should end with:

```md
## Handoff

Status: DONE | BLOCKED | NEEDS REVIEW | NO-OP
Task: <task id / subtask id / scope>

Changed:
- `<path>` — <what changed>

Evidence:
- <acceptance/check> → <proof>

Validation:
- `<command>` — PASS / FAIL / not run because <reason>

Decisions:
- <decision made, or `none`>

Blockers:
- <blocker, missing input, failing check, or `none`>

Next:
- <one exact next action / next owner / next runnable task>
```

Factory can also use this shape when handing off a completed plan.

## First implementation slice

Already implemented/sketched:

1. `work-unit-factory`
   - calls `product-owner`, `architect`, `designer`, `qa`
   - pauses for missing foundational decisions
   - updates/creates concise repo knowledge docs
   - synthesizes work units
   - self-redteams executability

2. `work-unit-processor`
   - exists as an early sketch
   - should not be treated as production-ready until factory plans prove good

## Open questions for later

- Should large plans move from one `tasks.md` to one-file-per-unit?
- What extra statuses do we need after real processor runs? (`needs_refinement`, `review`, etc.)
- When do we add execution roles, if ever?
- Should factory have a repair-only mode for one weak unit?
- Should processor get an AFK/Ralph loop after one-unit mode is reliable?
