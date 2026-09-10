# 04 — Resolve repository identity

**What to build:** Resolve a stable repository identity and current branch or worktree association from repository roots, nested directories, and linked worktrees.

**Blocked by:** 01 — Build the extension contract harness.

**Status:** ready-for-agent

- [ ] A repository root and a nested directory resolve to the same repository identity.
- [ ] Linked worktrees resolve to one shared repository identity while retaining their own branch or worktree association.
- [ ] Repository moves do not make task identity depend on a stale absolute task-file path.
- [ ] Non-Git directories have a documented deterministic fallback or return a clear unsupported result.
- [ ] Tests use real temporary Git repositories and linked worktrees.
