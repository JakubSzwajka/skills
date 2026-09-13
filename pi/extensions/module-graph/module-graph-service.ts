import { resolve } from 'node:path';

import { analyzeModules } from './analyzer';
import {
  findProjectRoot,
  findScopeRoot,
  type CachedModuleGraph,
  ModuleGraphStore,
  StaleModuleGraphCacheError,
} from './graph-store';
import { ModuleGraphViewerServer } from './viewer-server';
import { deriveViewGraph } from './viewer/graph-metrics';

export interface ModuleGraphSummary {
  modulesRoot: string;
  projectRoot: string;
  generatedAt: string;
  moduleCount: number;
  dependencyCount: number;
  runtimeCycleCount: number;
  unmappedImportCount: number;
  importsFound: number;
  unresolvedImportCount: number;
  configFailures: Array<{ config: string; reason: string }>;
  parseDiagnosticFiles: string[];
}

export interface ModuleGraphStatus {
  graph?: ModuleGraphSummary;
  running: boolean;
  url?: string;
  staleCache?: boolean;
}

export class ModuleGraphService {
  private current: CachedModuleGraph | undefined;
  private readonly viewer: ModuleGraphViewerServer;

  constructor(private readonly store = new ModuleGraphStore()) {
    this.viewer = new ModuleGraphViewerServer(() => this.current);
  }

  generate(cwd: string, pathArgument: string): ModuleGraphStatus {
    const modulesRoot = resolvePathArgument(pathArgument, cwd);
    const projectRoot = findProjectRoot(modulesRoot, cwd);
    const graph = analyzeModules({ modulesRoot, projectRoot });
    this.current = this.store.save(cwd, projectRoot, graph);
    return this.status(cwd);
  }

  async serve(cwd: string): Promise<ModuleGraphStatus> {
    this.ensureCurrentGraph(cwd);
    await this.viewer.start();
    return this.status(cwd);
  }

  async stop(): Promise<boolean> {
    return this.viewer.stop();
  }

  status(cwd: string): ModuleGraphStatus {
    let staleCache = false;
    try {
      this.ensureCurrentGraph(cwd);
    } catch (error) {
      if (!(error instanceof StaleModuleGraphCacheError)) throw error;
      this.current = undefined;
      staleCache = true;
    }
    const viewer = this.viewer.status();
    return {
      graph: this.current ? summarize(this.current) : undefined,
      running: viewer.running,
      url: viewer.url,
      staleCache: staleCache || undefined,
    };
  }

  private ensureCurrentGraph(cwd: string): void {
    const scopeRoot = findScopeRoot(cwd);
    if (this.current?.scopeRoot === scopeRoot) return;
    this.current = this.store.load(cwd);
  }
}

export function resolvePathArgument(argument: string, cwd: string): string {
  const trimmed = argument.trim();
  if (!trimmed) {
    throw new Error('Usage: /module-graph:generate <path>');
  }

  const unquoted =
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
      ? trimmed.slice(1, -1)
      : trimmed;
  if (!unquoted) throw new Error('Usage: /module-graph:generate <path>');
  return resolve(cwd, unquoted);
}

function summarize(cached: CachedModuleGraph): ModuleGraphSummary {
  const view = deriveViewGraph(cached.graph);
  return {
    modulesRoot: cached.graph.modulesRoot,
    projectRoot: cached.projectRoot,
    generatedAt: cached.generatedAt,
    moduleCount: view.metrics.moduleCount,
    dependencyCount: view.metrics.edgeCount,
    runtimeCycleCount: view.metrics.cycleGroupCount,
    unmappedImportCount: cached.graph.unmappedImports.length,
    importsFound: cached.graph.collection.importsFound,
    unresolvedImportCount: cached.graph.collection.importsUnresolved,
    configFailures: cached.graph.collection.configFailures,
    parseDiagnosticFiles: cached.graph.collection.parseDiagnosticFiles,
  };
}
