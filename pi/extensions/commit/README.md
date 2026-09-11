# `/commit`

`/commit [instruction]` asks an isolated Pi session to inspect the current repository, choose the attributable paths, stage them, write a one-line subject, and create one commit. Invoking the command is explicit approval for that commit.

The optional instruction is the primary scope hint. The active, compaction-aware parent thread is the fallback. The worker refuses when it cannot separate the requested change from unrelated work or when unrelated changes are already staged.

## Isolation and model order

The worker uses an in-memory session with project extensions, skills, prompts, themes, context files, and settings disabled. Its only tools are:

- `read`
- `git_snapshot`
- `git_stage`
- `git_commit`

It never receives `bash`, `edit`, `write`, delegate, or parent custom tools. Git tools call `git` with argument arrays, validate paths and messages, keep hooks enabled, preserve the existing index, and refuse if `HEAD` moves. A successful receipt reads the short hash, full commit message, and committed path list back from Git. Assistant prose cannot supply any of those fields.

The command resolves Git's active index path before reading status. When the index exists, it realpaths the index file itself so symlink aliases use one identity. It follows final symlink chains, including dangling chains, with loop detection before using the missing-index fallback. For a missing target, it realpaths the parent directory and keeps the target filename. It creates an exclusive lockfile beside that canonical index and holds it through preflight, snapshot, staging, and commit. This binds `/commit` runs that target the same resolved index. It does not exclude a plain `git add` or another Git command run elsewhere.

Lock publication is atomic. The command writes and syncs a unique temporary holder file, hard-links the complete file into the lock path, then removes the temporary name. `process.pid` appears in the temporary filename and holder JSON for diagnostics only. `/commit` never uses it for liveness or reclamation. If the lock path already exists, acquisition refuses immediately without inspecting or reclaiming it and reports the absolute path plus the exact `rm` command, even when the Git directory is not writable. A crash leaves the lock in place until the operator confirms no `/commit` run still owns it and removes it manually. A crash can also leave a unique temporary file, which the operator may delete.

Normal release has a bounded wait, checks the lock's file identity against the file this run published, and cannot change a successful commit result. Ownership is guaranteed against other `/commit` runs because they never remove a live lock. Removing a live lock by hand voids that ownership guarantee.

`git_stage` and `git_commit` request Pi's sequential tool scheduling. Once any commit attempt starts, staging stays closed even if validation or a hook rejects the commit. A message rejected before any Git mutation may fall back from Luna to Haiku because the second worker starts from the unchanged index. Snapshot sections have separate byte budgets, with 20 KiB reserved for the staged diff, so a large unstaged patch cannot remove staged evidence.

Models run in this exact order:

1. `openai-codex/gpt-5.6-luna`
2. `openrouter/anthropic/claude-haiku-4.5`

Haiku is tried only when Luna has a setup or provider failure before any Git mutation, or when Luna passes an invalid commit message before any mutation. There is no fallback after staging starts.

## Live progress

While the command runs, a widget above the editor shows the command, the model used by the current attempt, elapsed time, and the current Git phase. Staged paths appear as soon as staging starts. For example:

```text
/commit  luna  4.2s
staging  3 files
  README.md
  pi/extensions/commit/command.ts
  pi/extensions/commit/widget.ts
```

The phase moves through `inspecting`, `staging`, and `committing` from direct tool callbacks. The 100 ms timer only repaints elapsed time; it never polls the model. A Luna-to-Haiku fallback changes the model label when the Haiku attempt starts. Success, failure, timeout abort, and session shutdown all tear down the timer and clear the widget. The widget clears before the parent result is injected, so it does not remain in the thread.

## Parent result

The parent gets one non-triggering custom message. Success includes the receipt's short hash, full commit message body, and committed file list:

```text
Committed abcdef123456

Commit message:
feat: make commits observable

Explain the operator-visible receipt.

Committed files:
- "pi/extensions/commit/command.ts"
- "pi/extensions/commit/widget.ts"
```

A worker failure or refusal includes its reason and the candidate changed paths seen in the preflight and snapshots:

```text
Commit failed: the commit worker did not create a commit
Candidate changed paths seen:
- "pi/extensions/commit/command.ts"
- "unrelated.txt"
```

Normal failures stay within 2,000 characters, with the reason itself limited to 180 characters. Lock-path failures are the exception. They preserve the full absolute lock path and, for contention, the exact `rm` command even when the result exceeds the normal limit. Failures before repository inspection have no candidate path section. The worker transcript and assistant prose are never copied into the parent.

## Tests

```sh
node --experimental-strip-types --test pi/extensions/commit/*.test.ts
```

The suite includes a real in-memory `AgentSession` with a local stream stub, widget lifecycle and teardown tests, receipt and failure-detail tests, and cross-process temporary-repository lock tests.
