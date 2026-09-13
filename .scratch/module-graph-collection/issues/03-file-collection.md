# Stop losing files during the walk

Blocked by: 02-config-resolution

The walk must collect what exists and record what it skipped.

Spec sections: "File collection", "Declaration file attribution", "Module summary
alignment", "Performance" in `../SPEC.md`.

Research backing these decisions: `../NOTES-walk-research.md`.

## Work

- Skip `build`, `dist`, `out`, `cache`, `target`, `vendor` only beside a `package.json`.
  Keep `node_modules`, `bower_components`, and dot-prefixed tool caches skipped anywhere.
- Record every skip in `collection.skippedDirectories` with a reason.
- Follow symlinks with `statSync`, dedupe by realpath, reject links pointing outside the root.
- Skip `.worktrees` before descending. Research found its three entries are registered git
  worktrees, meaning complete alternate checkouts of the same repository.
- Detect nested git repositories and merge a scoped `git ls-files` for each, but only for
  submodules and independent checkouts. A registered worktree is excluded. Distinguish them with
  `stat` on `.git`, `rev-parse --git-common-dir`, a gitlink check via `ls-files --stage`, and
  `worktree list --porcelain`.
- Drop `--others` by default; add an `includeUntracked` option.
- Raise on a git failure that is not "not a worktree"; record `walkMode`.
- Map an imported `.d.ts` inside the project back to its package source entry point, or record the
  import as an `alias` hole. Research found `main`, `module`, and `types` are usually absent; the
  one package that matters resolves through an `exports` map that points entirely at `dist`. So
  resolve the export for the requested subpath, then translate `dist` back to source using the
  package tsconfig's `rootDir` and `outDir`, and accept the result only when it is a file already
  in the collected set. Otherwise emit the `alias` hole.
- Add a `ts.createModuleResolutionCache`, replace the linear module lookup with a prefix map,
  add an async variant used by the command handler.
- Make root-level files a synthetic module so the command and viewer counts agree.

## Acceptance

- [ ] A module directory named `build` with no sibling `package.json` is collected
- [ ] A `dist` directory beside a `package.json` is skipped and recorded in `skippedDirectories`
- [ ] A symlinked source file is collected exactly once
- [ ] A symlink pointing outside `modulesRoot` is rejected
- [ ] Sources inside a nested git repository are collected when it is a submodule or an independent checkout
- [ ] A registered git worktree under `.worktrees` is excluded
- [ ] An untracked file is excluded by default and included under `includeUntracked`
- [ ] A workspace dependency whose types point at `dist/*.d.ts` produces an edge to the package source
- [ ] Command summary and viewer root scope report the same item and edge counts
- [ ] `blocksnetwork` generation finishes under 2.5 seconds
- [ ] `npm test` and `npm run check` pass
