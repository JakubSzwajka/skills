# 08 — Add bounded searchable history

**What to build:** Let agents retrieve relevant task history through bounded, paginated, and filtered reads without loading the full log into context.

**Blocked by:** 03 — Manage lifecycle and references through `/task`; 05 — Share canonical tasks across worktrees.

**Status:** ready-for-agent

- [ ] Reads enforce positive integer entry-count and character limits under a documented maximum.
- [ ] Zero, negative, fractional, and excessive limits fail validation or clamp exactly as documented; none return the full log by accident.
- [ ] An opaque cursor supports stable forward or backward pagination without duplicating entries.
- [ ] Reads can filter by entry type, session, and text.
- [ ] Responses remain within their character budget when a description or single entry is oversized and indicate omitted content clearly.
- [ ] Public-contract tests cover pagination boundaries, combined filters, large histories, and malformed limits.
