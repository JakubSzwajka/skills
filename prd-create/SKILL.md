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

### Present Summary

After creating subtasks, show:
- Total subtask count and dependency structure
- Which subtasks are parallelizable (no deps)
- Any subtasks that seem risky (flag for review)

## Phase 4: Auto-Challenge

After creating the task tree, **automatically spawn a challenger subagent** to stress-test the PRD against the codebase. Do not ask the user — just do it.

Spawn the challenger with these instructions:

1. **Read the parent task** description (the PRD) via `pitodo action=get`
2. **Read all subtasks** to understand the planned decomposition
3. **Deep-dive the codebase** — for each major claim or assumption in the PRD:
   - Verify models, schemas, facades exist as described
   - Check module boundaries and dependency rules
   - Count affected test files and consumers accurately
   - Verify dependency ordering makes sense
4. **Log findings** to the parent task via `pitodo action=log`:

```
[CHALLENGE] Verdict: FEASIBLE / FEASIBLE WITH CONCERNS / NEEDS REWORK

What works:
- <bullet points with file:line refs>

Problems found:
- [P1] <blocker — must fix before starting>
- [P2] <significant — will cause rework>
- [P3] <minor — can resolve during implementation>

Missing from PRD:
- <things the codebase reveals that the PRD doesn't address>

Suggested changes:
- <specific updates to task descriptions or dependencies>
```

The challenger must:
- Reference actual files and line numbers
- Challenge whether the approach is the right one
- Check for simpler alternatives
- Count affected files accurately — verify, don't trust estimates
- Look for hidden coupling and undocumented behaviors

## Phase 5: Present Results

After the challenger completes, present to the user:
1. The task tree (parent + subtasks with deps)
2. The challenge findings
3. Ask: "Want me to update the PRD based on these findings, or proceed as-is?"

If the user wants updates, modify the parent task description and/or subtask descriptions via `pitodo action=update`.

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

Once the PRD is created and challenged:
- If verdict is FEASIBLE → "PRD and tasks are ready. Want me to run the pipeline to implement?"
- If verdict is FEASIBLE WITH CONCERNS → "Want me to update the PRD with the suggested fixes first?"
- If verdict is NEEDS REWORK → "The challenger found significant issues. Let's rework the PRD together."
