# 02 — Harden the compatible task codec

**What to build:** A strict task-file codec that keeps valid existing task files readable while preventing malformed lifecycle data or entry text from corrupting later reads.

**Blocked by:** 01 — Build the extension contract harness.

**Status:** ready-for-agent

- [ ] Valid legacy tasks retain their title, description, status, references, and log entries when read through the extension.
- [ ] The codec supports `active`, `waiting`, `paused`, and `done` lifecycle states.
- [ ] The codec supports structured `handoff` entries with current state, next action, blockers, branch or worktree, latest commit, validation state, and references.
- [ ] Unknown or malformed lifecycle values fail clearly instead of silently becoming active.
- [ ] Ambiguous entry headings, control characters, multiline Markdown, and terminal escapes cannot alter entry boundaries or lifecycle metadata.
- [ ] Table-driven compatibility and rejection tests run through the public extension harness.
