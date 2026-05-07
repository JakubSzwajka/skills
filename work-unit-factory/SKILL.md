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

Manufacture detailed work units in order of the plan to be executed by the team.
Your task is to orchestrate it's creation and communication between the team members. All members are specified in `../agents/**` directory. 
Choose involved parties smartly basd on the task, context and overall goal.

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
- Use subagents with dedicated skills to communicate with the agents in delegation manner.
- Be explicit what passing down a task to the agent, with saying what you need, and what handoff format you expect in return.

## Workflow

0. **Ensure that all involved agents, have their knowledge pre-requisites met satisfied in the current working context.**
   - Agents does not work blindly, each of them needs to know how should they do the job. 
   - Ask each one for confirmation that they are ready to work on the given task. I.e. if architect has all the documentation he needs to work on the task etc. If he will report missing information, treat filling the gaps as a ticket for the user to address.

1. **Locate or create target**
   - If `$ARGUMENTS` names an existing `docs/tasks/active/<YYYY-MM-DD-prd-slug>/`, use it.
   - If there is one obvious active task folder, ask before mutating unless the user named it.
   - If no task folder exists and the user gave a brief, create `docs/tasks/active/<YYYY-MM-DD-prd-slug>/` with minimal `prd.md`, `open-questions.md`, `tasks/index.md`, and `log.md`.

2. **Read current state**
   - Read `prd.md`, `open-questions.md`, `tasks/index.md`, `log.md` if present.
   - Read repo `AGENTS.md`, README, and linked architecture docs when present.
   - Read `../references/work-unit-contract.md`.

3. **Iterate over the plan with the team members**
   The parent is the only orchestrator; child agents do not spawn subagents. Iterate with the team, including the user, to gather information, build shared understanding, and append open questions if needed so that user can address them and proceed. 

   Run fresh-context subagents to iterate over the plan. Each subagent should:
   - read the current state of the plan
   - ask the user for clarification on the open questions
   - append the open questions to the `open-questions.md` file
   - return the updated `open-questions.md` file

   Each subagent must follow `../references/role-steward-contract.md` and return `STATUS: READY | NEEDS_INPUT | NEEDS_UPDATE | BLOCKED | NO_GO`.

4. **Decision and knowledge gate before task design**
   Synthesize blocker questions and repo-knowledge updates from the team members before generating work units. If any of the team members will return a prompt to start conversation with the user to gather more details, surface it to the user and wait for confirmation, that it's done. 

   After the user answers or returns from a fresh steward session, update or create the relevant repo knowledge docs before finalizing work units, unless the user explicitly says not to. Keep those docs concise and operational.

5. **Write artifacts**
   - Parent writes/updates `tasks/index.md` and `tasks/<task-id>.md` only after synthesizing child outputs.
   - Parent then verifies the task content with the team members and mark it ready only when all the team members are happy with the task content.
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
