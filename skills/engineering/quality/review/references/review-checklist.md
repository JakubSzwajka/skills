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
- [ ] **For migrations**: no assertions were silently dropped during mechanical replacement — check that every removed `assert` or `mock.assert_*` has an equivalent replacement, not just that the test file still exists
- [ ] Tests use real model instances (e.g. `UserModel(...)`) instead of `SimpleNamespace` or untyped stand-ins when the model is instantiable without DB overhead — untyped fakes hide field renames and new required fields
- [ ] Tests that monkey-patch methods on real ORM instances (e.g. `booking.method = Mock(...)`) should be flagged when the method is pure/state-driven — prefer driving behavior through model state (e.g. setting the right status) so the real logic is exercised

## Types & Safety
- [ ] Types are present where the codebase convention expects them
- [ ] No `any` / untyped escapes without justification
- [ ] Null/undefined handling is explicit
- [ ] No type assertions that hide real problems
- [ ] Defensive checks (e.g. `getattr(x, 'field', None)`) are justified — flag when the field is required and can never be None/missing
- [ ] No `SimpleNamespace` or bare `Mock()` used as a stand-in for a typed model — Pyright cannot catch field mismatches on untyped fakes

## Naming & Readability
- [ ] Variable/function/class names are clear and consistent with codebase
- [ ] No misleading names (e.g., `getData` that also writes)
- [ ] Abbreviations match existing conventions
- [ ] Code reads top-down without needing to jump around

## Architecture & Patterns
- [ ] Follows existing patterns in the codebase (don't reinvent)
- [ ] No unnecessary abstractions or premature generalization
- [ ] New public APIs are as simple as possible — every parameter must be justified; flag if the caller could derive it from data it already holds
- [ ] Dependencies flow in the expected direction
- [ ] No circular dependencies introduced
- [ ] File placement matches project structure conventions

## Module & Architecture (only when architecture is defined — skip entirely if 🏗️)

Check against the project's stated architecture rules. Do not invent rules — only check what's documented.

- [ ] Imports respect stated module boundary rules (e.g., "domain A cannot import domain B's models")
- [ ] New code lives in the correct layer per the layer rules
- [ ] Cross-module orchestration is in the designated orchestration layer, not in domain facades
- [ ] New facade/service dependencies are justified — flag if a class now has >5 injected dependencies from other modules
- [ ] Event publishing follows the stated convention
- [ ] External service calls respect transaction boundary rules (no dual writes without compensation)
- [ ] New FK relationships across module boundaries are justified against the boundary rules
- [ ] Generic/shared modules don't gain domain-specific vocabulary

If a change violates a stated rule but seems intentional, flag as WARN:
"Violates [specific rule from architecture doc] — intentional?"

## Dead Code
- [ ] **For removals/migrations**: scan for symbols that only existed to support the removed mechanism — helper functions, TypeAliases, dataclasses, TypeVars, utility methods. These become dead the moment the mechanism is gone.
- [ ] No imports left over from removed code

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
