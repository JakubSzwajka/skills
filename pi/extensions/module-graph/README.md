# Pi module graph

A global Pi extension for generating and viewing TypeScript and JavaScript module dependency graphs.

The supplied path is a hard collection boundary. The analyzer recursively collects production JavaScript and TypeScript sources within it, including root-level files, while retaining every source-bearing direct child directory as a viewer-compatible module. It recognizes static imports, type-only imports, re-exports, dynamic `import()`, CommonJS `require()`, and TypeScript import types.

## Commands

Generate a graph without starting a server:

```text
/module-graph:generate src/modules
```

Serve the most recently generated graph for the current project:

```text
/module-graph:serve
```

Show graph and server state:

```text
/module-graph:status
```

Stop the server while keeping the generated graph cached:

```text
/module-graph:stop
```

## Viewer

The viewer opens at the selected directory. Every scope shows only its immediate source-bearing child directories and production source files directly inside it; deeper files are represented by their nearest child directory rather than flattened into the current view. Directory labels end in `/` and use a distinct box shape. Nodes are sized by total degree, runtime cycles are red, and type-only imports are dashed. Click a node to inspect it, drag to orbit, and scroll to zoom.

Imports are aggregated between the immediate visible children. Imports contained within one child stay hidden until that directory is opened. When a deeper scope imports to or from another branch, a non-expandable wireframe boundary stub such as `../common`, `../../storage`, or `../index.ts` represents that outside branch.

Double-click any directory node to enter it. Files and boundary stubs are leaves. The breadcrumb includes every directory from `root` to the current scope and each ancestor is clickable. Press `Escape` to go up exactly one directory. The HUD reports visible **Items** and aggregate **Edges** at every depth.

The server binds to `127.0.0.1` on an operating-system-assigned port. Pi also stops it on session shutdown, including reload, new session, resume, fork, and quit.

Generated graphs are cached outside source repositories. On macOS they live under `~/Library/Caches/pi-module-graph`; Linux uses `$XDG_CACHE_HOME/pi-module-graph` or `~/.cache/pi-module-graph`; Windows uses `%LOCALAPPDATA%\\pi-module-graph` when available.

## Scope

This is a TypeScript and JavaScript source analyzer, not a language-independent dependency graph. Source files must use `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, or `.cts` extensions. Tests, fixtures, declarations, dependency trees, caches, coverage, and build outputs are excluded. Git ignore rules are respected when the selected path is in a Git worktree.

The analyzer uses the nearest `tsconfig.json` for each source file, including one level of solution-style project references when the nearest config has no path aliases. It resolves path aliases and `.js` specifiers that point to TypeScript sources, and records every config used in the graph.

Every import is counted as resolved, external, or unresolved. Unresolved relative paths, aliases, and non-literal `import()` or `require()` calls are graph holes. Bare package specifiers count as external packages instead. The generate command reports holes and warns when they exceed 5 percent of the imports found.

The file-level data includes every resolvable import between collected files, including imports within the same directory branch. The viewer derives its current directory hierarchy from that collected file evidence; external packages do not create file or directory dependencies.

## Development

```bash
npm install
npm test
npm run check
```
