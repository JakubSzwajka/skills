---
name: todo
description: Manage tasks and projects as markdown in the Obsidian vault. Enforces project/task/subtask folder hierarchy.
user-invocable: true
argument-hint: [command] [args...]
---

# Todo Skill

Manage tasks and projects stored as markdown in `~/knowledge/tasks/`. Uses a Python CLI that wraps the Obsidian CLI and enforces folder structure.

## CLI

```bash
python3 ~/.claude/skills/todo/todo.py <command> [args...]
```

## Folder structure (enforced by CLI)

```
~/knowledge/tasks/
  <project>.md                        # project metadata
  <project>/
    <task>.md                         # task file
    <task>/
      <subtask>.md                    # subtask file
  _inbox/
    <task>.md                         # tasks without a project
```

## Commands

### Tasks

```bash
# Add
todo add "title" --project <id> [--parent <id>] [--description "..."] [--tags a,b] [--note "..."] [--author kuba]

# List
todo list [--project <id>] [--status <s>] [--tag <t>] [--all] [--tree]

# Show detail
todo show <id>

# Change status
todo status <id> <open|in_progress|done|cancelled>

# Add log entry
todo log <id> "note text" [--author kuba]

# Update fields
todo update <id> [--title "..."] [--description "..."] [--status <s>] [--tags a,b]

# Delete
todo delete <id>
```

### Projects

```bash
todo project list
todo project add "name" [--id <slug>] [--description "..."]
todo project show <id>
todo project delete <id>
```

## How to handle /todo

If `$ARGUMENTS` is empty, run `todo list`.

Otherwise, pass arguments directly to the CLI:
```bash
python3 ~/.claude/skills/todo/todo.py $ARGUMENTS
```

## Conventions

- Author is `kuba` when acting on user's behalf, `pi` when acting autonomously
- Descriptions support `[[wiki-links]]` to knowledge base pages in the vault
- Subtasks auto-inherit project from parent — don't pass `--project` on subtasks
- `--tree` flag shows parent/child hierarchy
- The CLI enforces: correct folder placement, required frontmatter, relationship wiki-links
