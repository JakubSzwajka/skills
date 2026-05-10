# Engineering Agent Skills

This directory is the top-level entry point for **engineering agent invocation**.

Top-level folders here are explicit-use agent/persona modes — skills that change the agent's operating identity or professional stance:

- `architect/`
- `designer/`
- `product-owner/`
- `developer/`
- `qa/`

Invoke these personas only when the user explicitly asks for that mode or a workflow deliberately delegates to that persona.

## Required reading: AGENTS.md

[`AGENTS.md`](AGENTS.md) is the universal operating doctrine for every persona in this directory: three-layer context model (role / repo knowledge / task), source-of-truth labels (`Proposed doctrine` / `Needs owner decision` / `Blocked`), default team workflow, communication style, and handoff format. Each persona's `SKILL.md` requires this file as preamble. Update `AGENTS.md` when the rules change; do not duplicate them into individual personas.

## Nested skills

A persona directory may contain supporting skills that belong to that role. For example:

- `designer/copy-curator/`
- `designer/shadcn/`
- `designer/web-design-guidelines/`
- `qa/review/`
- `qa/test/`

Those nested skills are role-scoped helpers. They are not standalone personas and should be treated as capabilities used by the owning agent/persona. They should set `user-invocable: false` and `disable-model-invocation: true` unless there is a deliberate reason to expose them globally.

Do **not** put unrelated global workflows, docs workflows, research workflows, generic utilities, or knowledge-base tools here. Those belong outside `engineering/agents/`.
