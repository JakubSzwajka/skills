# Skills

Personal skill set for Claude Code. Each subdirectory is one skill (or a group of related skills) with a `SKILL.md` entry point.

## Layout

- `engineering/` — engineering-specific skills (decision personas, quality helpers, docs/PRD, commit).
- `dont-start-blind/` — orientation pass before execution-heavy work.
- `explain/` — generate a styled HTML page that visually explains a concept.
- `grill-me/` — repo-aware grilling: interview one question at a time, challenge terminology/code/doc conflicts, and capture resolved decisions.
- `knowledge-base/` — query and compile the Obsidian-backed knowledge graph.
- `board/` — board-level personas: CEO for portfolio/career operating-center decisions, CSO for founder-led sales/ICP/GTM, and CTO for technical discipline/repo health.
- `references/` — shared contracts reused by multiple skills (handoff packet, spawned-agent contract, role-steward contract).

## Typical engineering flow

1. **`dont-start-blind`** — orient: load active task folder, branch, doctrine, and (when needed) explore the codebase via subagent.
2. **`prd-create`** (under `engineering/docs/`) — capture the change as `docs/tasks/active/<id>/{prd.md, tasks.md, log.md}` when scope needs a task artifact.
3. **Default Codex execution** — implement the assigned scope, run meaningful checks, and report evidence plus gaps.
4. **`review` / `test`** (under `engineering/quality/`) — optional bounded quality passes when risk or user request justifies them.
5. **`commit`** (under `engineering/`) — stage and commit when work is ready.

Personas in `engineering/agents/` (`product-owner`, `architect`, `designer`) are invoked explicitly by the user or delegated to by workflows when role-specific decision authority is needed. Implementation and validation stay in default Codex execution; use `engineering/quality/review` and `engineering/quality/test` when a bounded quality workflow is useful.

## Conventions

- Repo-local durable doctrine lives under `docs/knowledge/<domain>/` (see `references/role-steward-contract.md`).
- Product/domain language lives in `docs/knowledge/product/glossary.md` when the repo uses the recommended structure.
- Repo-local execution state lives under `docs/tasks/active/<task-id>/`.
- Spawned subagents follow `references/spawned-agent-contract.md` and report with `references/handoff-packet.md`.
