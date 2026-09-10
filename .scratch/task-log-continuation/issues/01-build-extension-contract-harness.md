# 01 — Build the extension contract harness

**What to build:** A reusable public-contract test harness for the task-log extension. It must exercise the extension as Pi does, using a fake host and temporary repositories rather than mutating internal state.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] The fake host captures registered commands, tools, lifecycle hooks, custom entries, and context messages.
- [ ] Temporary repository fixtures cover task creation, attachment, logging, reading, and session restoration.
- [ ] Baseline tests preserve the extension's current visible behavior before later tickets change it.
- [ ] The harness models only documented Pi APIs for provider-only context, dynamic tool availability, and child identity propagation, with evidence recorded for each supported seam.
- [ ] Existing picker tests remain green.
