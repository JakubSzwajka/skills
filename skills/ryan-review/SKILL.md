---
name: ryan-review
description: Pre-review PubNub Illuminate pull requests and local branches with Ryan-style depth before Ryan reviews them. Use when the user asks for Ryan-review, wants to make Ryan not find anything, asks for a deep pre-PR review in pubnub/illuminate, or wants to refresh/analyze Ryan Manns review comments from the user's Illuminate PRs.
---

# Ryan Review

## Overview

Use this skill to review an Illuminate branch the way Ryan's AI reviews it: compare stated intent to actual behavior, follow changes across real runtime boundaries, and find issues that ordinary lint, type checks, or mocked unit tests miss.

Default to read-only review. If the user explicitly asks to fix findings, first report the findings and smallest safe fix plan, then implement in the repo's normal workflow.

## Core Sources

- Read `references/ryan-patterns.md` before reviewing. It distills Ryan's comments from Jakub's Illuminate PRs.
- To refresh the evidence, run `scripts/fetch_ryan_feedback.py` from an Illuminate checkout with GitHub CLI auth.

## Workflow

1. Resolve scope.
   - Prefer the current `pubnub/illuminate` checkout and current branch.
   - If a PR exists, read its title, body, base branch, file list, and existing comments with `gh pr view`.
   - If no PR exists, infer intent from branch name, task docs under `docs/tasks/active/`, changed files, and commits. State clearly that the PR description is inferred.

2. Build the review bundle.
   - Identify base: PR base branch when available; otherwise `origin/master`.
   - Inspect `git diff --stat`, `git diff --name-only`, and the focused diff against the merge base.
   - Read changed files and nearby collaborators. Do not rely on diff hunks alone when behavior crosses services, repositories, transactions, caches, guards, or background jobs.
   - Run or inspect relevant focused tests when feasible. If a finding depends on runtime behavior that tests do not cover, call that out.

3. Convert intent into invariants.
   - Extract every claim from the PR title/body/task: who can do what, under which mode, for which account/customer/subkey, with which persistence or visibility guarantees.
   - Review each changed code path against those invariants by operation type. Ryan often catches "read vs edit/delete", "create/edit/deactivate", and "strict vs fallback" mismatches.

4. Run the Ryan passes.
   - Intent drift: PR description, comments, docs, and code behavior disagree.
   - Boundary behavior: transaction visibility, nested transactions, async concurrency inside one transaction, cache ordering, feature-flag calls, external API load, and audit context inheritance.
   - Source-of-truth drift: duplicated setup paths, duplicated CI/build/test definitions, duplicated type shapes, or helper wrappers that no longer have production callers.
   - Customer/security/data scope: account, customer, dashboard, subkey, admin/internal guard, and OEM scoping are correct for every action.
   - Public contract changes: DTO validation, error messages, response shape, persisted payload assumptions, and client-visible behavior.
   - Data correctness: escaping, wildcard semantics, null/empty handling, state transitions, stale state, timeout/chunking behavior, and large-account cases.
   - Test reality: mocked tests hiding database isolation, transaction reuse, external calls, cache behavior, or cross-service atomicity.
   - Docs/ops parity: README commands, curl examples, docker-compose semantics, local setup, and reset instructions match the actual implementation.

5. Calibrate severity.
   - `BLOCKER`: likely data loss, security/privacy breach, broken production path, or merge would knowingly ship a serious regression.
   - `MAJOR`: plausible production regression, incorrect business behavior, bad boundary behavior, hot-path performance/load issue, or test gap over a high-risk path.
   - `MINOR`: incorrect edge behavior, misleading error/docs, dead code, maintainability drift, or consistency problem with limited blast radius.
   - `SUGGESTION`: useful hardening, consolidation, clarity, or future-proofing that should not block merge alone.

6. Report like Ryan.
   - Findings first, ordered by severity.
   - Each finding starts with severity, file:line, concrete issue, consequence, and suggested fix.
   - Prefer evidence over taste: quote the relevant code behavior in your own words and explain the runtime path.
   - End with "Ryan risk level" and a short ranked fix list.
   - If there are no findings, say what you checked and which residual risks remain.

## Output Template

```markdown
**Findings**
- [MAJOR] `path/file.ts:123` - Short issue title.
  Consequence: what breaks, for whom, and when.
  Suggestion: smallest credible fix or decision needed.

**Ryan Risk Level:** High | Medium | Low

**Likely Ryan Follow-Up**
- The questions or verification Ryan would probably ask.

**Fix Order**
1. Highest-impact fix.
2. Next fix.
```

## Refreshing Ryan Evidence

Run:

```bash
python3 /Users/jakubszwajka/.agents/skills/ryan-review/scripts/fetch_ryan_feedback.py \
  --repo pubnub/illuminate \
  --reviewer ryanmanns1-pubnub
```

Use `--author <login>` to override the authenticated GitHub user and `--out <file>` to save Markdown.
