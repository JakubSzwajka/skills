# 06 — Make task mutations concurrency-safe

**What to build:** Make appends, lifecycle changes, and reference changes safe when several Pi sessions or processes update the same canonical task.

**Blocked by:** 05 — Share canonical tasks across worktrees.

**Status:** ready-for-agent

- [ ] Parallel appends preserve every successfully reported entry.
- [ ] Lifecycle and reference updates cannot overwrite an append that happens at the same time.
- [ ] Metadata replacement is atomic and has documented crash-recovery behavior.
- [ ] Mutations report success only when the requested change was persisted.
- [ ] Multi-process stress tests cover append-versus-append and append-versus-metadata updates.
