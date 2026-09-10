# 07 — Add agent management and atomic continuation

**What to build:** Give the agent a small management tool that can manage tasks proactively and continue the right active repository task in one atomic operation.

**Blocked by:** 03 — Manage lifecycle and references through `/task`; 05 — Share canonical tasks across worktrees.

**Status:** ready-for-agent

- [ ] The management tool supports list, continue, create, attach, detach, status, and reference actions.
- [ ] `continue` returns the current valid active attachment before searching for another task.
- [ ] Without a valid attachment, `continue` ranks active candidates by repository identity, explicit branch or worktree association, and recent activity, then attaches one before returning.
- [ ] Waiting, paused, and done tasks never qualify for automatic continuation.
- [ ] A manual user selection remains authoritative, and an explicit separate-work request can create a new task.
- [ ] The manual task workflow and management tool call the same domain operations.
- [ ] Public-contract tests cover zero, one, and several active candidates plus manual overrides.
