# 11 — Integrate task-aware skills

**What to build:** Make task-producing and implementation skills reuse the current attached task so one initiative keeps a continuous record across specifications, tickets, implementation, and delegation.

**Blocked by:** 09 — Inject a compact, fresh handoff; 10 — Carry task identity into subagents.

**Status:** ready-for-agent

- [ ] `to-spec`, `to-tickets`, `implement`, and similar installed skills continue the attached task by default.
- [ ] A skill creates a new task only when no active task covers the request or the user explicitly starts separate work.
- [ ] Each durable skill output is added as a task reference.
- [ ] Each skill records a concise structured handoff rather than copying the full specification, ticket body, review, or plan into the log.
- [ ] Skill guidance remains safe when no task is attached or inherited.
- [ ] Integration tests or fixtures prove that consecutive skills contribute to one task without duplicate task creation or duplicated artifact content.
