# Skills

Personal skill set for Claude Code. Each subdirectory is one skill (or a group of related skills) with a `SKILL.md` entry point.

## Layout

- `engineering/` — engineering-specific skills (agent personas, workflows, docs/PRD, commit).
- `dont-start-blind/` — orientation pass before execution-heavy work.
- `explain/` — generate a styled HTML page that visually explains a concept.
- `grill-me/` — interview the user one question at a time until a plan is solid.
- `knowledge-base/` — query and compile the Obsidian-backed knowledge graph.
- `references/` — shared contracts reused by multiple skills (handoff packet, spawned-agent contract, role-steward contract).

## Typical engineering flow

1. **`dont-start-blind`** — orient: load active task folder, branch, doctrine, and (when needed) explore the codebase via subagent.
2. **`prd-create`** (under `engineering/docs/`) — capture the change as `docs/tasks/active/<id>/{prd.md, tasks.md, log.md}`.
3. **`pipeline`** (under `engineering/workflows/`) — execute one runnable subtask, review it, update task artifacts, stop.
4. **`commit`** (under `engineering/`) — stage and commit when work is ready.

Personas in `engineering/agents/` (architect, designer, developer, product-owner, qa) are invoked explicitly by the user or delegated to by workflows when role-specific judgment is needed. They are not auto-triggered.

## Conventions

- Repo-local durable doctrine lives under `docs/knowledge/<domain>/` (see `references/role-steward-contract.md`).
- Repo-local execution state lives under `docs/tasks/active/<task-id>/`.
- Spawned subagents follow `references/spawned-agent-contract.md` and report with `references/handoff-packet.md`.
