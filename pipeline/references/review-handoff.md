# Review and Handoff Reference

## Pass review gate

After the selected subtask is implemented:
1. Run a read-only review subagent over the changes for this pass.
2. Present verdict: `READY` or `NEEDS WORK`.
3. If `NEEDS WORK`, show findings and ask whether to fix now or defer.
4. If fixing, delegate non-trivial fixes to a scoped fixer agent, then re-review.
5. Stop after 3 fix/review loops and pause with remaining blockers.

Never skip pass review.

## Docs gate

After review passes, run `update-docs` behavior if changes altered:
- module contracts
- runtime wiring
- env/config
- API surface
- module relationships

## Pass summary

Render the shared handoff packet from `../../references/handoff-packet.md`.

Include:
- selected subtask and status
- files changed and what changed
- evidence mapped to acceptance criteria
- validation commands/results
- review verdict
- remaining decisions/blockers, if any
- next runnable subtask or `none`
- whether the task folder should move from `docs/tasks/active/` to `docs/tasks/archive/`

## Review guide

Group changed files from `git diff --name-only`:
1. **Core changes** — primary intent lives here
2. **Dependent changes** — supporting updates caused by core changes
3. **Tests** — new/modified test files
4. **Docs & config** — README/config/migration/task docs

Keep it short. Actual paths only.
