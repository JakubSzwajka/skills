# 05 — Share canonical tasks across worktrees

**What to build:** Store one canonical task record per repository and task ID so repository subdirectories and linked worktrees see the same task set and attachments survive path changes.

**Blocked by:** 02 — Harden the compatible task codec; 04 — Resolve repository identity.

**Status:** ready-for-agent

- [ ] Repository roots, nested directories, and linked worktrees list and open the same canonical tasks.
- [ ] Session attachment data identifies a task by repository identity and task ID, with paths used only as recovery hints.
- [ ] A moved task can be recovered from its identity when its previous path no longer exists.
- [ ] Existing task files remain readable during migration to canonical storage.
- [ ] Divergent files with the same task ID produce a typed conflict that requires an explicit merge choice.
- [ ] Conflict detection leaves every source file byte-for-byte unchanged.
