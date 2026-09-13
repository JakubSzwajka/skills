# Module graph: trustworthy collection

Scope: the collection stage of the `module-graph` extension, meaning `analyzeModules` in
`pi/extensions/module-graph/analyzer.ts` and its tests. The viewer, the cache store, and the
HTTP server are untouched except where a new counter has to reach the command output.

Status of evidence: every bug below was reproduced on 2026-09-11 against
`~/DEV/pubnub/blocksnetwork` (1042 collected files) and purpose-built fixtures. Numbers in this
spec come from those runs.

## Problem statement

The graph lies, and it never says so.

Point `/module-graph:generate` at a monorepo root and it reports `Dependencies: 1` across seven
modules. The real figure is far higher. Of 5420 imports found in `blocksnetwork`, 2530 were
recorded and 1765 were thrown away in silence. 1525 of those discarded specifiers are internal
(`@/lib/api`, `@/components/ui/button`, `@blocks-network/sdk`).

The same command is accurate when aimed one directory lower, at `afui_mvp/src`. Nothing in the
output tells you which of the two answers to believe. A user who trusts the picture will conclude
that modules are independent when they are tightly coupled.

Alongside the resolver, the file walk quietly drops source that exists on disk: anything under a
directory called `build`, `out`, `cache`, `target` or `test`, any file reached through a symlink,
and anything inside a nested git repository.

## Solution

Two changes, in order of value.

First, the analyzer accounts for every import it sees. An import is resolved, classified as
external, or recorded as a miss with its file, line, and specifier. Nothing is discarded without a
record. `/module-graph:generate` prints the miss count, and a graph with many misses announces
that it is incomplete.

Second, the analyzer resolves the way the project itself resolves. TypeScript config is read per
file rather than once per run, project `references` are followed, paths are canonicalized so
symlinked checkouts work, and the file walk stops guessing that a directory name means build
output.

Afterwards, a user can point the command at a monorepo root and either get the real graph or a
loud warning explaining what is missing.

## User stories

1. As an engineer mapping a monorepo, I want cross-package imports to appear as edges, so that the graph matches what the code actually does.
2. As an engineer, I want the command to tell me how many imports it could not resolve, so that I know whether to trust the picture.
3. As an engineer, I want the unresolved list split into "probably an external package" and "probably internal", so that I can tell a harmless miss from a hole in the graph.
4. As an engineer, I want each miss to carry its file, line, and specifier, so that I can open the offending import and see why it failed.
5. As an engineer, I want a miss rate above a sane threshold to be stated plainly in the command output, so that I cannot miss the warning.
6. As an engineer working in a monorepo, I want each file resolved against its own nearest `tsconfig.json`, so that per-package path aliases work.
7. As an engineer whose root config is solution style, I want `references` followed, so that aliases defined only in a referenced config still resolve.
8. As an engineer, I want the tsconfig used for each file recorded in the graph, so that I can see which config produced a given edge.
9. As an engineer working in a symlinked checkout, I want the graph to be complete, so that the tool works under `/tmp`, worktrees, and linked package directories.
10. As an engineer with a module genuinely named `build` or `test`, I want its files collected, so that the graph does not silently omit a real part of my system.
11. As an engineer, I want to see which directories the walk skipped, so that an omission is a visible decision rather than a mystery.
12. As an engineer with symlinked source files, I want them collected once, so that linked modules appear and duplicates do not.
13. As an engineer with a nested git repository inside my tree, I want its sources collected, so that vendored or submoduled code is not invisible.
14. As an engineer depending on a workspace package that ships built types, I want the edge attributed to the package's source, so that `dist/*.d.ts` does not erase the dependency.
15. As an engineer using `import(someVariable)`, I want the tool to report that it saw an unanalyzable dynamic import, so that I know an edge may be missing.
16. As an engineer, I want files at the root of the selected path to participate in the module-level summary, so that the command and the viewer agree on the counts.
17. As an engineer, I want the same counts in the command output and the viewer HUD, so that I do not have to reconcile two numbers for one graph.
18. As an engineer running on a large repo, I want generation to finish quickly, so that the agent is not frozen while it works.
19. As an engineer, I want to know whether the walk used git or a plain disk crawl, so that I understand why the file set changed between runs.
20. As an engineer whose `git ls-files` call failed, I want an explicit notice rather than a silent switch to a different rule set, so that a broken environment does not look like a smaller codebase.
21. As an engineer, I want untracked stray files excluded by default, so that a teammate's leftover build output does not enter the graph.
22. As a maintainer, I want fixtures covering aliases, project references, workspaces, and symlinks, so that these regressions cannot ship again.
23. As a maintainer, I want the analyzer output to stay byte stable for the same inputs, so that snapshots and caches remain comparable.
24. As a maintainer, I want the graph schema version raised when its shape changes, so that stale caches are rejected rather than misread.

## Implementation decisions

### Module boundaries

All work lands inside the analyzer module. `index.ts` gains reporting lines only. `graph-store.ts`
gains a schema version bump. `viewer/graph-metrics.ts` changes only for the module-count
alignment in story 16.

The analyzer keeps one public entry point, `analyzeModules(options): ModuleGraph`. No new exported
function is added to the extension's surface. Internally the work splits into three concerns that
already exist as private functions: file collection, config resolution, and import resolution.

### Import accounting

`ModuleGraph` replaces `unresolvedRelativeImports` with a single `unresolvedImports` array. Every
entry carries `fromFile`, `fromModule`, `specifier`, `kind`, `line`, and a `classification` of
`relative`, `alias`, `bare`, or `dynamic-expression`.

Classification rule, in order:

- starts with `.` gives `relative`
- matches a `paths` key or a workspace package name from the nearest config gives `alias`
- a non-literal `import()` or `require()` argument gives `dynamic-expression`
- everything else gives `bare`

`relative`, `alias`, and `dynamic-expression` are treated as holes in the graph. `bare` is treated
as a probable external package and counted separately.

`ModuleGraph` gains a `collection` summary object holding `importsFound`, `importsResolved`,
`importsExternal`, `importsUnresolved`, `skippedDirectories`, and `walkMode` of `git` or `disk`.

`formatGenerated` prints the hole count whenever it is above zero, and prints an explicit warning
line when holes exceed 5 percent of imports found.

This is a breaking change to the cached graph shape, so `schemaVersion` moves to 2 and
`cacheVersion` to 2. The store already rejects unknown shapes, so old caches fail closed.

### Config resolution

Configs are resolved per file, not per run. A directory-keyed cache maps a containing directory to
its nearest `tsconfig.json` and parsed compiler options, so each config is read and parsed once.

When a config declares `references`, the file is attributed to the referenced project that
actually contains it, and that project's whole compiler options are used for every resolution
from that file. Membership comes from the `fileNames` list `parseJsonConfigFileContent` already
returns, cached once per run per referenced project. First containing project wins, in
declaration order.

When no referenced project contains the file, or there are no references, the nearest config's
own options are used, and `paths` are merged from references if its own `paths` are absent or
empty. Merging stays one level deep; references of references are not followed.

This rule replaces an earlier, narrower one that merged `paths` alone. The `accounting` lane
found the counterexample on 2026-09-11: `afui_mvp`'s root config carries `paths` but not
`resolveJsonModule`, which lives in the referenced `tsconfig.app.json`, so two `@/mock/*.json`
imports failed to resolve. Any per-option patch would have left `allowJs`, `jsx`, and
`customConditions` waiting to break the same way.

An import that resolves to a file outside the collected source set, a `.json` module for
instance, counts as resolved rather than as a hole, and creates no node.

The graph's `tsconfig` field becomes `tsconfigs`, a sorted list of the configs actually used.
`ModuleRecord` gains nothing; per-file config attribution lives in the collection summary.

### Path canonicalization

`modulesRoot`, `projectRoot`, and every resolved target pass through `realpathSync.native` with a
fallback to the plain absolute path. `displayPath` keeps producing project-relative forward-slash
text. The comment already in `graph-store.ts` about `/var` and `/private/var` describes the exact
failure this closes.

### File collection

Directory skipping stops being a global name match. `node_modules`, `bower_components`, and the
dot-prefixed tool caches stay skipped at any depth, since those names are unambiguous. `build`,
`dist`, `out`, `cache`, `target`, and `vendor` are skipped only when they sit directly beside a
`package.json`, which is where build output actually lives. Test directories keep the existing
`includeTests` switch and the same treatment.

Every skip is recorded in `collection.skippedDirectories` as a project-relative path with a reason.

Symlinks are followed with `statSync` rather than rejected by `lstatSync`. Collected files are
deduplicated by realpath, and a symlink pointing outside `modulesRoot` is rejected, keeping the
hard collection boundary intact.

Nested git repositories are detected during the walk. When a directory contains its own `.git`,
the analyzer runs a second `git ls-files` scoped to it and merges the result.

The git listing drops `--others`, so untracked files are no longer collected. An
`includeUntracked` option restores the old behavior for anyone who wants it.

When git is unavailable the walk falls back to disk as today, but the fallback is recorded in
`collection.walkMode`. A git invocation that fails for any reason other than "not a worktree"
raises rather than silently switching rule sets.

### Declaration file attribution

When an import resolves to a `.d.ts` file inside `projectRoot`, the analyzer walks up to the
nearest `package.json` and attempts to map the package back to a collected source entry point via
its `main`, `module`, or `exports` fields. On success the edge is attributed to that source file.
On failure the import is recorded as an `alias` hole rather than dropped.

### Module summary alignment

`discoverModules` keeps producing one module per direct child directory. Root-level files become a
synthetic module so that the command summary and the viewer root scope report the same item and
edge counts. The synthetic module is marked in the record so the viewer can keep rendering those
files as files.

### Performance

A `ts.createModuleResolutionCache` is created once per run and passed to every
`resolveModuleName` call. `buildModuleLookup` moves from a linear `find` to a prefix map keyed by
directory. `analyzeModules` gains an async variant used by the command handler so that generation
does not block the agent's event loop; the synchronous export stays for tests.

Target: `blocksnetwork` generation under 2.5 seconds, down from 6.8.

## Testing decisions

A good test here drives `analyzeModules` against a real temporary directory and asserts on the
returned `ModuleGraph`. It never reaches into private helpers, never asserts on log text, and never
mocks the filesystem or the TypeScript compiler. If a behavior cannot be observed in the returned
graph, that is a signal the graph is missing a field, not a signal to lower the seam.

### Seam

One seam: `analyzeModules`. It is the existing seam, it is the highest available point below the
command handler, and `__tests__/analyzer.test.ts` already uses it with the `fixture()` helper that
writes a temp project and returns its path. No new seam is introduced.

`__tests__/module-graph-service.test.ts` covers the command-level path and picks up the new
reporting lines for free. `__tests__/graph-metrics.test.ts` covers the module-count alignment.

### Prior art

`__tests__/analyzer.test.ts` already demonstrates the pattern this work extends: build a fixture
tree, run `analyzeModules`, assert on modules, dependencies, and evidence. Tests named "respects
Git ignore rules within the selected root" and "reports resolved files outside the hard root
without collecting or crawling them" are the closest models. The `fixture()` helper must grow the
ability to write a per-package `tsconfig.json` and to create symlinks.

### Cases to cover

1. [ ] Package-local `paths` alias resolves when the run starts at the monorepo root.
2. [ ] Solution-style root config with `references` resolves aliases from the referenced config.
3. [ ] An unresolvable alias appears in `unresolvedImports` classified as `alias`.
4. [ ] An unresolvable bare specifier is counted as external, not as a hole.
5. [ ] A non-literal `import()` and a non-literal `require()` both appear as `dynamic-expression`.
6. [ ] A project reached through a symlinked parent produces the same graph as through its real path.
7. [ ] A symlinked source file is collected exactly once.
8. [ ] A symlink pointing outside `modulesRoot` is rejected.
9. [ ] A module directory named `build` beside no `package.json` is collected.
10. [ ] A `dist` directory beside a `package.json` is skipped and recorded in `skippedDirectories`.
11. [ ] Sources inside a nested git repository are collected.
12. [ ] An untracked file is excluded by default and included under `includeUntracked`.
13. [ ] A workspace dependency whose types point at `dist/*.d.ts` produces an edge to the package source.
14. [ ] The same fixture produces byte-identical output across shuffled directory entry order.
15. [ ] A cached graph at `schemaVersion: 1` is rejected by the store.
16. [ ] Command output names the hole count, and warns above the 5 percent threshold.

### Regression baseline

`blocksnetwork` is the acceptance case. Before: 5420 found, 2530 recorded, 1765 silently dropped.
After: recorded edges materially higher, and `importsFound` equal to
`importsResolved + importsExternal + importsUnresolved` exactly. That identity is the real
acceptance test, because it is the property that makes the graph honest.

## Out of scope

- Everything in the viewer: arrowheads, label collision, zoom to fit, auto-rotate, bloom strength, URL scope state. Those are real defects but they belong to a separate spec.
- The HTTP server and its lifecycle.
- Watching files and regenerating on change.
- Languages other than JavaScript and TypeScript.
- Drawing external packages as nodes. Externals stay counted, not drawn.
- Resolver support for bundler-specific aliasing declared outside tsconfig, such as Vite or webpack `resolve.alias`. Worth a follow-up, not this one.

## Further notes

The ordering matters. Import accounting comes first and alone is worth shipping, because it turns
a confidently wrong tool into a tool that admits what it does not know. Config resolution is the
larger correctness win but is harder to verify without accounting in place, since today there is
no number to watch move.

The `.d.ts` attribution rule in this spec is the least certain piece. If it proves fiddly, degrade
it to recording the import as an `alias` hole with a clear specifier, which is still better than
today's silent drop.

The 5 percent warning threshold is a guess. Pick a final number after running the finished analyzer
across several real repositories.
