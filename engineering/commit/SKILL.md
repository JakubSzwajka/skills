---
name: commit
description: Analyze changes, run pre-commit checks, stage and commit with a short message
user-invocable: true
disable-model-invocation: true
argument-hint: [scope]
---

# Commit Skill

Follow these steps **in order**. Stop and report to the user if any step fails.

## 1. Analyse changes

- Run `git diff` (unstaged) and `git diff --cached` (staged) and `git status` to understand the full picture.
- Draft a **short, imperative** commit message (1 sentence, under 72 chars). Focus on the "why", not the "what".

## 2. Run pre-commit checks if exists / linting etc.


Depending on the repository find and run pre-commit checks with linting and code formatting. 
Stage changes introduced by linting commands. 

## 3. Stage changes

- If the user provided a scope hint via `$ARGUMENTS`, stage **only** matching files. Use `git add <paths>` with the relevant files.
- If the user explicitly invoked the commit command, treat that as approval to proceed without an extra confirmation step unless the situation is tricky (for example: ambiguous scope, unexpected staged files, merge conflicts, or signs of parallel work that could make the commit unsafe).
- When the situation is tricky, show what you're staging and ask for confirmation before committing.
- If no scope hint, stage all changes with `git add -A`.

## 4. Commit

- Commit with the drafted message.
- **NEVER include Co-Authored-By, Signed-off-by, or any other trailers in the commit message. The message must contain only the commit description and nothing else.**
- Pass the message directly to git (for example with `git commit -F - <<'EOF' ... EOF`) so no editor opens.
- Run `git status` after to confirm success.
- Do **NOT** push.
