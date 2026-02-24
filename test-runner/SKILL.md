---
name: test-runner
description: >
  Run tests and produce a focused report answering specific questions. Auto-detects
  test framework (pytest, jest, go test, cargo test, etc.). Filters noise and returns
  only actionable results. Triggers on: "run tests", "test this", "check if tests pass",
  "verify the changes", "test runner".
context: fork
---

# Test Runner

Run tests and produce a structured report that answers the caller's specific questions.

## Input

`$ARGUMENTS` contains:
1. **What to test**: file paths, module names, test patterns, or "all tests"
2. **What question to answer**: e.g., "do the referral tests pass?", "what breaks after the refactor?", "is the new endpoint covered?"

## Step 1: Detect Framework

Auto-detect the test framework by checking for:
- `pytest.ini`, `pyproject.toml` with `[tool.pytest]`, `conftest.py` → **pytest**
- `package.json` with jest/vitest/mocha → **jest/vitest/mocha**
- `go.mod` → **go test**
- `Cargo.toml` → **cargo test**
- `Makefile` with test targets → prefer make targets

Check for a `Makefile` first — if test targets exist (e.g., `make test-unit`, `make test-flows`), prefer those as they handle env setup.

## Step 2: Run Tests

Execute the appropriate test command. Capture full output but don't dump it raw.

Guidelines:
- Do NOT manually set environment variables (DATABASE_URL, STAGE, etc.) — they are auto-injected by test infrastructure
- Use `-x` or equivalent to stop on first failure when debugging
- Use `-v` for verbose output when investigating specific failures
- For targeted runs, use the most specific selector possible (file path, test name pattern)

## Step 3: Report

Produce a focused report:

```
## Test Results

**Command**: `<exact command run>`
**Result**: PASS (N passed) | FAIL (N passed, M failed, K errors) | ERROR (couldn't run)

### Answer
<Direct answer to the caller's specific question>

### Failures (if any)
For each failure (max 5, most important first):
- **Test**: `test_name` in `file_path`
- **What failed**: one-line description
- **Key output**: the assertion error or exception (2-5 lines, not full trace)
- **Likely cause**: brief analysis

### Summary
<1-2 sentences: what's the state, what should happen next>
```

Filter out:
- Collection output and fixture setup logs
- Passing test details (unless specifically asked)
- Full stack traces (extract the relevant assertion/error only)
- Deprecation warnings and other noise
