---
name: review
description: >
  Pre-push code review that analyzes git changes for correctness, test coverage, types,
  naming, architecture patterns, backwards compatibility, and production readiness.
  Triggers on: "review", "review changes", "code review", "review my changes",
  "is this ready to push", "check my code". Works with any language or stack.
context: fork
---

# Code Review

Review current git changes against their intended goal and produce a compact inline verdict.

**READ-ONLY**: This skill must NEVER modify any files, stage changes, create commits, or alter the working tree in any way. Only use read-only commands (git diff, git log, git status, git branch). Do not use Edit, Write, or NotebookEdit tools. Do not run any command that writes to disk.

## Step 1: Gather Changes

Run `git diff --stat` and `git diff --staged --stat` to see what changed.

- If there are staged or unstaged changes, use those as the review scope.
- If there are no changes, ask the user: "No staged/unstaged changes found. Should I review the last commit, or a different range?"
- For last commit, use `git diff HEAD~1..HEAD`.
- Show the user a brief summary of files changed before proceeding.

## Step 2: Find the Intent

The review needs context — what was this change supposed to accomplish?
Before reviewing, form a one-line statement of the intended invariant / operating assumption behind the change (e.g. "historical IDs survive deletion, but live workflows may still require real users"). Re-check this assumption before the final verdict.

1. Get the current branch name with `git branch --show-current`.
2. Search for PRD files that match the branch name or changed file paths. Look in common locations:
   - `docs/prds/`, `prds/`, `.prds/`, `docs/` — glob for `**/*.md` files and check content.
   - Also check if any PRD filename resembles the branch name or a ticket ID in the branch name.
3. If a PRD is found, read it and use it as the intent reference.
4. If no PRD is found, ask the user: "I couldn't find a PRD for this change. What was the goal of these changes?" Use their answer as the intent.

## Step 3: Deep Review

Read the full diff with `git diff` and `git diff --staged` (or the appropriate range from Step 1). Then for each changed file, read the surrounding code to understand context — don't review the diff in isolation.

Use the checklist in [references/review-checklist.md](references/review-checklist.md) to guide the review. Skip sections that don't apply to the changes.

Spawn parallel agents for large changesets:
- If more than 5 files changed, use the Task tool with `subagent_type: "Explore"` to investigate patterns and architecture in parallel.
- Always read test files related to changed code to verify coverage.

Key things to trace:
- Every function/method added or modified — is it tested?
- Every export changed — does it break consumers?
- Every type changed — is it sound, or does it paper over issues?
- Every pattern used — does it match the rest of the codebase?

### Extra pass for migrations and unifications

When the changeset replaces or removes a mechanism (old API replaced, mixin removed, pattern unified), run these additional checks:

**Dropped test assertions** — For each test file touched, check whether any assertions were silently removed during mechanical replacement (e.g. `entity.publish.assert_called_once()` deleted but not replaced with an equivalent). A passing test suite does not mean assertions weren't lost.

**Collateral damage from bulk find-replace** — Check that automated replacements only targeted the intended pattern. Look for cases where the replaced string fragment appeared as part of a different symbol in a different context (e.g. replacing `entity_id=` hitting `lock_entity_id=`).

**Usage sanity check** — For suspicious touched code, schemas, helpers, adapters, and fallback branches, run a quick usage search before speculating. Distinguish between "dead/unused", "stale but reachable", and "actively used".

**Dead code created by the removal** — After removing a mechanism, scan for symbols that only existed to support it: helper functions, TypeAliases, dataclasses, TypeVars, utility methods. These become dead code the moment the mechanism is gone and should be flagged.

**Hidden fixture/test fallout** — For FK/relationship removals, core fixture changes, or model contract rewires, inspect adjacent fixtures/tests beyond the immediate diff. Look for helper factories and broader suites that will fail even if targeted tests pass.

**New API complexity** — When a new API is introduced, ask: is every parameter actually needed? Could the caller derive any of these from data it already has? Flag unnecessary parameters as WARN.

## Step 4: Report

Print the review inline using this format:

```
## Review: <branch-name>

**Intent**: <one-line summary of what this change does, from PRD or user>
**Scope**: <N files changed, +X/-Y lines>

### Verdict: READY / NEEDS WORK / BLOCKER

### Findings

#### <Category> (if findings exist)
- <severity> <finding> — <file:line>

When a finding depends on an assumption, say so explicitly in the finding text using a form like: `Only a problem if <assumption>.`

Use these severity markers:
- BLOCKER — must fix before push
- WARN — should fix, but not a dealbreaker
- NOTE — suggestion for improvement
- OK — explicitly good pattern worth noting

### Checklist Summary
- Tests: <covered / partially covered / missing>
- Types: <sound / has gaps / not applicable>
- Naming: <consistent / inconsistent>
- Patterns: <follows conventions / deviates>
- Backwards compat: <safe / breaking changes noted>
- Security: <clean / concerns noted>
- Production ready: <yes / with caveats / no>

### Bottom Line
<1-2 sentence summary: is this ready to push?>

### Final Self-Check
- Intent understood: yes / no
- Key assumption(s): <short list>
```

Only include categories that have findings. Keep the report compact — this is a decision tool, not a lecture.

### Verdict rules

- **READY** — no BLOCKERs and no open WARNs. If WARNs exist, the verdict must be NEEDS WORK unless the user has explicitly acknowledged them.
- **NEEDS WORK** — one or more WARNs or minor correctness issues that should be fixed before push.
- **BLOCKER** — a correctness bug, data loss risk, or security issue that must be fixed.

Do not declare READY when WARNs are listed. Resolve or explicitly accept them first.
Do not give a confident verdict until you have re-checked that your concerns match the intended invariant/assumptions of the change.

## After Review

Based on the verdict, suggest one of:
- **READY** → "Want me to commit these changes?"
- **NEEDS WORK** with test concerns → "Want me to run tests on the flagged areas first?"
- **NEEDS WORK** otherwise → "Want me to fix these issues?"
- **BLOCKER** → "These need fixing before push. Want me to start with the blockers?"
