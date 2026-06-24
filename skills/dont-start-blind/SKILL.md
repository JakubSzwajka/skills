---
name: dont-start-blind
description: >
  Bootstrap working context before execution-heavy work. Combines project orientation
  (repo-local tasks, git, architecture) with codebase exploration (files, patterns, data flow).
  Use when the user is resuming a thread, switching into a repo/project, starting
  implementation, asking to continue work, wanting to understand a module or system,
  or using phrases like "work on X", "resume", "continue", "we need to build",
  "do this", "implement this", "research", "how does X work", "map out X",
  "explore the codebase", "understand the X module", or explicit `task:` framing.
---

# Dont Start Blind

Orient before acting. The output is a working brief that answers: what work is in flight, what state it is in, which constraints apply, whether code exploration is needed, and what blocks safe execution.

## When to trigger

Do a full bootstrap when the user is clearly entering work mode:
- resuming or continuing a prior thread
- switching into a repo, branch, project, ticket, or PRD
- asking to implement, build, fix, review, or research in a concrete codebase
- wanting to understand a module, system, or cross-cutting concern
- giving an explicit `task:` or other execution-scoped instruction

For phrasing and examples, read [references/trigger-patterns.md](references/trigger-patterns.md).

---

## Phase 1: Project Orientation (you do this, inline)

Keep this pass cheap. Gather only enough state to choose the correct next action.

### 1. Infer the thread

From the user message, current repo/cwd, git branch, recent file activity, and any explicit task, ticket, or project names.

### 2. Check context sources in priority order

- **Trajectory first** — repo-local task artifacts in `docs/tasks/active/`, then current branch, git state, recent commits. This is the primary signal for resumed work.
- **Archived trajectory second** — `docs/tasks/archive/` only when active work references older related tasks or when historical context matters.
- **Knowledge when anchored** — search the knowledge graph only when the thread ties to a known project or durable domain concept. Don't search speculatively.
- **Architecture state** — check AGENTS.md, CLAUDE.md, project instructions, README. If any mention or link to an architecture document, follow it. Note whether structural rules exist or not.
- **Experience is ambient** — behavioral context is generally already loaded by the system, not fetched by this skill. Don't scan memory or journal files.
- **Reflective artifacts stay out** — journal, narrative, and other reflective outputs are never retrieved here.

### 3. What to gather

Gather facts that answer one of these questions:
- Which repo, branch, task folder, ticket, or PRD owns this work?
- What did the last accepted plan or log say to do next?
- Which durable product, architecture, design, or quality constraints apply?
- Is codebase exploration required before acting?
- What conflict or missing input would make execution unsafe?

Relevant facts usually include:
- likely thread / repo / task folder
- active work in `docs/tasks/active/`
- recent decisions, pauses, blockers, or accepted tradeoffs from `log.md`
- PRD scope and subtask structure from `prd.md` / `tasks.md`
- durable constraints or patterns relevant to the thread
- architecture state (defined / partial / none 🏗️)
- obvious risks, contradictions, or stale assumptions
- what is still missing before safe execution

Omit facts that do not affect task selection, constraints, exploration, blockers, or the next action.

### 4. How to inspect repo-local task context

When inside a repo, check for:

```txt
docs/tasks/active/
docs/tasks/archive/
```

For each likely active task folder, read:
- `prd.md` — what/why/scope
- `tasks.md` — current plan, statuses, dependencies
- `log.md` — progress notes and gotchas

Preferred order:
1. explicit task ID named by the user
2. task folder matching branch name or recent file edits
3. single obvious active task folder
4. ask if several plausible task folders compete

### 5. Decide: does this thread need codebase exploration?

**Yes — run Phase 2** when:
- the task involves modifying or understanding unfamiliar code
- the user explicitly asks to research/explore/map a module or system
- the PRD or task plan references files, modules, or patterns you haven't seen yet
- you need to understand data flow, conventions, or integration points before acting

**No — skip to brief** when:
- pure resume on the same files you already know
- planning/discussion thread with no codebase target yet
- the user just wants task status or orientation, not exploration
- the codebase context is already loaded from a prior pass

---

## Phase 2: Codebase Exploration (spawned subagent)

When there's code to understand, launch a read-only subagent as explorer. The explorer starts fresh — no conversation history, only the scoped questions you give it.

### 2a. Formulate exploration questions

Based on Phase 1 findings (the task folder, PRD, task plan, user request), identify **2-5 concrete questions** the explorer should answer. Examples:
- "What are the entry points for the notification system?"
- "How does data flow from the API route to the database in the bookings module?"
- "What patterns and conventions does this module use for validation?"
- "What files would need to change to add a new payment provider?"

### 2b. Launch the explorer

Read `../references/spawned-agent-contract.md`, then launch a subagent (read-only — bash for grep/find/git only). Omit `model` by default; only specify one if the user asked for it or the runtime supports it.

```txt
systemPrompt: |
  You are a codebase explorer. Follow the spawned-agent contract. You are READ-ONLY — never modify files.
  Your job: answer specific questions about a codebase by reading files,
  tracing data flow, and identifying patterns.

  Use `read` to examine source files. Use `bash` for grep, find, and
  git commands only — never run anything that writes to disk.

  Cite file paths and line numbers for every finding that affects the next
  implementation step. Omit repo inventory that does not change the answer.
task: |
  ## Codebase Exploration

  **Repo**: <repo path>
  **Context**: <1-2 sentences about what work is planned, from Phase 1>
  **Task Folder**: <docs/tasks/active/<task-id> if known>

  ### Questions
  1. <question>
  2. <question>
  ...

  ### Instructions
  Work breadth-first:
  1. Find entry points — main classes, functions, or routes for the topic
  2. Trace data flow — follow the call chain from entry through layers
  3. Identify patterns — conventions, base classes, mixins, shared utilities
  4. Check for gotchas — error handling, edge cases, TODOs, known issues

  For broad discovery searches across multiple directories, use
  files-with-matches first to identify relevant files, then read
  targeted files. Don't dump unbounded grep content searches —
  they waste context on noise.

  ### Output Format
  Respond with EXACTLY this structure:

  ### Key Files
  - `path/to/file.py` — role/purpose (one line each)

  ### Architecture / Data Flow
  <Brief description of how the system works, call chain or data flow>

  ### Patterns & Conventions
  - <Pattern>: description

  ### Gotchas & Edge Cases
  - <Issue>: explanation

  ### Answers
  <Direct answers to each numbered question, with file:line references>
```

### 2c. Integrate findings

Read the explorer's output and fold the key insights into the working brief. Do not dump the raw explorer output into the brief — distill it.

---

## Working Brief

After Phase 1 (and Phase 2 if it ran), produce a short operational brief:

- **Thread:** what this most likely is
- **In flight:** active task folder / branch / momentum
- **Architecture:** defined (source) / partially defined / not defined 🏗️
- **Task context:** PRD scope, subtask graph, and notebook state from `docs/tasks/active/` (or `archive/` if historical)
- **Codebase context:** key files, patterns, data flow relevant to the task (from Phase 2, or `skipped — not needed` / `already loaded`)
- **Relevant baggage:** prior decisions, constraints, or continuity worth loading
- **Watch out:** risks, conflicts, stale assumptions, or hidden tradeoffs
- **Missing:** what you still need clarified, if anything
- **Next:** ask or proceed

If the context is thin, say that plainly.
If two possible threads are competing, surface the conflict explicitly.

---

## When to stop and ask

Stop and ask before acting when:
- two plausible active task folders conflict
- repo/task inference is weak
- retrieved context disagrees in a meaningful way
- `tasks.md` and user framing do not line up
- a missing branch, ticket, or target changes the likely plan

Ask the smallest clarifying question that unlocks safe work.

## When to proceed

If the working brief is coherent and no major conflict remains, proceed into the task.
Do not linger in ceremony. The brief exists to improve action, not replace it.

## After Orientation

Based on what was found, the natural next steps are:
- context is clear, task is defined → proceed to implementation
- findings reveal unexpected complexity → `This is more complex than expected. Want a deeper adversarial research pass?` (triggers research-deep)
- user was exploring before implementation → `Want me to create a PRD task folder based on these findings?`
- user was debugging → `Want me to turn this into a focused engineering investigation/PRD task?`

## Exit Criteria

Stop orientation when the brief identifies:
- the likely work item or says inference is weak
- relevant task/knowledge/docs read, or `none found`
- whether Phase 2 ran, was skipped, or is blocked
- concrete blockers or `none`
- the next action: ask, explore, plan, implement, review, or stop
