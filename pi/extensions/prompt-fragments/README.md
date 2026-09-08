# Prompt fragments

Use `/fragments` or `Command+Shift+R` in Pi's interactive TUI to place reusable Markdown around the current editor text. Pi renders the framed picker as a native widget above the editor, so the draft stays visible, and the picker never submits it.

## Paths and precedence

Fragments are direct (non-recursive) `*.md` files in:

- Global: `~/.pi/agent/prompt-fragments/`
- Project: `<cwd>/.pi/prompt-fragments/` when the project is trusted

A project fragment replaces a global fragment with the same filename. Invalid or unreadable files are skipped with a warning.

## Format

YAML frontmatter must include `placement: before` or `placement: after`. Optional keys are `title`, `description`, and numeric `order` (default `0`). The title defaults to the filename without `.md`.

```md
---
title: Review checklist
description: Ask for evidence and note risks
placement: before
order: 10
---
Review the following request. Cite evidence, then list residual risks.
```

Rows are ordered by `order`, then title, then filename. Press Space to select rows and Enter to apply them. Press `n` to create and open the global fragment directory in Cursor, or `Shift+n` for the trusted project's fragment directory. Selected `before` bodies, the current editor, and selected `after` bodies are joined with one blank line; frontmatter is not inserted. Escape cancels, and an empty selection leaves the editor unchanged.
