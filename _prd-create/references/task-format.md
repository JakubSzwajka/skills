# Task Format Reference

## tasks.md Structure

```markdown
---
prd: <prd-slug>
generated: YYYY-MM-DD
last-updated: YYYY-MM-DD
---

# Tasks: <PRD Title>

> Summary: <1-2 sentence overview of what this task list covers>

## Task List

- [x] **1. <title>** — <one-line description>
- [ ] **2. <title>** — <one-line description>
- [ ] **3. <title>** — <one-line description> `[blocked by: 1, 2]`

---

### 1. <title>
<!-- status: done -->

<2-5 sentence description of what to do and why.>

**Files:** `src/foo.ts`, `src/bar.ts`
**Depends on:** —
**Validates:** <how to know it's done — e.g. "tests pass", "form renders">

---

### 2. <title>
<!-- status: pending -->

<2-5 sentence description.>

**Files:** `src/baz.ts`, `lib/util.ts`
**Depends on:** 1
**Validates:** <acceptance check>

---
```

## Field Definitions

- **Title**: imperative verb phrase — "Add validation to login form", "Extract shared types"
- **Description**: what to change and why, referencing specific code when possible. Keep it commit-message sized — someone should read this and immediately know what to do.
- **Files**: concrete file paths discovered from codebase analysis. Use best-effort — list files that will likely need changes.
- **Depends on**: task numbers that must complete first. Omit or use `—` if independent.
- **Validates**: a quick acceptance check. Not a test plan — just "how do I know this is done?"
- **Status comment**: `<!-- status: done | pending | in-progress -->` inside the detail section.

## Sizing Guidelines

A well-sized task:
- Is **reviewable in one pass** — a reviewer can understand the full change without scrolling back and forth
- Touches a **coherent slice** — related changes, not scattered edits
- Can be **described in 2-5 sentences** — if you need more, split it
- Has a **clear done state** — you know when to stop

Signs a task is too big:
- Description needs bullet sub-lists of changes
- Touches 5+ unrelated files
- Mixes refactoring with new behavior
- "And also..." appears in the description

Signs a task is too small:
- It's just renaming one variable
- It has no standalone value
- It would be confusing as an isolated commit

## Dependency Notation

In the summary checklist, blocked tasks show their blockers inline:
```
- [ ] **3. Wire up endpoint** — connect new route `[blocked by: 1, 2]`
```

In the detail section, use the **Depends on** field with task numbers.

Tasks with no dependencies can be worked on in parallel.

## Update Behavior

When re-running on an existing tasks.md:
1. Preserve `done` status — never uncheck completed tasks
2. Add new tasks discovered from PRD or codebase changes
3. Remove tasks that no longer apply (the PRD scope changed)
4. Update descriptions/files if the codebase changed
5. Re-number and fix dependency references after changes
6. Update the `last-updated` frontmatter date
