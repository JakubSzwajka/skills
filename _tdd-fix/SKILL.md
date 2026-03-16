---
name: _tdd-fix
description: >
  Fix a triaged bug using TDD: write a test that covers the buggy behavior, prove it
  fails, implement the fix, prove it passes. Use when the user says /tdd-fix after a
  triage has been completed in the current conversation. Requires a prior /triage report
  in context.
user-invocable: true
disable-model-invocation: true
---

# TDD Bug Fix

Fix a previously triaged bug using test-driven development. Requires a `/triage` report in the current conversation context.

## Prerequisites

A `/triage` report must exist in the conversation. If not, tell the user to run `/triage` first.

## Process

### Step 1: Write the test

Write a test that covers the code path where the bug lives. Critical rules:

- **Natural test name** — name it after the behavior being tested, NOT the bug. Example: `test_email_datetime_displays_in_local_timezone` not `test_fix_utc_bug_123`.
- **No bug references** — the test should read as if it was always meant to exist. No comments about "regression" or ticket numbers.
- **Test the public interface** — use facade methods or API calls, not internal helpers. Follow the project's black-box testing philosophy.
- **Place correctly** — unit tests colocated with modules, integration tests in `tests/flows/`.

Delegate test writing to a `logic-implementer` agent. Provide it with:
- The triage report's root cause and key files
- The project's test patterns and conventions (from CLAUDE.md)
- Clear instruction on what the test should assert

### Step 2: Prove it fails

Run the test and confirm it fails for the expected reason.

- Use `make test-unit` or `make test-flows` depending on test type
- If the test passes (bug not reproduced), the test is wrong — revisit Step 1
- Show the user the failure output (brief summary, not raw dump)

### Step 3: Implement the fix

Delegate the fix to a `logic-implementer` agent. Provide it with:
- The triage report's root cause and key files
- The minimal change needed
- Instruction to NOT modify the test file

The fix should be the smallest change that makes the test pass. No refactoring, no cleanup, no extra improvements.

### Step 4: Prove it passes

Run the same test again and confirm it passes.

- If it fails, iterate on the fix (not the test)
- Once green, run the broader test suite for the affected module to check for regressions
- Show the user the pass confirmation

### Step 5: Summary

Present:
- What the test covers
- What the fix changed (file + diff summary)
- Any follow-up items (e.g., "other templates use the same filter — already covered by this fix")

## Constraints

- Never modify test and production code in the same agent call
- Tests must look natural — no bug/ticket references
- Minimal fix only — no drive-by improvements
- If the triage is stale or insufficient, ask the user to re-run `/triage`
