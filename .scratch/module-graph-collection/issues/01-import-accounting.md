# Account for every import

Blocked by: none

The analyzer must classify every import it finds. Nothing is discarded without a record.

Spec section: "Import accounting" in `../SPEC.md`.

## Work

- Replace `unresolvedRelativeImports` with `unresolvedImports`, each entry carrying
  `fromFile`, `fromModule`, `specifier`, `kind`, `line`, `classification`.
- Classification order: `relative`, `alias`, `dynamic-expression`, `bare`.
- Record non-literal `import()` and `require()` arguments as `dynamic-expression`.
- Add a `collection` summary: `importsFound`, `importsResolved`, `importsExternal`,
  `importsUnresolved`, `skippedDirectories`, `walkMode`.
- Raise `schemaVersion` to 2 and `cacheVersion` to 2.
- `formatGenerated` prints the hole count, and warns when holes exceed 5 percent.

## Acceptance

- [x] `importsFound === importsResolved + importsExternal + importsUnresolved` holds on every fixture and on a real repo
- [ ] An unresolvable alias appears in `unresolvedImports` classified as `alias`
- [x] An unresolvable bare specifier is counted as external, not as a hole
- [x] A non-literal `import()` and a non-literal `require()` both appear as `dynamic-expression`
- [x] A cached graph at `schemaVersion: 1` is rejected by the store
- [ ] Command output names the hole count and warns above the threshold
- [x] `npm test` and `npm run check` pass
- [ ] `summarize()` is covered end to end, so real collection numbers are proven to reach the command output, including the sub-threshold no-warning case
- [ ] Files whose parse recovers from broken syntax report a diagnostic count rather than a quietly short import list

Verified 2026-09-11 by the `verify1` lane. Box 2 stays open because classification reads the
referenced project's `paths` rather than the nearest config's, so some alias holes are filed as
external. Box 6 stays open because the warning test hand-builds its summary, so a broken
`summarize()` would still pass.
