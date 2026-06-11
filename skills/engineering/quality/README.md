# Engineering Quality Helpers

This directory contains bounded quality workflows used by default Codex execution.
They are not personas and do not own quality doctrine.

- `review/` — review a changeset against stated intent, repo doctrine, tests, types, architecture fit, compatibility, security, and production readiness.
- `test/` — run targeted or broad validation commands and report focused evidence.

If a review or test run finds a missing product, architecture, or design decision,
escalate to the owning steward. If it finds missing validation doctrine, report the
gap and propose the smallest useful update to `docs/knowledge/quality/`.
