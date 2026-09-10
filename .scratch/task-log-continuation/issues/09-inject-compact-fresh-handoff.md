# 09 — Inject a compact, fresh handoff

**What to build:** Replace displayed raw-log attachment messages with a small provider-only handoff generated from the current task state on disk near the current user request.

**Blocked by:** 07 — Add agent management and atomic continuation; 08 — Add bounded searchable history.

**Status:** ready-for-agent

- [ ] Automatic context contains the task objective, status, references, latest structured handoff, and only newer entries that fit the configured total budget.
- [ ] Large descriptions, one oversized entry, and hundreds of entries cannot exceed the configured context budget.
- [ ] Reattachment and session resume read current disk state, including changes written by another session.
- [ ] A fingerprint or version prevents unchanged task state from being injected more than once.
- [ ] The full task log is never persisted as a displayed conversation message.
- [ ] Public-host tests verify placement near the current user request, refresh behavior, ordering, and exact budget enforcement.
