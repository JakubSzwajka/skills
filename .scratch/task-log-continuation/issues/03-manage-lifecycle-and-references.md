# 03 — Manage lifecycle and references through `/task`

**What to build:** Let users change task lifecycle and references through the existing manual task workflow, backed by one shared task service rather than command-specific persistence logic.

**Blocked by:** 02 — Harden the compatible task codec.

**Status:** ready-for-agent

- [ ] One task service owns listing, creation, attachment, detachment, status changes, reference changes, and log appends.
- [ ] The manual task workflow uses that service without changing its existing picker behavior.
- [ ] Users can set a task to `active`, `waiting`, `paused`, or `done` and receive truthful success or failure feedback.
- [ ] Users can add, edit, and remove references without rewriting log history.
- [ ] Active-task lists exclude waiting, paused, and done tasks.
- [ ] Existing keyboard, cleanup, draft-preservation, sanitization, and nested-dialog tests remain green.
