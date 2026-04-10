---
name: todo
description: Manage repo-local task folders under docs/tasks/. Prefer file conventions over a CLI.
user-invocable: true
argument-hint: [task-id-or-question]
---

# Todo Skill

Manage repo-local task artifacts stored in the current repository.

Canonical layout:

```txt
docs/tasks/
  active/
    <YYYY-MM-DD-task-name>/
      prd.md
      tasks.md
      log.md
  archive/
    <YYYY-MM-DD-task-name>/
      prd.md
      tasks.md
      log.md
```

## Philosophy

This skill is mostly about **knowing where the work lives and using it consistently**.

You do **not** need a dedicated CLI first.
A good agent should be able to:
- find active task folders quickly
- read `prd.md`, `tasks.md`, and `log.md`
- update those files directly when work progresses
- move finished or cancelled task folders from `active/` to `archive/`

Knowledge links may appear in these files, but the task folders themselves are the source of truth for active work.

## File meanings

### `prd.md`
The spec.
Use it for:
- problem
- goal
- scope
- key cases
- out of scope
- implementation notes
- related KB links when useful

### `tasks.md`
The execution plan.
Use it for:
- overall task title / status
- subtask checklist
- subtask statuses
- dependencies between subtasks
- file/module targets when known

### `log.md`
The notebook.
Use it for:
- progress notes
- decisions
- gotchas
- challenge findings
- handoff context across sessions

## Default behavior

When the user asks about tasks, PRDs, planning, or active work in a repo:
1. Look in `docs/tasks/active/` first
2. Read the relevant `prd.md`, `tasks.md`, and `log.md`
3. Only check `docs/tasks/archive/` for historical context or related finished work
4. Do not treat the KB as the owner of task state

## Common operations

### Show active tasks
List task folders under:

```txt
docs/tasks/active/
```

If there is only one obvious active task, use it.
If there are several, ask which one matters.

### Read a task
Open:

```txt
docs/tasks/active/<task-id>/prd.md
docs/tasks/active/<task-id>/tasks.md
docs/tasks/active/<task-id>/log.md
```

Use `archive/` instead of `active/` only when the task is historical.

### Create a task
Create:

```txt
docs/tasks/active/<task-id>/
  prd.md
  tasks.md
  log.md
```

Where `<task-id>` is:

```txt
YYYY-MM-DD-task-name
```

### Update a task
Edit `tasks.md` when:
- a subtask status changes
- dependencies change
- new subtasks are discovered
- overall task status changes

Append to `log.md` when:
- something was learned
- a wave completed
- a blocker appeared
- a handoff note matters later

### Archive a task
Move a task folder from:

```txt
docs/tasks/active/<task-id>/
```

to:

```txt
docs/tasks/archive/<task-id>/
```

when the task is genuinely:
- `done`, or
- `cancelled`

Do not archive work that is merely paused, blocked, or in review.

## Conventions

- Prefer short, readable task IDs
- Keep the PRD in `prd.md`, not embedded in task metadata
- Keep execution state in `tasks.md`
- Keep discoveries and continuity in `log.md`
- Link to KB when useful, but do not offload task state there
- Prefer direct file edits over inventing a system before it's needed

## What this skill is not

- not a central task database
- not Obsidian-backed canonical storage
- not the owner of durable knowledge
- not dependent on a CLI to be useful

It is just the repo-local work surface. Which, frankly, is enough.