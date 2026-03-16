---
name: _prd-create
description: >
  Create and manage lightweight PRDs, then decompose them into ordered, dependency-aware, commit-sized tasks.
  Use when the user wants to write a PRD, capture a feature idea, break a PRD into stories or tasks,
  update PRD status, or says things like "create a prd", "break down this PRD", "split PRD into tasks",
  "decompose PRD", "create tasks from PRD", "prd to tasks".
---

# PRD Skill

## Philosophy

PRDs are **quick-capture documents for change ideas**. You're mid-flow, you spot something that needs doing, you sketch it — problem, solution shape, key cases — and move on. Later you come back, break it into user stories, decompose into tasks, and implement.

A PRD is NOT an ADR. ADRs record *decisions* (why X over Y). PRDs describe *changes to build* (what and why). A PRD might reference ADRs when the change requires architectural decisions.

Key constraints:
- The master `README.md` must stay under **250 lines** (hard cap: 300)
- Each PRD is a **directory** — stories and tasks get added as sibling files
- Status tracks the lifecycle: `draft → proposed → accepted → in-progress → done`
- Keep it sketchable in 5 minutes — this is idea capture, not a spec

## Creating a PRD

### Phase 1: Quick Interview (2-4 questions)

Don't over-interview. Ask just enough to fill the template:

1. **What's the problem?** — What's broken, missing, or suboptimal?
2. **What's the rough solution?** — High-level shape, not implementation details.
3. **What are the key cases?** — Main scenarios to handle. 3-6 bullets.
4. **What's out of scope?** — Prevent future scope creep.

If the user already described all this, skip straight to drafting.

### Phase 2: Draft

1. **Choose a slug.** Derive from the problem description. Use kebab-case (`email-notifications`, `booking-refunds`).

2. **Create the PRD directory and README.md.** Preferred: run the init script from the target repo root:

```bash
bash ~/.agents/skills/_prd-create/scripts/init_prd.sh <slug>
```

This creates `docs/prds/<slug>/README.md` and `notebook.md` from templates. Use `--dir` to override the PRD directory location.

If you can't run the script, create the directory manually and copy from `assets/templates/prd-readme.md`.

3. **Fill in the template.** Use the confirmed answers from Phase 1. Every section should have real content or be removed. Keep the README under 250 lines.

4. **Validate the PRD.** Run the validation script and fix any errors before presenting to the user:

```bash
bash ~/.agents/skills/_prd-create/scripts/validate_prd.sh docs/prds/<slug>/README.md
```

Fix any `ERROR:` issues. `WARN:` items are acceptable but review them.

5. **Set status to `draft`.** The author can promote it later.

## Breaking into User Stories

When the user returns to a PRD to deep-dive, help them break it into story files in the same directory:

```
docs/prds/email-notifications/
  README.md              ← master PRD
  01-send-on-confirm.md  ← user story
  02-retry-failures.md   ← user story
  03-unsubscribe.md      ← user story
```

Each story file should contain:
- **Title** — short imperative description
- **User story** — "As a [role], I want [X], so that [Y]"
- **Acceptance criteria** — checkboxes an agent can verify
- **Notes** — implementation hints, edge cases, related ADRs

Keep each story file under 80 lines. Update the master README's status to `accepted` once stories are defined.

## Decomposing into Tasks

Break a PRD into small, reviewable, dependency-aware tasks grounded in the actual codebase.

### 1. Locate the PRD

If the user names a PRD slug, look in `docs/prds/<slug>/`. Otherwise, list available PRDs and ask which one.

Read the PRD's `README.md` and any story files (`01-*.md`, `02-*.md`, etc.) in the directory.

### 2. Analyze the Codebase

Based on the PRD content:
- Search for files, modules, and patterns mentioned or implied by the PRD
- Understand the existing architecture relevant to the change
- Identify integration points, shared types, and test files
- Note conventions (naming, file structure, patterns) to keep tasks consistent

Spend real effort here — the value is **concrete, file-aware tasks**, not generic ones.

### 3. Generate or Update tasks.md

Read [references/task-format.md](references/task-format.md) for the exact output format and sizing guidelines.

**Creating new tasks.md:**
1. Decompose the PRD into the smallest reviewable units of work
2. Order tasks so dependencies come first
3. Mark dependency relationships explicitly
4. Reference concrete files from codebase analysis
5. Write each task description in 2-5 sentences — enough to act on immediately
6. Write the file to `<prd-directory>/tasks.md`

**Updating existing tasks.md:**
1. Read the current tasks.md
2. Preserve all `done` statuses — never uncheck completed work
3. Add, remove, or update tasks based on PRD changes or user instructions
4. Fix numbering and dependency references
5. Update the `last-updated` date

### 4. Present Summary

After writing tasks.md, show:
- Total task count and how many are parallelizable
- Any tasks that seem risky or uncertain (flag for user review)
- Suggested first task to start with

### Task Rules

- Every task must have a clear **validates** check — no ambiguous "done" states
- Prefer many small tasks over few large ones — err on the side of splitting
- Tasks must reference real files from the codebase, not hypothetical ones
- If the PRD has stories, align tasks to stories but split stories further if needed
- Never create tasks for work already completed (check git status/recent commits if relevant)
- Keep the full tasks.md under 300 lines — if more, the PRD itself may need splitting

## Updating Status

Update the `status` field in the README.md frontmatter:

| Status | Meaning |
|---|---|
| `draft` | Idea captured, not yet reviewed |
| `proposed` | Ready for review/discussion |
| `accepted` | Approved, ready to break into stories or implement |
| `in-progress` | Implementation underway |
| `done` | All stories implemented and verified |

## Consulting PRDs

Before implementing features, check `docs/prds/` for existing PRDs:

1. Scan directory names for relevance
2. Read the README.md of matching PRDs
3. Check status — only `accepted` or `in-progress` PRDs are active
4. Follow the stories if they exist; ask the user if they don't

## Agent Notebook

Each PRD directory contains a `notebook.md` — a shared scratchpad for cross-session context.

**Before starting any task** from a PRD, read `notebook.md` in that PRD directory.

**After discovering something worth sharing** — a constraint, non-obvious decision, gotcha, or useful pattern — append a short note. Use the suggested format in the template:

```
### [Task N] Short title
- **Found:** what you discovered
- **Decision:** what you chose and why
- **Watch out:** gotchas for future agents
```

Keep notes concise. Never delete existing notes.

## Resources

### scripts/
- `scripts/init_prd.sh` — create a new PRD directory with README.md from the template. Run from target repo root.
- `scripts/validate_prd.sh` — validate a PRD README.md for required frontmatter, sections, and formatting. Exit 1 on errors.

### assets/
- `assets/templates/prd-readme.md` — master PRD template with frontmatter, sections, and placeholders.
- `assets/templates/notebook.md` — agent notebook template, copied into each PRD directory.

### references/
- `references/task-format.md` — exact output format spec for tasks.md, including sizing guidelines and dependency notation.
