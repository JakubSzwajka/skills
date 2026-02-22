---
name: smart-commit
description: Analyze changes, run pre-commit checks, stage and commit with a short message
user_invocable: true
argument: Optional scope hint — file paths, globs, or description of what to stage (e.g. "only migration files / only specific changes "). If omitted, all changes are staged.
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

- If the user provided a scope hint via `$ARGUMENTS`, stage **only** matching files. Use `git add <paths>` with the relevant files. Show the user what you're staging and confirm it looks right before committing.
- If no scope hint, stage all changes with `git add -A`.

## 4. Commit

- Commit with the drafted message.
- **NEVER include Co-Authored-By, Signed-off-by, or any other trailers in the commit message. The message must contain only the commit description and nothing else.**
- Use a HEREDOC for the message to preserve formatting.
- Run `git status` after to confirm success.
- Do **NOT** push.
