# Resolve the way the project resolves

Blocked by: 01-import-accounting

Per-file TypeScript config, followed project references, and canonical paths.

Spec sections: "Config resolution" and "Path canonicalization" in `../SPEC.md`.

## Work

- Resolve the nearest `tsconfig.json` per file, cached by containing directory.
- When a config has `references`, attribute each file to the referenced project that contains it
  and use that project's whole compiler options. Membership comes from `fileNames`, cached per
  project. Fall back to the nearest config's own options, with `paths` merged from references,
  when no referenced project contains the file.
- Replace the graph's `tsconfig` field with `tsconfigs`, a sorted list of configs used.
- Pass `modulesRoot`, `projectRoot`, and every resolved target through
  `realpathSync.native`, falling back to the plain absolute path.

## Acceptance

- [x] A package-local `paths` alias resolves when the run starts at the monorepo root
- [x] A solution-style root config with `references` resolves aliases from the referenced config
- [x] A compiler option that lives only in a referenced project, such as `resolveJsonModule`, takes effect for files that project contains
- [x] An import resolving outside the collected source set, a `.json` module for instance, counts as resolved and creates no node
- [x] A project reached through a symlinked parent produces the same graph as through its real path
- [x] `tsconfigs` lists every config actually used
- [x] Unresolved holes on `~/DEV/pubnub/blocksnetwork` drop well below the 1765 baseline
- [x] `npm test` and `npm run check` pass
- [ ] A malformed, unknown-option, or missing tsconfig anywhere in the tree degrades to the nearest good ancestor instead of aborting the whole graph, and the failure is reported in the graph
- [ ] Config lookup stops at `projectRoot`, matching the workspace package scan

Verified 2026-09-11 by the `verify1` lane, which reproduced every number and proved the symlink
fix on `/tmp`. The two open boxes are regressions ticket 02 introduced: reading every config in
the tree turned any imperfect config into a total failure, and `nearestConfig` walks above
`projectRoot` while `collectWorkspacePackageNames` does not.
