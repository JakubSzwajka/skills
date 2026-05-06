# Work Unit Factory + Processor Plan

Date: 2026-05-06
Status: sketch / not implemented

## Core idea

`prd-create` should stay as-is for now.

The next layer should be a pair of workflows:

1. **Work Unit Factory** — turns an idea/PRD/task folder into detailed, loopable work units.
2. **Work Unit Processor** — repeatedly executes one work unit at a time through appropriate agents/workers/people.

The point is not "write better PRDs". The point is to manufacture units of work that can move through a long-running process without relying on the original conversation.

> A good work unit can be picked up by a fresh agent, worker, or human with no chat history and still be executed safely.

## Why this matters

Current repo-local task artifacts are already the right source of truth:

```txt
docs/tasks/active/<task-id>/
  prd.md
  tasks.md
  log.md
```

But many generated tasks are still too thin:

- target files are guessed or missing
- acceptance criteria are vague
- validation is generic
- dependencies are incomplete
- product/design decisions are hidden inside the original chat
- future agents have to infer too much

That makes long-running loops fragile. The processor can only be as good as the work units it consumes.

## Mental model

```txt
Idea / rough PRD / existing task folder
        │
        ▼
┌─────────────────────┐
│ Work Unit Factory   │
│ creates/refines     │
│ executable units    │
└─────────┬───────────┘
          │
          ▼
docs/tasks/active/<task-id>/tasks.md
          │
          ▼
┌─────────────────────┐
│ Work Unit Processor │
│ executes one unit   │
│ per pass            │
└─────────┬───────────┘
          │
          ▼
logs, evidence, review, next unit
```

## Work Unit Factory

### Job

Create or improve detailed work units that are:

- independently understandable
- dependency-aware
- scoped enough for one pass
- explicit about target files/modules
- explicit about acceptance and validation
- honest about blockers and missing decisions
- reviewable before execution

### Inputs

- user idea / request
- existing `prd.md`, `tasks.md`, `log.md`
- codebase structure and architecture docs
- existing patterns/tests
- product/design constraints from the conversation

### Outputs

Usually writes or refines:

```txt
docs/tasks/active/<task-id>/
  prd.md
  tasks.md
  log.md
  challenge-product.md?       # optional
  challenge-architecture.md?  # optional
  challenge-design.md?        # optional
  work-unit-review.md?        # optional
```

### Work unit contract

Each unit should look roughly like this:

```md
## T3 — Add run retry endpoint

Status: open
Deps: T1, T2
Owner: agent | human | either
Kind: implementation | research | design | review | test | docs | decision
Intent: Allow an operator to retry a failed run without reusing stale prompt snapshots.

Targets:
- `packages/api/src/routes/runs.ts`
- `packages/api/src/modules/execution/...`

Context:
- Retry should create a new queued run linked by `retryOfRunId`.
- Prompt snapshots should be recomposed at claim time, not copied from the old run.
- Original run must remain unchanged.

Acceptance:
- `POST /api/runs/:runId/retry` creates a queued retry run.
- New run has `retryOfRunId = original.id`.
- Original run row is unchanged.
- Retry appears in run detail read model.

Validation:
- `npm test -- retry-run`
- targeted route/service tests pass

Evidence:
- pending

Blockers:
- none

Handoff:
- On success, mark done and note endpoint/test evidence in `log.md`.
- If route shape is disputed, block for product/API decision.
```

### Factory roles / agents

Not every role runs every time. Use based on complexity.

#### 1. Product Framer

Purpose: make sure the unit exists for the right reason.

Checks:
- who is this for?
- what user/operator behavior changes?
- what is the smallest useful version?
- what is explicitly out of scope?
- what would make this not worth doing?

Output: sharper goal/scope/non-goals.

#### 2. Codebase Scout

Purpose: bring implementation reality into the plan before tasking.

Read-only.

Finds:
- existing modules/routes/components
- similar features to copy
- architecture docs and boundaries
- likely target files
- test patterns
- hidden coupling/risk

Output: implementation terrain map.

#### 3. Architecture Challenger

Purpose: stress-test the implementation shape.

Checks:
- does this fit existing module boundaries?
- does it introduce new domain concepts?
- where should state live?
- what migration/backcompat/runtime risks exist?
- what tests should guard this?

Output: constraints, risks, recommended path.

#### 4. UX / Design Challenger

Conditional. Use for user-facing UI/product flows.

Checks:
- primary action
- states: empty/loading/error/success
- copy/i18n
- accessibility/mobile behavior
- trust and clarity

Output: UI requirements that become task acceptance/context.

#### 5. Task Packet Designer

Purpose: convert intent + terrain into detailed work units.

This is the core role.

Responsibilities:
- split work into units small enough for one processor pass
- assign dependencies
- define target files/modules
- write concrete acceptance criteria
- define validation commands/checks
- mark blockers honestly
- label unit kind and owner suitability

Output: `tasks.md` work units.

#### 6. Red-Team Reviewer

Purpose: attack the generated work units before execution.

Checks for:
- vague tasks
- missing acceptance criteria
- generic validation
- impossible dependencies
- incorrect target files
- hidden product/design decisions
- tasks that require too much inference
- tasks that are too broad for one pass

Output: GO / NO-GO with fixes.

## Work Unit Processor

### Job

Execute exactly one runnable work unit per pass, then stop.

This is mostly what `pipeline` is becoming.

### Inputs

- `docs/tasks/active/<task-id>/prd.md`
- `docs/tasks/active/<task-id>/tasks.md`
- `docs/tasks/active/<task-id>/log.md`
- git state
- architecture docs
- work unit contract

### Runnable rule

A unit is runnable when:

- status is `open` or `in_progress`
- all dependencies are `done`
- blockers are empty
- kind is executable by the selected worker/agent
- target/context/acceptance/validation are detailed enough

If not detailed enough, processor should stop and route back to Factory/repair instead of guessing.

### Processor pass

```txt
1. locate task folder
2. read prd/tasks/log
3. pick one runnable unit
4. choose worker role
5. pre-read required context
6. spawn/assign worker
7. collect report
8. verify evidence
9. run review gate if code changed
10. update tasks/log
11. emit handoff packet
12. stop
```

### Processor worker roles

#### Implementation Worker

Edits code/docs for one implementation unit.

#### Research Worker

Read-only. Produces a decision-ready finding or terrain map.

#### Test Worker

Adds or runs tests for one unit.

#### Review Worker

Read-only. Reviews diff or specific completed unit.

#### Fixer Worker

Edits only for one review finding.

#### Human Owner

Some units should be explicitly human-owned:

- product decision
- design taste choice
- external credential/access
- business priority call

The processor should not pretend agents can resolve these.

## Handoff packet

Every processor pass should end with a compact operational packet:

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

This packet should be shown to the user and written or summarized in `log.md`.

## Factory / Processor relationship

The processor should not patch vague work units by guessing. If a unit is weak, it should hand it back to the factory.

```txt
Processor finds vague unit
  -> mark unit blocked or needs_refinement
  -> add log entry explaining missing context
  -> Factory repair pass improves the unit
  -> Processor resumes later
```

This creates an actual long-running loop:

```txt
factory -> processor -> review -> repair/refine -> processor -> ...
```

## Skill design options

### Option A: separate skills

```txt
work-unit-factory/
work-unit-processor/
```

Pros:
- clean mental model
- separate triggers and responsibilities
- easier to evolve independently

Cons:
- overlaps with `prd-create` and `pipeline`
- more skills to remember

### Option B: extend existing skills

```txt
prd-create --factory / --repair
pipeline as processor
```

Pros:
- preserves existing names
- less proliferation
- maps to current artifacts

Cons:
- `prd-create` may become too broad
- processor/factory boundary less obvious

### Current preference

Keep `prd-create` as-is for now.

Plan a new factory skill first, then decide whether it replaces/extends `prd-create` after testing:

```txt
work-unit-factory
```

Keep `pipeline` as the first version of:

```txt
work-unit-processor
```

## Open questions

1. Should work units live only in `tasks.md`, or should each unit become its own file?
   - `tasks.md` is simpler.
   - one-file-per-unit is better for long-running parallel work, review, and large tasks.

2. Do we need statuses beyond current task statuses?
   - maybe: `needs_refinement`, `ready`, `assigned`, `review`, `blocked`, `done`.

3. Should unit owner be explicit?
   - likely yes: `agent`, `human`, `either`, maybe role-specific.

4. Should the factory be allowed to edit existing PRD scope, or only task units?
   - probably yes, but it must log scope changes clearly.

5. How much codebase scouting is required before tasking?
   - enough to name likely files/patterns/tests, not enough to implement.

6. Should red-team review be mandatory?
   - maybe mandatory for `--deep`, optional/light for normal mode.

7. Should processor auto-run next unit in AFK mode?
   - probably not by default. One unit per pass is safer.
   - a separate goal runner can repeatedly invoke processor.

## First implementation slice

Do not build the whole team system first.

Start with:

1. `work-unit-factory` skill that repairs/enriches an existing `docs/tasks/active/<task-id>/tasks.md`.
2. It runs:
   - Codebase Scout
   - Task Packet Designer
   - Red-Team Reviewer
3. It outputs improved `tasks.md` and a `work-unit-review.md`.
4. Then `pipeline` consumes one improved unit.

This tests the core idea without replacing `prd-create`.
