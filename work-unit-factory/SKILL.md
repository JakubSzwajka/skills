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

Manufacture detailed work units in plan order so the team can execute them.
Your task is to orchestrate their creation and communication between team members. All members are specified in `../agents/**` directory.
Choose involved parties smartly based on the task, context, and overall goal.

Canonical output:
```txt
docs/tasks/active/<YYYY-MM-DD-prd-slug>/
  prd.md
  open-questions.md
  log.md
  tasks/
      <task-id>.md
      index.md -> list of all tasks in the plan
```

Shared references:

- `../references/work-unit-contract.md`
- `../references/role-steward-contract.md`
- `../references/spawned-agent-contract.md`
- `../references/handoff-packet.md`

## Constraints
- Use spawn `persona` profiles when delegating to agents: `programmer`, `architect`, `designer`, `product-owner`, `qa`. These preload `~/.agents/skills/agents/<persona>/SKILL.md` as the child agent's baseline identity.
- Implementation work units should set `Agent: programmer` unless there is a deliberate exception. The programmer writes code from approved task context and is not authorized to make product/architecture/design/quality decisions; unresolved decisions become blockers to escalate.
- Be explicit when passing a task to an agent: state what you need, what scope they may mutate, and what handoff format you expect in return.
- The parent is the only final writer of work units. During planning, subagents may only append clearly marked discussion/log entries to assigned task artifacts, or return proposed changes for the parent to apply.

## Workflow

0. **Ensure involved agents have their knowledge prerequisites satisfied in the current working context.**
   - Agents do not work blindly; each one needs enough context to do the job.
   - Ask each relevant agent to confirm readiness for the given task. For example, confirm whether the architect has all documentation needed to plan safely.
   - If an agent reports missing information, turn the gap into a user-owned work unit with a copy-pasteable prompt for the relevant steward session.

1. **Locate or create target**
   - If `$ARGUMENTS` names an existing `docs/tasks/active/<YYYY-MM-DD-prd-slug>/`, use it.
   - If there is one obvious active task folder, ask before mutating unless the user named it.
   - If no task folder exists and the user gave a brief, create `docs/tasks/active/<YYYY-MM-DD-prd-slug>/` with minimal `prd.md`, `open-questions.md`, `tasks/index.md`, and `log.md`.

2. **Read current state**
   - Read `prd.md`, `open-questions.md`, `tasks/index.md`, `log.md` if present.
   - Read repo `AGENTS.md`, README, and linked architecture docs when present.
   - Read all shared references listed above before delegating or writing tasks.

3. **Iterate over the plan with the team members**
   The parent is the only orchestrator; child agents do not spawn subagents. Iterate with the team, including the user, to gather information, build shared understanding, and append open questions if needed so that user can address them and proceed. 

   Run fresh-context subagents to iterate over the plan. Prefer `spawn` with the relevant persona, for example `{ persona: "architect", tools: ["read", "bash"], task: "..." }`. Each subagent should:
   - read the current state of the plan
   - identify missing decisions, docs, or context
   - append only clearly marked discussion/log entries to assigned task artifacts when explicitly allowed
   - return blocking questions, proposed user-owned work units, and any proposed artifact updates for the parent to apply

   Subagents do not ask the user directly. If a gap needs user input, the parent creates a user-owned work unit such as: run this prompt with `architect`, agree on `<doc>`, update `<knowledge path>`, then return the result.

   Each subagent must follow `../references/role-steward-contract.md` and return `STATUS: READY | NEEDS_INPUT | NEEDS_UPDATE | BLOCKED | NO_GO`.

4. **Decision and knowledge gate before task design**
   Synthesize blocker questions and repo-knowledge updates from the team members before generating work units. If any of the team members will return a prompt to start conversation with the user to gather more details, surface it to the user and wait for confirmation, that it's done. 

   After the user answers or returns from a fresh steward session, update or create the relevant repo knowledge docs before finalizing work units, unless the user explicitly says not to. Keep those docs concise and operational.

5. **Write artifacts**
   - Parent writes/updates `tasks/index.md` and `tasks/<task-id>.md` only after synthesizing child outputs.
   - Parent then verifies task content with relevant team members and marks it ready only when material objections are resolved.
   - Preserve useful existing task and statuses where possible.
   - Do not mark tasks `done`.
   - Append a concise factory entry to `log.md`.

## Work-unit quality bar

A task is not good enough if the next worker must infer:

- what files/modules are likely involved
- what behavior should change
- what counts as done
- how to validate it
- what decisions are already made
- whether a blocker is product, architecture, design, quality, access, or implementation

If the factory cannot make a task executable, set `Status: blocked`, add the missing decision to `Blockers`, and stop.

Important distinction:
- `Blockers` are decisions/access/context required before the task is runnable.
- `Deferred decisions` are known production choices that do not block the current POC/local task.
