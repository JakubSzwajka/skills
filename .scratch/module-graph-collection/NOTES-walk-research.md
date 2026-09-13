# File-collection research

## 1. Declaration attribution

`node` with TypeScript `resolveModuleName`, using `afui_mvp/src/hooks/useConsumerClient.ts`, resolves `@blocks-network/sdk` to:

- `resolvedFileName`: `blocks-sdk/sdks/node/dist/index.d.ts`
- `originalPath`: `afui_mvp/node_modules/@blocks-network/sdk/dist/index.d.ts`

The same command resolves `@blocks-network/sdk/stream` to `dist/stream/index.d.ts`. `ls -ld` and `realpath` show the node_modules entry is a symlink to `blocks-sdk/sdks/node`.

`blocks-sdk/sdks/node/package.json` has no `main`, `module`, or `types`. Its `exports` object maps `.` and `./stream` to `./dist/**` under `types` and `default` conditions. The Python field-target check confirmed every export target exists, but each is in `dist`; `src/index.ts` and `src/stream/index.ts` are the tracked source entry points (`git ls-files -- blocks-sdk/sdks/node/src/...`). Therefore none of the four fields reaches this package's real source. The package's `tsconfig.json` documents the build mapping `rootDir: "src"`, `outDir: "dist"`.

A survey command walked 40 package.json files while pruning `node_modules`, `.worktrees`, `.git`, and `.venv`. Field-presence shapes were: 37 with none of `main/module/types/exports`, 1 with `main` only (`blocks-sdk/mcp`, `dist/index.js`), 1 with `exports` only (`@blocks-network/sdk`), and 1 with all four (`blocks-sdk/embed-auth`). No package had `module`-only or `types`-only. `embed-auth/package.json` also points every entry to `dist`, while its `tsconfig.json` says `outDir: ./dist`.

Recommendation: resolve the package export for the requested subpath and condition, but verify that the result is a collected source file. For a `.d.ts` result, use package `rootDir/outDir` when available, then a verified `dist` to `src` subpath/extension substitution. If there is no unique collected candidate, record the import as an `alias` hole. Do not treat a declaration path as the source edge.

## 2. Skip list

The Python filesystem walk (pruning `node_modules` and `.git`, but including worktrees and the venv) found every relevant directory:

| directory | sibling package.json | proposed skip | evidence / right answer |
|---|---:|---:|---|
| `blocks-sdk/sdks/node/dist` | yes | yes | generated output; `sdks/node/tsconfig.json` has `outDir: dist` |
| `blocks-sdk/embed-auth/dist` | yes | yes | generated output; `embed-auth/tsconfig.json` has `outDir: ./dist` |
| `afui_mvp_backend/dist` | yes | yes | generated output; backend `tsconfig.json` has `outDir: dist` |
| `afui_mvp/dist` | yes | yes | Vite build output; `afui_mvp/package.json` has `build: tsc -b && vite build` |
| `.worktrees/refactor-module-boundaries/blocks-sdk/sdks/node/dist` | yes | yes | generated worktree output; worktree should also be excluded wholesale |
| `.worktrees/refactor-module-boundaries/afui_mvp_backend/dist` | yes | yes | generated worktree output; worktree should also be excluded wholesale |
| `.worktrees/ds-conformance-phase-5/blocks-sdk/sdks/node/dist` | yes | yes | generated worktree output; worktree should also be excluded wholesale |
| `.worktrees/ds-conformance-phase-5/afui_mvp/dist` | yes | yes | generated worktree output; worktree should also be excluded wholesale |
| `.worktrees/BLOCKS-602-cors-fixes/afui_mvp_backend/dist` | yes | yes | generated worktree output; worktree should also be excluded wholesale |
| `blocks-sdk/.venv/.../pip/_internal/operations/build` | no | no | 0 JS/TS source files; Python environment internals |
| `blocks-sdk/.venv/.../licenses/vendor` | no | no | 0 JS/TS source files; Python package metadata |

The same command found no matching directory in `workflow-runner`. Dependency descendants were not listed because `node_modules` is already an unconditional skip in `analyzer.ts`; they are not collection candidates. The walk counted 0 source files in every no-sibling-package target directory in both repos. Thus the current any-depth rule wrongly drops 0 real source directories in these snapshots. The proposed sibling-package rule is supported here. Keep an explicit `.worktrees` skip as well, since its contents are complete alternate checkouts, not package output.

## 3. Nested Git repositories and worktrees

`find blocksnetwork -name .git` (pruning dependencies and venv) found the root `.git` plus exactly these nested `.git` entries:

- `.worktrees/BLOCKS-602-cors-fixes/.git`
- `.worktrees/ds-conformance-phase-5/.git`
- `.worktrees/refactor-module-boundaries/.git`

For each, `git -C <path> rev-parse --show-toplevel --git-dir --git-common-dir --is-inside-work-tree` reported a `.git` regular file, a git dir under `blocksnetwork/.git/worktrees/<name>`, common dir `blocksnetwork/.git`, and `true`. `git -C blocksnetwork worktree list --porcelain` lists all three paths and their branches. They are worktrees, not submodules or independent checkouts, and should stay out. The root `.git` has no gitlink from `git ls-files --stage` and `.gitmodules` is absent, so there are no submodules to collect and no independent nested checkout to collect in this snapshot.

The distinguishing sequence is: inspect `.git` with `stat`; run the three `rev-parse` fields; run parent `git ls-files --stage` for mode `160000` and read `.gitmodules`; finally compare the path with `git worktree list --porcelain`. A future submodule or intentional independent checkout should be collected with scoped `git ls-files`; registered worktrees should be excluded.

## 4. Untracked files

The analyzer-equivalent command `git -C <repo> ls-files --others --exclude-standard -z`, filtered to `.cjs/.cts/.js/.jsx/.mjs/.mts/.ts/.tsx`, returned `all source: 0` for both `blocksnetwork` and `workflow-runner`. The unfiltered command also returned `all untracked: 0` for both. Dropping `--others` therefore loses no source a user could miss in these working trees. It would intentionally omit a newly-created, non-ignored source file until it is tracked; `includeUntracked` remains the right opt-in for that case.

## Recommendations

1. Verify declaration targets against the collected source set, then use `rootDir/outDir` or a checked `dist` to `src` mapping; otherwise emit an `alias` hole.
2. Apply build-name skips only beside `package.json`, and skip `.worktrees` itself before descending.
3. Detect nested Git type with `stat`, `rev-parse`, gitlinks, `.gitmodules`, and `worktree list`; collect submodules/intentional checkouts, not worktrees.
4. Drop `--others` by default and expose `includeUntracked`; the two measured repos currently have zero untracked source files.
