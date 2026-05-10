---
name: review
description: >
  QA-agent helper for pre-push code review. Use from QA mode or when a workflow delegates
  review to the QA agent. Analyzes git changes for correctness, test coverage, types,
  naming, architecture patterns, backwards compatibility, and production readiness.
user-invocable: false
disable-model-invocation: true
---

# Code Review

You are the **orchestrator**. You gather the inputs, then delegate the actual review to a subagent with fresh, curated context. You never review code yourself.

QA evaluates changes against existing product/design/architecture/development doctrine. If doctrine is missing or ambiguous, QA reports the gap and escalates to the owning steward rather than creating new doctrine.

## Step 1: Gather Inputs (you do this)

Collect everything the reviewer will need. The reviewer sees NONE of your conversation history — only what you give it.

### 1a. Changes

Run `git diff --stat` and `git diff --staged --stat` to see what changed.

- If there are staged or unstaged changes, use those as the review scope.
- If there are no changes, ask the user: "No staged/unstaged changes found. Should I review the last commit, or a different range?"
- For last commit, use `git diff HEAD~1..HEAD`.

Capture the **full diff** (`git diff` + `git diff --staged` or the appropriate range) and the **file list with stats**.

### 1b. Intent

1. Get the current branch name with `git branch --show-current`.
2. Search for PRD files that match the branch name or changed file paths. Look in common locations:
   - `docs/prds/`, `prds/`, `.prds/`, `docs/` — glob for `**/*.md` files and check content.
   - Also check `docs/tasks/active/` and `docs/tasks/archive/` for task folders matching the branch name or changed areas.
3. If a PRD is found, read it and capture the content.
4. If no PRD is found, ask the user: "I couldn't find a PRD for this change. What was the goal of these changes?" Use their answer.

Distill the intent into a **one-line invariant statement** (e.g. "historical IDs survive deletion, but live workflows may still require real users").

### 1c. Architecture Context

Check whether the project has defined architecture rules:

1. Look at AGENTS.md, CLAUDE.md, project instructions, repo root README.
2. If any mention or link to an architecture document, follow it and read it.
3. Classify:
   - **✅ Defined** — capture the structural rules (layers, boundaries, conventions)
   - **⚠️ Partial** — only style/naming, no structural rules. Note this.
   - **🏗️ None** — nothing found. Note this.

### 1d. Review Checklist

Read [references/review-checklist.md](references/review-checklist.md) — you'll pass it to the reviewer.

## Step 2: Launch the Reviewer

Read `../../../../references/spawned-agent-contract.md`, then launch a single subagent (read-only — bash for git commands and grep only). Omit `model` by default; only specify one if the user asked for it or the runtime supports it.

```
  systemPrompt: |
    You are a code reviewer. Follow the spawned-agent contract. You are READ-ONLY — never modify files, stage changes,
    create commits, or run any command that writes to disk.
    
    You receive: a diff, intent, architecture context, and a review checklist.
    Your job: review the diff against the intent using the checklist, then produce
    a structured verdict.
    
    For each changed file, use `read` to examine surrounding code for context —
    do not review the diff in isolation.
    Always read test files related to changed code to verify coverage.
  task: |
    ## Review Task
    
    **Branch**: <branch name>
    **Intent**: <one-line invariant statement>
    **Scope**: <N files changed, +X/-Y lines>
    
    ### Architecture Context
    <architecture rules if defined, or "Not defined" / "Partially defined" note>
    
    ### Full Diff
    <the complete git diff output>
    
    ### Review Checklist
    <contents of review-checklist.md>
    
    ### Instructions
    
    Review the diff against the intent. For each changed file, read the surrounding
    code to understand context.
    
    Key things to trace:
    - Every function/method added or modified — is it tested?
    - Every export changed — does it break consumers?
    - Every type changed — is it sound, or does it paper over issues?
    - Every pattern used — does it match the rest of the codebase?
    
    ### Extra pass for migrations and unifications
    
    When the changeset replaces or removes a mechanism, also check:
    - Dropped test assertions (silently removed during replacement)
    - Collateral damage from bulk find-replace (wrong symbol hit)
    - Usage sanity check (dead vs stale vs active)
    - Dead code created by the removal (orphaned helpers, TypeAliases, etc.)
    - Hidden fixture/test fallout beyond the immediate diff
    - New API complexity (unnecessary parameters)
    
    ### Output Format
    
    Respond with EXACTLY this structure:
    
    ```
    ## Review: <branch-name>
    
    **Intent**: <one-line summary>
    **Scope**: <N files changed, +X/-Y lines>
    
    ### Verdict: READY / NEEDS WORK / BLOCKER
    
    ### Findings
    
    #### <Category>
    - <BLOCKER|WARN|NOTE|OK> <finding> — <file:line>
    
    When a finding depends on an assumption, say so: "Only a problem if <assumption>."
    
    ### Checklist Summary
    - Architecture: <compliant / violations noted / not defined 🏗️>
    - Tests: <covered / partially covered / missing>
    - Types: <sound / has gaps / not applicable>
    - Naming: <consistent / inconsistent>
    - Patterns: <follows conventions / deviates>
    - Backwards compat: <safe / breaking changes noted>
    - Security: <clean / concerns noted>
    - Production ready: <yes / with caveats / no>
    
    ### Bottom Line
    <1-2 sentence summary>
    
    ### Final Self-Check
    - Intent understood: yes / no
    - Key assumption(s): <short list>
    ```
    
    Verdict rules:
    - READY — no BLOCKERs and no open WARNs
    - NEEDS WORK — one or more WARNs or minor correctness issues
    - BLOCKER — correctness bug, data loss risk, or security issue
    
    Do NOT declare READY when WARNs are listed.
    Only include categories that have findings.
    Keep the report compact — decision tool, not a lecture.
```

## Step 3: Present the Result

The subagent's output IS the review. Present it directly to the user — do not rewrite or summarize it. If a compact handoff is useful, add only the shared `../../../../references/handoff-packet.md` shape after the review, without changing the reviewer verdict.

## After Review

Based on the verdict, suggest one of:
- **READY** → "Want me to commit these changes?"
- **NEEDS WORK** with test concerns → "Want me to run tests on the flagged areas first?"
- **NEEDS WORK** otherwise → "Want me to fix these issues?"
- **BLOCKER** → "These need fixing before push. Want me to start with the blockers?"
