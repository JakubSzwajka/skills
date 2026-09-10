# 10 — Carry task identity into subagents

**What to build:** Let child agents inherit the parent's canonical task identity and use task tools only when that identity resolves safely.

**Blocked by:** 06 — Make task mutations concurrency-safe; 07 — Add agent management and atomic continuation; 08 — Add bounded searchable history.

**Status:** ready-for-agent

- [ ] The management tool remains available before attachment, while logging and reading tools activate only for a valid attachment.
- [ ] A child run inherits repository and task identity rather than an absolute task-file path.
- [ ] An inherited child attachment resolves to the same canonical task from another worktree or directory.
- [ ] A child without inherited task identity receives no active logging or reading tools and no guidance that asks it to call them.
- [ ] Parent and child sessions can append in parallel without losing entries.
- [ ] Public-contract tests cover inherited, missing, stale, and conflicting child identities.
