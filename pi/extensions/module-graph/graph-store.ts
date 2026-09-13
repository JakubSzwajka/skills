import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { ModuleGraph } from './analyzer';

export interface CachedModuleGraph {
  cacheVersion: 2;
  generatedAt: string;
  scopeRoot: string;
  projectRoot: string;
  graph: ModuleGraph;
}

export class StaleModuleGraphCacheError extends Error {
  constructor(path: string) {
    super(`Cached module graph has an unsupported format: ${path}`);
    this.name = 'StaleModuleGraphCacheError';
  }
}

export class ModuleGraphStore {
  constructor(
    private readonly cacheRoot = defaultCacheRoot(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  save(cwd: string, projectRoot: string, graph: ModuleGraph): CachedModuleGraph {
    const scopeRoot = findScopeRoot(cwd);
    const cached: CachedModuleGraph = {
      cacheVersion: 2,
      generatedAt: this.now().toISOString(),
      scopeRoot,
      projectRoot: canonicalPath(projectRoot),
      graph,
    };
    const path = this.pathFor(cwd);
    const temporaryPath = `${path}.${process.pid}.tmp`;

    mkdirSync(dirname(path), { recursive: true });
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(cached, null, 2)}\n`, 'utf8');
      renameSync(temporaryPath, path);
    } finally {
      rmSync(temporaryPath, { force: true });
    }

    return cached;
  }

  load(cwd: string): CachedModuleGraph | undefined {
    const path = this.pathFor(cwd);
    if (!existsSync(path)) return undefined;

    let value: unknown;
    try {
      value = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new Error(
        `Cached module graph is unreadable: ${error instanceof Error ? error.message : error}`,
      );
    }
    if (!isCachedModuleGraph(value)) {
      throw new StaleModuleGraphCacheError(path);
    }
    return value;
  }

  pathFor(cwd: string): string {
    const scopeRoot = findScopeRoot(cwd);
    const key = createHash('sha256').update(scopeRoot).digest('hex').slice(0, 20);
    return join(this.cacheRoot, key, 'graph.json');
  }
}

export function findScopeRoot(cwd: string): string {
  const start = canonicalPath(cwd);
  return findGitRoot(start) ?? start;
}

export function findProjectRoot(modulesRoot: string, fallback: string): string {
  // Keep the modules path and project root in the same filesystem spelling.
  // On macOS, realpath changes /var to /private/var; mixing both makes relative
  // graph paths look external even though they refer to the same directory.
  return findGitRoot(resolve(modulesRoot)) ?? findScopeRoot(fallback);
}

function findGitRoot(start: string): string | undefined {
  let directory = start;
  let previous = '';

  while (directory !== previous) {
    if (existsSync(join(directory, '.git'))) return directory;
    previous = directory;
    directory = dirname(directory);
  }
  return undefined;
}

function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function defaultCacheRoot(): string {
  if (process.env.XDG_CACHE_HOME) {
    return join(process.env.XDG_CACHE_HOME, 'pi-module-graph');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'pi-module-graph');
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, 'pi-module-graph');
  }
  return join(homedir(), '.cache', 'pi-module-graph');
}

function isCachedModuleGraph(value: unknown): value is CachedModuleGraph {
  if (!isRecord(value) || value.cacheVersion !== 2) return false;
  if (
    typeof value.generatedAt !== 'string' ||
    typeof value.scopeRoot !== 'string' ||
    typeof value.projectRoot !== 'string'
  ) {
    return false;
  }
  const graph = value.graph;
  if (
    !isRecord(graph) ||
    graph.schemaVersion !== 2 ||
    typeof graph.modulesRoot !== 'string' ||
    !Array.isArray(graph.tsconfigs) ||
    !Array.isArray(graph.sourceFiles) ||
    !Array.isArray(graph.internalImports) ||
    !Array.isArray(graph.modules) ||
    !Array.isArray(graph.dependencies) ||
    !Array.isArray(graph.unmappedImports) ||
    !Array.isArray(graph.unresolvedImports) ||
    !isRecord(graph.collection)
  ) {
    return false;
  }
  const collection = graph.collection;
  return (
    typeof collection.importsFound === 'number' &&
    typeof collection.importsResolved === 'number' &&
    typeof collection.importsExternal === 'number' &&
    typeof collection.importsUnresolved === 'number' &&
    Array.isArray(collection.skippedDirectories) &&
    (collection.walkMode === 'git' || collection.walkMode === 'disk') &&
    Array.isArray(collection.configFailures) &&
    Array.isArray(collection.parseDiagnosticFiles)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
