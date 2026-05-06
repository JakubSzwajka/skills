---
name: work-unit-factory
description: >
  Produce or repair a repo-local work-unit plan. Turns an idea, PRD, or existing
  docs/tasks/active/<task-id>/ folder into detailed, loopable work units that a
  fresh agent/human can execute without conversation history. Use when the user
  says work-unit factory, create work units, refine tasks, repair task plan, or
  make this plan executable.
user-invocable: true
argument-hint: [task-id-or-brief]
---

# Work Unit Factory

Manufacture detailed work units. Do not implement them.
This skill creates or repairs the plan that a separate processor can iterate.

Canonical output:

```txt
docs/tasks/active/<task-id>/
  prd.md
  tasks.md
  log.md
```

Shared references:

- `../references/work-unit-contract.md`
- `../references/role-steward-contract.md`
- `../references/spawned-agent-contract.md`
- `../references/handoff-packet.md`

## Workflow

1. **Locate or create target**
   - If `$ARGUMENTS` names an existing `docs/tasks/active/<task-id>/`, use it.
   - If there is one obvious active task folder, ask before mutating unless the user named it.
   - If no task folder exists and the user gave a brief, create `docs/tasks/active/<YYYY-MM-DD-slug>/` with minimal `prd.md`, `tasks.md`, and `log.md`.
   - If ambiguity would change scope, ask one clarifying question and stop.

2. **Read current state**
   - Read `prd.md`, `tasks.md`, `log.md` if present.
   - Read repo `AGENTS.md`, `CLAUDE.md`, README, and linked architecture docs when present.
   - Read `../references/work-unit-contract.md`.

3. **Launch flat role-steward task force**
   Use `pi-subagents` directly. The parent is the only orchestrator; child agents do not spawn subagents.

   Run fresh-context role stewards where useful:
   - `product-owner`
   - `architect`
   - `designer` when user-facing UI/UX/brand/copy is involved or unclear
   - `qa`

4. **Decision and knowledge gate before task design**
   Synthesize blocker questions and repo-knowledge updates from the role stewards before generating work units.

   Stop and ask the user when missing decisions would materially change the plan, including:
   - architecture style or stack when the repo/app has no established architecture
   - persistence/runtime/deployment choices that affect most units
   - product scope or primary workflow ambiguity
   - UI/design/brand direction for user-facing work
   - security/auth/multi-tenant assumptions
   - external service access or production safety boundaries

   Ask only the smallest set of blocking questions. Include your recommended default for each. Do not create a fake-confident task plan when foundational decisions are missing.

   After the user answers, update or create the relevant repo knowledge docs under `docs/knowledge/<domain>/` before finalizing work units, unless the user explicitly says not to. Keep those docs concise and operational.

5. **Design and red-team units**
   After blocking decisions are resolved or explicitly deferred, the parent synthesizes the role-steward guidance into detailed work units and then self-redteams them for executability.

6. **Write artifacts**
   - Parent writes/updates `tasks.md` only after synthesizing child outputs.
   - Preserve useful existing units and statuses where possible.
   - Do not mark implementation units `done`.
   - If red-team says `NO-GO`, either fix concrete plan issues or mark blockers clearly.
   - Append a concise factory entry to `log.md`.
   - Write `work-unit-review.md` when red-team feedback is substantial.

7. **Handoff**
   - Output the shared handoff packet.
   - Next should usually be: run `work-unit-processor` on the task folder.

## Work-unit quality bar

A work unit is not good enough if the next worker must infer:

- what files/modules are likely involved
- what behavior should change
- what counts as done
- how to validate it
- what decisions are already made
- whether a blocker is product, architecture, access, or implementation

If the factory cannot make a unit executable, set `Status: blocked`, add the missing decision to `Blockers`, and stop.

Important distinction:
- `Blockers` are decisions/access/context required before the unit is runnable.
- `Deferred decisions` are known production choices that do not block the current POC/local unit.

## Minimal routing

Keep v1 routing dumb:

- `Kind`
- optional `Agent`
- optional `Review`

Default suggestions for v0 planning:

```txt
architecture-sensitive unit -> Agent: architect
product/scope decision     -> Agent: product-owner or Owner: human
design/UX/copy unit        -> Agent: designer
quality/test strategy      -> Agent: qa
implementation unit        -> Agent: <blank for now, future processor decides>
review unit                -> Agent: qa or architect depending on scope
decision                   -> Owner: human
```

Do not add capability graphs, weights, pools, manager trees, or fake worker roles before the four-role team proves useful.

## Output shape

Use `../references/handoff-packet.md`.
