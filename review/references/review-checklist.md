# Review Checklist

Use this checklist to ensure consistent, thorough reviews. Not every item applies to every change — skip sections that are irrelevant to the diff.

## Correctness
- [ ] Logic matches the stated intent (PRD/user story/goal)
- [ ] Edge cases handled (null, empty, boundary values)
- [ ] Error handling is appropriate — not excessive, not missing
- [ ] No off-by-one errors, race conditions, or resource leaks

## Tests
- [ ] New behavior has test coverage
- [ ] Existing tests still pass (no silent breakage)
- [ ] Tests are meaningful, not just coverage padding
- [ ] Edge cases from the diff are tested
- [ ] If no tests: flag clearly and explain what should be tested

## Types & Safety
- [ ] Types are present where the codebase convention expects them
- [ ] No `any` / untyped escapes without justification
- [ ] Null/undefined handling is explicit
- [ ] No type assertions that hide real problems

## Naming & Readability
- [ ] Variable/function/class names are clear and consistent with codebase
- [ ] No misleading names (e.g., `getData` that also writes)
- [ ] Abbreviations match existing conventions
- [ ] Code reads top-down without needing to jump around

## Architecture & Patterns
- [ ] Follows existing patterns in the codebase (don't reinvent)
- [ ] No unnecessary abstractions or premature generalization
- [ ] Dependencies flow in the expected direction
- [ ] No circular dependencies introduced
- [ ] File placement matches project structure conventions

## Backwards Compatibility
- [ ] Public APIs / exports unchanged or safely extended
- [ ] Database migrations are reversible (if applicable)
- [ ] Config changes have sensible defaults
- [ ] No breaking changes to consumers without explicit intent

## Security
- [ ] No secrets, tokens, or credentials in the diff
- [ ] User input is validated at system boundaries
- [ ] No SQL injection, XSS, command injection vectors
- [ ] Auth/authz checks present where needed

## Production Readiness
- [ ] No debug code, console.logs, TODO hacks left in
- [ ] Performance-sensitive paths are not degraded
- [ ] Logging is appropriate (not too verbose, not silent)
- [ ] Feature flags or rollback path if this is risky
