# Ryan Review Patterns

Derived from Ryan Manns comments on Jakub's `pubnub/illuminate` PRs as of 2026-07-03.

## Evidence Set

- PRs inspected: #780, #781, #782, #783, #784, #785, #786, #788.
- Ryan feedback found on: #780, #782, #783, #785, #786.
- Reviewer login: `ryanmanns1-pubnub`.
- Comment surfaces used: PR conversation comments, review bodies, and inline review comments.

## What Ryan Catches

### 1. Intent Drift

Ryan compares the PR description to the actual code behavior and flags mismatches even when the code is internally consistent.

- #780: PR description said OEM customers could read charts on one of their dashboards, while the repository helper enforced exclusive dashboard scoping for reads as well as edits/deletes.
- #785: Inline note caught wording drift where the PR description showed `mode: verified` while the implementation exposed different lookup modes.

Review move:

- Turn the PR description into explicit invariants.
- Check every changed operation against those invariants.
- If behavior is intentional but the description is wrong, require the description to change.

### 2. Boundary Bugs Hidden by Local Correctness

Ryan traces through runtime boundaries where a unit-level refactor can look correct but fail in production.

- #785: Create/edit reconciled subkey enablement inside an outer transaction, but the lookup opened another transaction and likely could not see uncommitted BO changes under READ COMMITTED.
- #785: Feature-flag lookup moved ahead of the cache, making every subscription lookup call Portal feature flags on a hot path.
- #786: `Promise.all` inside one AsyncLocalStorage-backed interactive Prisma transaction could dispatch concurrent queries on a single transaction client.
- #786: Bulk deactivation moved many operations into one transaction without overriding the default interactive transaction timeout.
- #786: Nested `auditableTransaction` and `withTransaction` reuse paths had different audit-context behavior.

Review move:

- Follow the real call chain, not only the changed function.
- Ask what each DB transaction, cache, feature flag, and external API call can see at that moment.
- Treat AsyncLocalStorage transaction reuse as a concurrency and attribution risk.
- Prefer integration tests or real DB checks when isolation semantics matter.

### 3. Source-of-Truth Drift

Ryan notices when a PR creates or preserves duplicate definitions that will diverge later.

- #782: `make npmrc` and `npm run npmrc` generated structurally different `.npmrc` files and the README pointed at one while package scripts exposed another.
- #782: CI duplicated Dockerfile build/test logic, with stricter native checks than Docker stages.
- #782: CI hardcoded lint globs instead of reusing the package script.
- #785: Identical billing/subscription lookup option types could drift as modes evolve.
- #786: Two transaction reuse paths contradicted the documented "inherit outer audit context" contract.

Review move:

- Search for existing commands, helpers, types, and docs before accepting a new path.
- Flag duplicates when they encode the same policy or workflow.
- Prefer one canonical implementation plus thin wrappers.

### 4. Public Contract and Consumer Behavior

Ryan treats validation, error messages, and DTO changes as public behavior, not just implementation details.

- #780: Error text said `dimensionId` filtering required `include=metric`, but the branch actually meant the chart had no metric.
- #780: Changing `dimensionIds` from string validation to UUID validation was correct but could reject existing clients or persisted payloads.
- #783: `@Id()` became a throwing param decorator, which introduced a third validation pattern alongside DTO validation and explicit validate helpers.

Review move:

- Identify every externally visible behavior change.
- Compare error shape and validation path to established project conventions.
- Ask whether live clients, fixtures, or persisted payloads rely on the old shape.

### 5. Data Correctness Edge Cases

Ryan flags correctness surprises even when they are not security bugs.

- #780: SQL string escaping closed injection risk but did not escape `%` and `_` for LIKE semantics, so literal user values could act as wildcards.
- #785: `deactivateAll` used optional chaining in a way that could still call `Promise.all(undefined)` or read `.length` from undefined.
- #786: Large-account deactivation could exceed default transaction timeout; bulk jobs need large-case reasoning.

Review move:

- Check special characters, null/empty inputs, large inputs, repeated calls, and stale state.
- Separate security impact from correctness impact.
- Look for "probably array" or "probably small" assumptions.

### 6. Test Gaps Where Mocks Hide the Risk

Ryan asks for tests exactly where current tests cannot observe the suspected bug.

- #785: Mocked pn-config and BO-service tests could not catch real transaction visibility in create/edit -> reconcile -> findBySubkey.
- #786: Tests covered BO ordering but did not prove associated decision edits used the shared transaction.
- #782: Native CI enforced strict checks while Docker stages used mutating format/lint commands, so the chosen enforcement path mattered.

Review move:

- Do not ask for generic more tests.
- Identify the precise behavior the current test style cannot see.
- Suggest the smallest integration or service-level test that would fail for the suspected issue.

### 7. Docs, Setup, and Operational Parity

Ryan checks whether developer-facing instructions match the real workflow.

- #782: README still told developers to run the old `.npmrc` command.
- #782: Named Postgres volume changed local reset semantics; docs should mention `docker compose down -v`.
- #786: README curl omitted `Content-Type: application/json` while the workflow sent it.

Review move:

- Verify README examples, Makefile targets, package scripts, Dockerfile stages, and workflow YAML agree.
- Treat local setup drift as a real productivity bug.

## Ryan-Style Finding Anatomy

Use this shape:

1. Severity and precise anchor: `[MAJOR] path/file.ts:line`.
2. Short claim: what is wrong.
3. Evidence: how the code path actually behaves.
4. Consequence: who sees the failure and when.
5. Suggestion: smallest fix, decision, or verification.
6. Test note when mocks would miss it.

Ryan's strongest findings are consequence-first. They do not stop at "this looks inconsistent"; they explain the runtime failure.

## Pre-Review Checklist

- Does the PR description match read/list/create/edit/delete/deactivate behavior separately?
- Does any helper apply one predicate to actions with different authorization semantics?
- Did ordering change around cache, feature flags, DB reads, or external calls?
- Does a transaction read data written inside another still-open transaction?
- Does AsyncLocalStorage cause nested operations to reuse a transaction unexpectedly?
- Are concurrent promises dispatched inside a single interactive transaction?
- Can a bulk path exceed default timeout, max wait, or connection assumptions?
- Are audit/account/customer contexts inherited or overwritten consistently?
- Did a public DTO, decorator, pipe, or error message change behavior?
- Are LIKE, regex, UUID, timestamp, null, empty, and large-input cases handled literally?
- Did the PR introduce duplicate command/type/workflow definitions?
- Do docs, Makefile/package scripts, Dockerfile, CI, and local setup instructions agree?
- Do tests exercise the real boundary where the risk lives, or only mocked collaborators?
