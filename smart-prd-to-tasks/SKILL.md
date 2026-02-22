---
name: smart-prd-to-tasks
description: >
  Decompose a PRD into ordered, dependency-aware, commit-sized tasks with codebase-aware file references.
  Trigger on: "smart-prd-to-tasks", "break down this PRD", "split PRD into tasks", "decompose PRD",
  "create tasks from PRD", "prd to tasks". Also re-runs to update existing task lists.
---

# Smart PRD to Tasks

Break a PRD into small, reviewable, dependency-aware tasks grounded in the actual codebase.

## Workflow

### 1. Locate the PRD

If the user names a PRD slug, look in `docs/prds/<slug>/`. Otherwise, list available PRDs and ask which one.

Read the PRD's `README.md` and any story files (`01-*.md`, `02-*.md`, etc.) in the directory.

### 2. Analyze the Codebase

Based on the PRD content:
- Search for files, modules, and patterns mentioned or implied by the PRD
- Understand the existing architecture relevant to the change
- Identify integration points, shared types, and test files
- Note conventions (naming, file structure, patterns) to keep tasks consistent

Spend real effort here — the value of this skill is **concrete, file-aware tasks**, not generic ones.

### 3. Generate or Update tasks.md

Read [references/task-format.md](references/task-format.md) for the exact output format and sizing guidelines.

**Creating new tasks.md:**
1. Decompose the PRD into the smallest reviewable units of work
2. Order tasks so dependencies come first
3. Mark dependency relationships explicitly
4. Reference concrete files from codebase analysis
5. Write each task description in 2-5 sentences — enough to act on immediately
6. Write the file to `<prd-directory>/tasks.md`

**Updating existing tasks.md:**
1. Read the current tasks.md
2. Preserve all `done` statuses — never uncheck completed work
3. Add, remove, or update tasks based on PRD changes or user instructions
4. Fix numbering and dependency references
5. Update the `last-updated` date

### 4. Present Summary

After writing tasks.md, show:
- Total task count and how many are parallelizable
- Any tasks that seem risky or uncertain (flag for user review)
- Suggested first task to start with

## Rules

- Every task must have a clear **validates** check — no ambiguous "done" states
- Prefer many small tasks over few large ones — err on the side of splitting
- Tasks must reference real files from the codebase, not hypothetical ones
- If the PRD has stories, align tasks to stories but split stories further if needed
- Never create tasks for work already completed (check git status/recent commits if relevant)
- Keep the full tasks.md under 300 lines — if more, the PRD itself may need splitting
