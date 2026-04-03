---
name: prd-create
description: >
  Capture a feature idea or change as a structured pitodo task tree, then auto-challenge it against the codebase.
  Use when the user wants to write a PRD, capture a feature idea, plan a change, break work into tasks,
  or says things like "create a prd", "plan this", "break this down", "decompose into tasks",
  "create tasks for", "prd to tasks".
---

# PRD Skill

## Philosophy

PRDs are **quick-capture documents for change ideas** stored as pitodo task trees. You spot something that needs doing, sketch it — problem, solution shape, key cases — and capture it as a parent task with subtasks. The pitodo task log serves as the working notebook across sessions.

Key constraints:
- The parent task description is the PRD — keep it **under 300 lines**
- Subtasks are the implementation units with dependency ordering via `dependsOnIds`
- Task logs replace notebook.md — append progress notes, decisions, and gotchas
- The challenge phase runs automatically after creation

## Phase 1: Quick Interview (2-4 questions)

Don't over-interview. Ask just enough to fill the structure:

1. **What's the problem?** — What's broken, missing, or suboptimal?
2. **What's the rough solution?** — High-level shape, not implementation details.
3. **What are the key cases?** — Main scenarios to handle. 3-6 bullets.
4. **What's out of scope?** — Prevent future scope creep.

If the user already described all this, skip straight to drafting.

## Phase 2: Create Parent Task

Use `pitodo action=add` to create the parent task:

- **title**: `[ProjectName] <imperative description>` (match existing convention)
- **description**: The full PRD content using this structure:

```
Branch: TBD

## Problem
<What's broken, missing, or suboptimal>

## Goal
<What success looks like>

## Scope
- <bullet points of what's included>

## Collateral
<Non-functional neighbors of this change. Populate by scanning the codebase — don't guess.>
- **Tests:** What test coverage is expected? Does test infrastructure exist, or must it be set up first?
- **Docs:** Which READMEs, architecture docs, or API specs need updating?
- **Config:** Any new env vars? Are .env.example files affected?
- **Observability:** Any new endpoints or flows that need logging, metrics, or tracing?
- **Schema:** Any new tables, columns, or migrations? Is the data model documented?

## Key cases
- <main scenarios to handle>

## Out of scope
- <what we're NOT doing>

## Notes
<implementation hints, relevant files, related work>
```

- **projectId**: Match to the relevant project (check `pitodo action=project_list`)
- **tags**: Optional, use sparingly

## Phase 3: Decompose into Subtasks

Analyze the codebase based on the PRD content, then create subtasks:

1. **Search for files, modules, and patterns** mentioned or implied by the PRD
2. **Understand the existing architecture** relevant to the change
3. **Identify integration points**, shared types, and test files
4. **Note conventions** (naming, file structure, patterns)

For each subtask, use `pitodo action=add`:

- **parentId**: The parent task ID from Phase 2
- **title**: Imperative verb phrase — "Add validation to login form", "Extract shared types"
- **description**: 2-5 sentences of what to change and why. Reference concrete files. Include a validates check.
- **dependsOnIds**: IDs of subtasks that must complete first (siblings only)

### Subtask Sizing

A well-sized subtask:
- Is reviewable in one pass
- Touches a coherent slice of related changes
- Can be described in 2-5 sentences
- Has a clear done state

Prefer many small tasks over few large ones.

### Collateral Subtasks

The Collateral section in the PRD identifies non-functional work. Turn each non-empty collateral item into a subtask (or fold it into an existing one if the scope is small). Examples: "Add vitest and write integration tests for new endpoints", "Update API README with new route", "Add LOG_LEVEL to .env.example". If the collateral section says test infrastructure doesn't exist, the first subtask should set it up — not the last.

### Present Summary

After creating subtasks, show:
- Total subtask count and dependency structure
- Which subtasks are parallelizable (no deps)
- Any subtasks that seem risky (flag for review)

## Phase 4: Challenge Loop

After creating the task tree, run an **automated challenge-and-resolve loop**. Do not ask the user — converge autonomously, then hand off a clean result.

### Pre-Challenge: Load Architecture Context

Before spawning the challenger, check whether the project has defined architecture rules:

1. Look at what's already in your context: AGENTS.md, CLAUDE.md, project instructions, repo root README.
2. If any of those mention or link to an architecture document, follow it and read it.
3. If structural rules exist (layer rules, module boundaries, event conventions, transaction boundaries), include them in the challenger's prompt.
4. If no architecture rules are found, log to the parent task:
   `🏗️ Architecture: Not defined. Could not verify module boundaries, layer placement, or integration patterns. Recommend defining architecture rules before implementing structural changes.`
   This is not a blocker — the PRD proceeds, but the flag is visible for whoever reviews or implements it.

### Round 1: Challenger

Before spawning, gather the challenger's inputs:
1. Read the parent task description (the PRD) via `pitodo action=get`
2. Read all subtasks via `pitodo action=list` filtered to the parent
3. If architecture rules were loaded in Pre-Challenge, capture them

Then spawn the challenger using the `spawn` tool:

```
spawn:
  model: claude-opus-4  # or openai/gpt-5.4 — always use a strong model
  tools: [read, bash]    # read-only — bash for grep/find/git only
  systemPrompt: |
    You are a PRD challenger. You stress-test PRDs against actual codebases.
    You are READ-ONLY — never modify files.
    
    Your job: verify every claim and assumption in the PRD against the real code.
    Be adversarial but specific — always cite file:line.
    Challenge whether the approach is the right one. Check for simpler alternatives.
    Count affected files accurately — verify, don't trust estimates.
    Look for hidden coupling and undocumented behaviors.
  task: |
    ## Challenge this PRD
    
    ### PRD Content
    <full parent task description>
    
    ### Subtasks
    <for each subtask: id, title, description, dependsOnIds>
    
    ### Architecture Rules
    <architecture rules if defined, or "Not defined">
    If architecture rules are defined: verify each subtask places code in the
    correct layer, respects module boundaries, and doesn't introduce cross-module
    coupling. Flag violations as P1.
    
    ### Instructions
    
    For each major claim or assumption in the PRD:
    - Verify models, schemas, facades exist as described
    - Check module boundaries and dependency rules
    - Count affected test files and consumers accurately
    - Verify dependency ordering makes sense
    
    ### Output Format
    
    Respond with EXACTLY this structure:
    
    ```
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
    - <specific updates to task descriptions or dependencies>
    ```
```

After the subagent completes, log its findings to the parent task via `pitodo action=log author=pi` with the `[CHALLENGE]` prefix.

### Convergence Rules

After each challenge round, evaluate the verdict:

- **FEASIBLE** → proceed directly to Phase 5.
- **FEASIBLE WITH CONCERNS** → auto-resolve. For each concern:
  - If the fix is clear (missing type, wrong validation approach, missing file reference, dependency order fix) → apply it immediately by updating the parent PRD and/or subtask descriptions via `pitodo action=update`. Do NOT ask the user.
  - If the concern is genuinely ambiguous or changes scope → collect it for user escalation.
  - After applying fixes, spawn the challenger again (same pattern as Round 1, but scoped to the fixed areas). This is Round 2.
- **NEEDS REWORK** → attempt one round of fixes for anything actionable, then re-challenge with a scoped spawn. If still NEEDS REWORK after that, escalate to the user.

### Loop Limits

- **Maximum 3 challenge rounds.** If the verdict is not FEASIBLE after 3 rounds, stop and escalate.
- Each round after the first should be scoped: the challenger only re-verifies the fixes and any areas they previously flagged, not the entire PRD from scratch.
- Log each round's verdict and what was fixed to the parent task via `pitodo action=log author=pi`.

### What "auto-resolve" means

Auto-resolve = update task descriptions, fix dependency ordering, add missing type references, correct file paths, adjust validation approach, add missing test cases to subtask scope. These are mechanical fixes that don't change the product direction.

Do NOT auto-resolve: scope changes, architectural alternatives, "should we even do this?" questions, trade-offs that need product judgment. Escalate these.

## Phase 5: Present Clean Result

Only present to the user **after the challenge loop converges to FEASIBLE** (or after max rounds with escalation items).

### Executive Summary (required)

Start with a **3-5 sentence summary** of the final PRD:
- What is this ticket about? (1-2 sentences)
- What's the user-facing impact? (1 sentence)
- What's the implementation shape? (1-2 sentences)

This summary should be understandable without reading the full PRD or subtask tree.

### Then show:
1. The task tree (parent + subtasks with deps, compact format)
2. What was challenged and resolved (brief — "X concerns raised, Y auto-fixed, Z escalated")
3. Any escalation items that need the user's judgment (if any)

### Handoff message

- If fully converged (FEASIBLE, no escalations): "PRD is ready for review. Want me to run the pipeline to implement?"
- If converged with escalations: "PRD is ready except for [N] questions that need your input: [list]. Once resolved, we can implement."
- If did not converge (max rounds hit): "The challenge loop couldn't fully resolve these issues: [list]. Let's rework together."

## Consulting Existing PRDs

Before creating a new PRD, check pitodo for existing tasks in the same project:
- `pitodo action=list` filtered by project
- Look for overlapping or related work
- Reference existing tasks in the new PRD's notes if relevant

## Task Log as Notebook

The parent task's log serves as the cross-session notebook:
- **Before starting any subtask**, read the parent task log for context
- **After discovering something worth sharing**, append via `pitodo action=log`:
  - Constraints, non-obvious decisions, gotchas
  - Use author="pi" for agent notes

## After PRD Creation

The challenge loop handles convergence automatically. By the time Phase 5 fires, the PRD is either ready or has specific escalation questions. See Phase 5 handoff messages for the exact flow.
