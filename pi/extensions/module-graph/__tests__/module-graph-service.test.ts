import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { ModuleGraphStore } from '../graph-store';
import { formatGenerated } from '../index';
import { ModuleGraphService, resolvePathArgument } from '../module-graph-service';

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (prefix: string): string => {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ModuleGraphStore', () => {
  it('rejects a realistic cache version 1 record', () => {
    const project = createTemporaryDirectory('pi-module-graph-stale-project-');
    const store = new ModuleGraphStore(createTemporaryDirectory('pi-module-graph-cache-'));
    writeLegacyCachedGraph(project, store);

    expect(() => store.load(project)).toThrow('Cached module graph has an unsupported format');
  });
});

describe('ModuleGraphService', () => {
  it('generates without starting a server', () => {
    const { project, service } = fixture();

    const status = service.generate(project, 'src/modules');

    expect(status).toMatchObject({
      running: false,
      graph: {
        modulesRoot: 'src/modules',
        moduleCount: 2,
        dependencyCount: 1,
        runtimeCycleCount: 0,
      },
    });
  });

  it('maps analyzer collection numbers into command output at and above the warning threshold', () => {
    const atThreshold = fixture();
    write(
      atThreshold.project,
      'src/modules/alpha/main.ts',
      `${[
        ...Array.from({ length: 19 }, () => "import '../beta/main.js';"),
        "import './missing.js';",
      ].join('\n')}\n`,
    );

    const lowOutput = formatGenerated(atThreshold.service.generate(atThreshold.project, 'src/modules'));
    expect(lowOutput).toContain('Unresolved imports: 1');
    expect(lowOutput).not.toContain('Warning: graph is incomplete');

    const aboveThreshold = fixture();
    write(aboveThreshold.project, 'src/modules/alpha/main.ts', "import './missing.js';\n");
    const highOutput = formatGenerated(
      aboveThreshold.service.generate(aboveThreshold.project, 'src/modules'),
    );
    expect(highOutput).toContain('Unresolved imports: 1');
    expect(highOutput).toContain('Warning: graph is incomplete; 1 of 1 imports (100.0%)');
  });

  it('generates a collection containing only root-level source files', () => {
    const project = createTemporaryDirectory('pi-module-graph-root-files-');
    const store = new ModuleGraphStore(createTemporaryDirectory('pi-module-graph-cache-'));
    mkdirSync(join(project, '.git'));
    write(
      project,
      'tsconfig.json',
      `${JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' } })}\n`,
    );
    write(project, 'scope/index.ts', 'export const root = true;\n');
    const service = new ModuleGraphService(store);

    const status = service.generate(project, 'scope');

    expect(status.graph).toMatchObject({ modulesRoot: 'scope', moduleCount: 1, dependencyCount: 0 });
    expect(store.load(project)?.graph.sourceFiles).toEqual(['scope/index.ts']);
  });

  it('starts lazily, reuses its URL, and serves the generated graph', async () => {
    const { project, service } = fixture();
    service.generate(project, 'src/modules');

    const first = await service.serve(project);
    const second = await service.serve(project);

    expect(first.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(second.url).toBe(first.url);
    const response = await fetch(`${first.url}/graph.json`);
    const graph = (await response.json()) as { modules: unknown[]; dependencies: unknown[] };
    expect(response.status).toBe(200);
    expect(graph.modules).toHaveLength(2);
    expect(graph.dependencies).toHaveLength(1);

    expect(await service.stop()).toBe(true);
    expect(await service.stop()).toBe(false);
  });

  it('preserves the cached graph after stop and across service instances', async () => {
    const { project, store, service } = fixture();
    service.generate(project, 'src/modules');
    await service.serve(project);
    await service.stop();

    const replacement = new ModuleGraphService(store);
    const status = await replacement.serve(project);

    expect(status.graph?.modulesRoot).toBe('src/modules');
    expect(status.running).toBe(true);
    await replacement.stop();
  });

  it('refuses to serve before a graph is generated', async () => {
    const project = createTemporaryDirectory('pi-module-graph-empty-');
    const store = new ModuleGraphStore(createTemporaryDirectory('pi-module-graph-cache-'));
    const service = new ModuleGraphService(store);

    await expect(service.serve(project)).rejects.toThrow(
      'Run /module-graph:generate <path> first',
    );
  });

  it('reports a stale cache as an empty status but still refuses to serve it', async () => {
    const project = createTemporaryDirectory('pi-module-graph-stale-project-');
    const store = new ModuleGraphStore(createTemporaryDirectory('pi-module-graph-cache-'));
    writeLegacyCachedGraph(project, store);
    const service = new ModuleGraphService(store);

    expect(service.status(project)).toEqual({ running: false, staleCache: true });
    await expect(service.serve(project)).rejects.toThrow(
      'Cached module graph has an unsupported format',
    );
  });
});

describe('resolvePathArgument', () => {
  it('accepts unquoted and quoted paths', () => {
    expect(resolvePathArgument('src/modules', '/repo')).toBe('/repo/src/modules');
    expect(resolvePathArgument('"src/modules with spaces"', '/repo')).toBe(
      '/repo/src/modules with spaces',
    );
  });

  it('requires a path', () => {
    expect(() => resolvePathArgument('  ', '/repo')).toThrow(
      'Usage: /module-graph:generate <path>',
    );
  });
});

function fixture(): {
  project: string;
  store: ModuleGraphStore;
  service: ModuleGraphService;
} {
  const project = createTemporaryDirectory('pi-module-graph-project-');
  const cache = createTemporaryDirectory('pi-module-graph-cache-');
  mkdirSync(join(project, '.git'));
  write(
    project,
    'tsconfig.json',
    `${JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' } })}\n`,
  );
  write(project, 'src/modules/alpha/main.ts', "import '../beta/main.js';\n");
  write(project, 'src/modules/beta/main.ts', 'export const beta = true;\n');
  const store = new ModuleGraphStore(storePath(cache), () => new Date('2026-08-29T12:00:00Z'));
  return { project, store, service: new ModuleGraphService(store) };
}

function storePath(cache: string): string {
  return join(cache, 'module-graph');
}

function writeCachedGraph(
  project: string,
  store: ModuleGraphStore,
  loadBearingFields: { sourceFiles?: string[]; internalImports?: unknown[] },
  versions: { cacheVersion?: number; schemaVersion?: number } = {},
): void {
  const path = store.pathFor(project);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({
      cacheVersion: versions.cacheVersion ?? 2,
      generatedAt: '2026-08-29T12:00:00.000Z',
      scopeRoot: project,
      projectRoot: project,
      graph: {
        schemaVersion: versions.schemaVersion ?? 2,
        modulesRoot: 'src/modules',
        tsconfigs: [],
        sourceFiles: [],
        internalImports: [],
        modules: [],
        dependencies: [],
        unmappedImports: [],
        unresolvedImports: [],
        collection: {
          importsFound: 0,
          importsResolved: 0,
          importsExternal: 0,
          importsUnresolved: 0,
          skippedDirectories: [],
          walkMode: 'disk',
          configFailures: [],
          parseDiagnosticFiles: [],
        },
        ...loadBearingFields,
      },
    })}\n`,
    'utf8',
  );
}

function writeLegacyCachedGraph(project: string, store: ModuleGraphStore): void {
  const path = store.pathFor(project);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({
      cacheVersion: 1,
      generatedAt: '2026-08-29T12:00:00.000Z',
      scopeRoot: project,
      projectRoot: project,
      graph: {
        schemaVersion: 1,
        modulesRoot: 'src/modules',
        tsconfig: 'tsconfig.json',
        sourceFiles: [],
        modules: [],
        dependencies: [],
        unmappedImports: [],
        unresolvedRelativeImports: [],
      },
    })}\n`,
    'utf8',
  );
}

function write(project: string, path: string, content: string): void {
  const absolute = join(project, path);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}
