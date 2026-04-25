---
name: prd-create
description: >
  Capture a feature idea or change as a repo-local PRD task folder under docs/tasks/active/,
  then auto-challenge it against the codebase. Use when the user wants to write a PRD,
  capture a feature idea, plan a change, break work into tasks, or says things like
  "create a prd", "plan this", "break this down", "decompose into tasks", "create tasks for",
  "prd to tasks".
---

# PRD Skill

## Philosophy

This skill is the **canonical owner of the repo-local task artifact format**.

PRDs and task plans live in:

```txt
docs/tasks/active/<YYYY-MM-DD-task-name>/
  prd.md
  tasks.md
  log.md
```

Archived work lives in:

```txt
docs/tasks/archive/<YYYY-MM-DD-task-name>/
  prd.md
  tasks.md
  log.md
```

This folder is the canonical source for active work in the repo.

- `prd.md` = the spec / change doc
- `tasks.md` = the execution plan, checklist, statuses, and dependencies
- `log.md` = the running notebook across sessions

Canonical statuses for the overall task and each subtask:
- `open` — queued, not started yet
- `in_progress` — actively being worked on
- `review` — implementation is complete enough for handoff/review, or waiting on an external response
- `done` — finished
- `cancelled` — intentionally dropped

Archive semantics:
- active work stays under `docs/tasks/active/`
- move a task folder to `docs/tasks/archive/` only when the overall task is `done` or `cancelled`

Knowledge still belongs in the KB, but tasks and PRDs do **not**. Link to KB when useful; do not store operational state there.

Key constraints:
- The PRD lives in `prd.md`, not inside some fake task description field
- The execution plan lives in `tasks.md`, not in the KB and not in any central tracker
- Notes, challenge findings, and progress go in `log.md`
- The challenge phase runs automatically after creation
- Other skills, especially `pipeline`, consume and update this artifact format rather than redefining it

## Phase 1: Quick Interview (2-4 questions)

Don't over-interview. Ask just enough to fill the structure:

1. **What's the problem?** — What's broken, missing, or suboptimal?
2. **What's the rough solution?** — High-level shape, not implementation details.
3. **What are the key cases?** — Main scenarios to handle. 3-6 bullets.
4. **What's out of scope?** — Prevent future scope creep.

If the user already described all this, skip straight to drafting.

## Phase 2: Create the Task Folder

Create a repo-local task folder:

```txt
docs/tasks/active/<task-id>/
```

Where `<task-id>` is:

```txt
YYYY-MM-DD-task-name
```

Use a short, readable slug. If there is an obvious repo/project prefix in the task title, keep it in the human title, not necessarily in the folder name.

### Write `prd.md`

Use this structure:

```md
# Title
<Short descriptive title>

## Problem
<What's broken, missing, or suboptimal>

## Goal
<What success looks like>

## Scope
- <bullet points of what's included>

## Collateral
<Non-functional neighbors of this change. Populate by scanning the codebase — don't guess.>
- **Tests:** What coverage is expected? Does infrastructure exist?
- **Docs:** Which READMEs, architecture docs, or API specs need updating?
- **Config:** Any env vars or config changes?
- **Observability:** Logging, metrics, tracing, alerts?
- **Schema:** Tables, columns, migrations, data model implications?

## Key cases
- <main scenarios to handle>

## Out of scope
- <what we're NOT doing>

## Notes
- Branch: TBD
- Relevant files: <paths if known>
- KB links: [[node-name]]
```

### Write `tasks.md`

This file is the execution plan. It should contain:
- parent task title / summary
- overall status using one of: `open`, `in_progress`, `review`, `done`, `cancelled`
- subtasks with stable IDs like `T1`, `T2`, `T3`
- per-subtask status using the same canonical set
- per-subtask dependencies
- concrete notes and target files/modules when known

Use a readable markdown structure. Example:

```md
# Tasks

Overall status: open

## T1 Design repo-local task schema
- status: open
- deps: []
- notes: Define the storage layout and file responsibilities.

## T2 Update PRD skill
- status: open
- deps: [T1]
- notes: Make prd-create emit the canonical docs/tasks artifact format.

## T3 Update pipeline skill
- status: open
- deps: [T1]
- notes: Read prd.md, tasks.md, and log.md from docs/tasks/active.
```

### Write `log.md`

Initialize it like this:

```md
# Log

- YYYY-MM-DD HH:MM lucy: Created PRD and initial task breakdown.
```

## Phase 3: Decompose into Subtasks

Analyze the codebase based on the PRD, then create subtasks in `tasks.md`:

1. Search for files, modules, and patterns mentioned or implied by the PRD
2. Understand the existing architecture relevant to the change
3. Identify integration points, shared types, and test files
4. Note conventions: naming, file structure, patterns

For each subtask:
- use a stable ID (`T1`, `T2`, ...)
- title should be an imperative phrase — "Add validation to login form", "Extract shared types"
- notes should be 2-5 sentences or concise bullets describing what changes and why
- reference concrete files where possible
- include a validation expectation
- include `deps: [...]` using sibling IDs only

### Subtask Sizing

A good subtask:
- is reviewable in one pass
- touches a coherent slice of changes
- can be described briefly but concretely
- has a clear done state

Prefer several small tasks over a few swamp-monsters.

### Collateral Subtasks

Turn each meaningful collateral item into its own subtask or fold it into an existing one if truly tiny. Examples:
- add or extend tests
- update README / API docs
- update `.env.example`
- add migration
- add instrumentation

If test infrastructure doesn't exist, setup goes first — not at the end like some cursed afterthought.

### Present Summary

After creating the plan, show:
- total subtask count and dependency structure
- which subtasks are parallelizable
- any risky subtasks worth review

## Phase 4: Challenge Loop

After creating the task folder, run an **automated challenge-and-resolve loop**. Do not ask the user unless a real ambiguity or scope decision remains.

### Pre-Challenge: Load Architecture Context

Before spawning the challenger:
1. CLAUDE.md is already in your system prompt — do not re-read it. Extract architecture rules from what you already have.
2. Only read additional docs (README, AGENTS.md, adjacent repo docs) if they contain architecture rules you'll actually include in the challenger's prompt. Don't read files speculatively.
3. If structural rules exist, include them in the challenger's prompt.
4. If no architecture rules are found, append this to `log.md`:

```md
- YYYY-MM-DD HH:MM lucy: 🏗️ Architecture not defined. Could not verify module boundaries, layer placement, or integration patterns.
```

This is not a blocker; it's just useful honesty.

### Round 1: Challenger

Before spawning, gather:
1. Full `prd.md`
2. Full `tasks.md`
3. Relevant architecture rules, if any

Then launch a **single** challenger subagent. The challenger must write its full verdict to a file — spawn results get truncated, so never rely on the return value for the full output. One spawn per round, no chains.

```txt
model: claude-opus-4  # or openai/gpt-5.4 — always use a strong model
tools: [read, bash, write]  # write needed for verdict file only
systemPrompt: |
  You are a PRD challenger. You stress-test PRDs against actual codebases.
  You may ONLY write to the verdict file specified in the task — no other file modifications.

  Your job: verify every claim and assumption in the PRD against the real code.
  Be adversarial but specific — always cite file:line.
  Challenge whether the approach is the right one. Check for simpler alternatives.
  Count affected files accurately — verify, don't trust estimates.
  Look for hidden coupling and undocumented behaviors.
task: |
  ## Challenge this PRD

  Read:
  - <absolute path to prd.md>
  - <absolute path to tasks.md>

  ### Architecture Rules
  <architecture rules if defined, or "Not defined">

  ### Instructions
  For each major claim or assumption in the PRD:
  - verify models, schemas, facades, entry points, and target modules exist as described
  - check module boundaries and dependency rules
  - count affected tests and consumers accurately
  - verify dependency ordering in tasks.md makes sense

  ### Output
  Write your FULL verdict to: <task-folder>/challenge-r<N>.md
  Also return the VERDICT line in your final message.

  Use EXACTLY this structure in the file:

  VERDICT: FEASIBLE / FEASIBLE WITH CONCERNS / NEEDS REWORK

  What works:
  - <bullet points with file:line refs>

  Problems found:
  - [P1] <blocker — must fix before starting> — file:line
  - [P2] <significant — will cause rework> — file:line
  - [P3] <minor — can resolve during implementation> — file:line

  Missing from PRD:
  - <things the codebase reveals that the PRD doesn't address>

  Suggested changes:
  - <specific updates to prd.md or tasks.md>
```

**After the subagent completes:**
1. Read `<task-folder>/challenge-r<N>.md` for the full verdict — do NOT rely on the spawn return value
2. Append the verdict to `log.md`
3. Delete the challenge file after incorporating findings (it's transient, not an artifact)

### Convergence Rules

After each challenge round:

- **FEASIBLE** → proceed to Phase 5
- **FEASIBLE WITH CONCERNS** → auto-resolve anything mechanical by editing `prd.md` and/or `tasks.md`, then re-challenge the fixed areas
- **NEEDS REWORK** → attempt one round of mechanical fixes; if major ambiguity remains after re-challenge, escalate

### What counts as auto-resolve

Allowed:
- fix dependency ordering
- add missing file references
- correct target modules or type references
- add missing tests/docs/config subtasks
- tighten validation notes

Not allowed:
- changing product direction
- introducing major architectural alternatives without user buy-in
- changing scope in a meaningful way
- deciding ambiguous tradeoffs the user should own

### Loop Limits

- maximum 3 challenge rounds
- each round after the first should be scoped to prior findings
- append each round's verdict and fixes to `log.md`

## Phase 5: Present Clean Result

Only present after the challenge loop converges or reaches clear escalation.

### Executive Summary (required)

Start with 3-5 sentences:
- what this task is about
- the user-facing impact
- the implementation shape

### Then show:
1. task folder path
2. compact task tree from `tasks.md`
3. what was challenged and resolved
4. any escalation items needing judgment

### Handoff message

- If fully converged: `PRD is ready for review. Want me to run the pipeline to implement?`
- If converged with escalations: `PRD is ready except for [N] questions that need your input: [list]. Once resolved, we can implement.`
- If not converged: `The challenge loop couldn't fully resolve these issues: [list]. Let's rework together.`

## Consulting Existing PRDs

Before creating a new task folder, check for overlapping work in:

```txt
docs/tasks/active/
docs/tasks/archive/
```

Read relevant existing `prd.md` / `tasks.md` files and reference them in the new PRD's notes if useful.

## Log as Notebook

The task folder's `log.md` is the cross-session notebook:
- before starting implementation, read it
- after finding something worth preserving, append it
- use `lucy` as the author in the log text

## After PRD Creation

By the time Phase 5 fires, the repo should contain a ready task folder under `docs/tasks/active/<task-id>/` with:
- `prd.md`
- `tasks.md`
- `log.md`

That folder is the handoff artifact and the canonical task format for downstream skills. Not the KB. Not some separate tracker. The actual repo. Wild concept.