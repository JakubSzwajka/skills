# `/commit`

`/commit [instruction]` asks an isolated Pi session to inspect the current repository, choose the attributable paths, stage them, write a one-line subject, and create one commit. Invoking the command is explicit approval for that commit.

The optional instruction is the primary scope hint. The active, compaction-aware parent thread is the fallback. The worker refuses when it cannot separate the requested change from unrelated work or when unrelated changes are already staged.

## Isolation and model order

The worker uses an in-memory session with project extensions, skills, prompts, themes, context files, and settings disabled. Its only tools are:

- `read`
- `git_snapshot`
- `git_stage`
- `git_commit`

It never receives `bash`, `edit`, `write`, delegate, or parent custom tools. Git tools call `git` with argument arrays, validate paths and messages, keep hooks enabled, preserve the existing index, and refuse if `HEAD` moves.

The command resolves Git's active index path before reading status. When the index exists, it realpaths the index file itself so symlink aliases use one identity. It follows final symlink chains, including dangling chains, with loop detection before using the missing-index fallback. For a missing target, it realpaths the parent directory and keeps the target filename. It creates an exclusive lockfile beside that canonical index and holds it through preflight, snapshot, staging, and commit. This binds `/commit` runs that target the same resolved index. It does not exclude a plain `git add` or another Git command run elsewhere.

Lock publication is atomic. The command writes and syncs a unique temporary holder file, hard-links the complete file into the lock path, then removes the temporary name. `process.pid` appears in the temporary filename and holder JSON for diagnostics only. `/commit` never uses it for liveness or reclamation. If the lock path already exists, acquisition refuses immediately without inspecting or reclaiming it and reports the absolute path plus the exact `rm` command, even when the Git directory is not writable. A crash leaves the lock in place until the operator confirms no `/commit` run still owns it and removes it manually. A crash can also leave a unique temporary file, which the operator may delete.

Normal release has a bounded wait, checks the lock's file identity against the file this run published, and cannot change a successful commit result. Ownership is guaranteed against other `/commit` runs because they never remove a live lock. Removing a live lock by hand voids that ownership guarantee.

`git_stage` and `git_commit` request Pi's sequential tool scheduling. Once any commit attempt starts, staging stays closed even if validation or a hook rejects the commit. A message rejected before any Git mutation may fall back from Luna to Haiku because the second worker starts from the unchanged index. Snapshot sections have separate byte budgets, with 20 KiB reserved for the staged diff, so a large unstaged patch cannot remove staged evidence.

Models run in this exact order:

1. `openai-codex/gpt-5.6-luna`
2. `openrouter/anthropic/claude-haiku-4.5`

Haiku is tried only when Luna has a setup or provider failure before any Git mutation, or when Luna passes an invalid commit message before any mutation. There is no fallback after staging starts.

## Parent result

The parent gets one non-triggering custom message:

```text
Committed <hash>: <subject>
```

or one failure line:

```text
Commit failed: <reason>
```

Failures are bounded except lock-path failures. Those preserve the full absolute lock path and, for contention, the exact `rm` command even when the result exceeds the normal limit. The worker transcript and assistant prose are never copied into the parent.

## Tests

```sh
node --experimental-strip-types --test pi/extensions/commit/*.test.ts
```

The suite includes a real in-memory `AgentSession` with a local stream stub and cross-process temporary-repository lock tests.
