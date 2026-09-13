import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { analyzeModules } from '../analyzer';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('analyzeModules', () => {
  it('builds module edges and keeps the file imports behind each edge', () => {
    const project = fixture({
      'modules/alpha/main.ts': [
        "import { beta } from '../beta/runtime.js';",
        "import { type Beta } from '../beta/types.js';",
        "export { gamma } from '../gamma/exported.js';",
        "const lazy = () => import('../gamma/lazy.js');",
        "import { local } from './local.js';",
        'void beta; void lazy; void local;',
      ].join('\n'),
      'modules/alpha/local.ts': 'export const local = true;\n',
      'modules/beta/runtime.ts': 'export const beta = true;\n',
      'modules/beta/types.ts': 'export interface Beta { id: string }\n',
      'modules/gamma/exported.ts': 'export const gamma = true;\n',
      'modules/gamma/lazy.ts': 'export const lazy = true;\n',
    });

    const graph = analyzeModules({
      modulesRoot: join(project, 'modules'),
      projectRoot: project,
    });

    expect(graph.modules.map((module) => module.id)).toEqual(['alpha', 'beta', 'gamma']);
    expect(graph.dependencies.map(({ from, to, kinds }) => ({ from, to, kinds }))).toEqual([
      { from: 'alpha', to: 'beta', kinds: ['static', 'type'] },
      { from: 'alpha', to: 'gamma', kinds: ['re-export', 'dynamic'] },
    ]);
    expect(graph.dependencies[0].imports).toEqual([
      {
        fromFile: 'modules/alpha/main.ts',
        toFile: 'modules/beta/runtime.ts',
        specifier: '../beta/runtime.js',
        kind: 'static',
        line: 1,
      },
      {
        fromFile: 'modules/alpha/main.ts',
        toFile: 'modules/beta/types.ts',
        specifier: '../beta/types.js',
        kind: 'type',
        line: 2,
      },
    ]);
  });

  it('collects nested and root sources plus same-module file imports', () => {
    const project = fixture({
      'scope/root.ts': "import './alpha/nested/deep.js';\n",
      'scope/alpha/main.ts': "import './nested/deep.js';\n",
      'scope/alpha/nested/deep.ts': "import '../helper.js';\n",
      'scope/alpha/helper.ts': 'export const helper = true;\n',
      'scope/beta/main.ts': 'export const beta = true;\n',
    });

    const graph = analyzeModules({
      modulesRoot: join(project, 'scope'),
      projectRoot: project,
    });

    expect(graph.sourceFiles).toEqual([
      'scope/alpha/helper.ts',
      'scope/alpha/main.ts',
      'scope/alpha/nested/deep.ts',
      'scope/beta/main.ts',
      'scope/root.ts',
    ]);
    expect(graph.modules.map(({ id, files }) => ({ id, files }))).toEqual([
      { id: '(root)', files: ['scope/root.ts'] },
      {
        id: 'alpha',
        files: [
          'scope/alpha/helper.ts',
          'scope/alpha/main.ts',
          'scope/alpha/nested/deep.ts',
        ],
      },
      { id: 'beta', files: ['scope/beta/main.ts'] },
    ]);
    expect(
      graph.internalImports.map(({ fromFile, toFile, fromModule, toModule }) => ({
        fromFile,
        toFile,
        fromModule,
        toModule,
      })),
    ).toEqual([
      {
        fromFile: 'scope/alpha/main.ts',
        toFile: 'scope/alpha/nested/deep.ts',
        fromModule: 'alpha',
        toModule: 'alpha',
      },
      {
        fromFile: 'scope/alpha/nested/deep.ts',
        toFile: 'scope/alpha/helper.ts',
        fromModule: 'alpha',
        toModule: 'alpha',
      },
      {
        fromFile: 'scope/root.ts',
        toFile: 'scope/alpha/nested/deep.ts',
        fromModule: '(root)',
        toModule: 'alpha',
      },
    ]);
    expect(graph.dependencies).toEqual([
      {
        from: '(root)',
        to: 'alpha',
        kinds: ['static'],
        imports: [
          {
            fromFile: 'scope/root.ts',
            toFile: 'scope/alpha/nested/deep.ts',
            specifier: './alpha/nested/deep.js',
            kind: 'static',
            line: 1,
          },
        ],
      },
    ]);
  });

  it('collects a root that contains only root-level sources', () => {
    const project = fixture({ 'scope/index.ts': 'export const root = true;\n' });

    const graph = analyzeModules({ modulesRoot: join(project, 'scope'), projectRoot: project });

    expect(graph.sourceFiles).toEqual(['scope/index.ts']);
    expect(graph.modules).toEqual([
      {
        id: '(root)',
        path: 'scope',
        files: ['scope/index.ts'],
        synthetic: true,
      },
    ]);
  });

  it('skips test sources by default and can include them explicitly', () => {
    const project = fixture({
      'modules/alpha/main.ts': 'export const alpha = true;\n',
      'modules/alpha/main.test.ts': "import '../beta/runtime.js';\n",
      'modules/alpha/__tests__/nested.ts': "import '../../beta/runtime.js';\n",
      'modules/beta/runtime.ts': 'export const beta = true;\n',
    });

    const withoutTests = analyzeModules({
      modulesRoot: join(project, 'modules'),
      projectRoot: project,
    });
    const withTests = analyzeModules({
      modulesRoot: join(project, 'modules'),
      projectRoot: project,
      includeTests: true,
    });

    expect(withoutTests.dependencies).toEqual([]);
    expect(withoutTests.modules[0].files).toEqual(['modules/alpha/main.ts']);
    expect(withTests.dependencies).toHaveLength(1);
    expect(withTests.dependencies[0]).toMatchObject({ from: 'alpha', to: 'beta' });
  });

  it('excludes test and fixture trees, declarations, outputs, and dependencies', () => {
    const project = fixture({
      'scope/package.json': JSON.stringify({ name: 'scope-fixture' }),
      'scope/alpha/main.ts': [
        "import 'example-package';",
        "import './fixtures/sample.js';",
        "import '../vendor/tool.js';",
      ].join('\n'),
      'scope/alpha/main.test.ts': 'export const test = true;\n',
      'scope/alpha/main.spec.tsx': 'export const spec = true;\n',
      'scope/alpha/tests/helper.ts': 'export const testHelper = true;\n',
      'scope/alpha/fixtures/sample.ts': 'export const fixture = true;\n',
      'scope/alpha/types.d.ts': 'export interface Hidden {}\n',
      'scope/dist/generated.ts': 'export const generated = true;\n',
      'scope/vendor/tool.ts': 'export const tool = true;\n',
      'scope/node_modules/example-package/package.json': JSON.stringify({ main: 'index.js' }),
      'scope/node_modules/example-package/index.js': 'export const dependency = true;\n',
    });

    const graph = analyzeModules({ modulesRoot: join(project, 'scope'), projectRoot: project });

    expect(graph.sourceFiles).toEqual(['scope/alpha/main.ts']);
    expect(graph.internalImports).toEqual([]);
    expect(graph.unmappedImports).toEqual([]);
  });

  it('respects Git ignore rules within the selected root', () => {
    const project = fixture({
      '.gitignore': ['scope/ignored.ts', 'scope/generated/'].join('\n'),
      'scope/visible.ts': 'export const visible = true;\n',
      'scope/ignored.ts': 'export const ignored = true;\n',
      'scope/generated/output.ts': 'export const generated = true;\n',
      'scope/alpha/main.ts': 'export const alpha = true;\n',
    });
    execFileSync('git', ['init', '-q'], { cwd: project });
    execFileSync('git', ['add', '--', '.'], { cwd: project });

    const graph = analyzeModules({ modulesRoot: join(project, 'scope'), projectRoot: project });

    expect(graph.sourceFiles).toEqual(['scope/alpha/main.ts', 'scope/visible.ts']);
  });

  it('reports resolved files outside the hard root without collecting or crawling them', () => {
    const project = fixture({
      'shared.ts': "import './outside-only.js';\nexport const shared = true;\n",
      'outside-only.ts': 'export const outside = true;\n',
      'node_modules/example-package/package.json': JSON.stringify({ main: 'index.js' }),
      'node_modules/example-package/index.js': 'export const dependency = true;\n',
      'modules/alpha/main.ts': [
        "import { shared } from '../../shared.js';",
        "import 'example-package';",
        "import './missing.js';",
        'void shared;',
      ].join('\n'),
      'modules/beta/runtime.ts': 'export const beta = true;\n',
    });

    const graph = analyzeModules({
      modulesRoot: join(project, 'modules'),
      projectRoot: project,
    });

    expect(graph.unmappedImports).toEqual([
      {
        fromModule: 'alpha',
        fromFile: 'modules/alpha/main.ts',
        toFile: 'shared.ts',
        specifier: '../../shared.js',
        kind: 'static',
        line: 1,
      },
    ]);
    expect(graph.sourceFiles).toEqual([
      'modules/alpha/main.ts',
      'modules/beta/runtime.ts',
    ]);
    expect(graph.internalImports).toEqual([]);
    expect(graph.unresolvedImports).toEqual([
      {
        fromModule: 'alpha',
        fromFile: 'modules/alpha/main.ts',
        specifier: './missing.js',
        kind: 'static',
        line: 3,
        classification: 'relative',
      },
    ]);
    expect(graph.collection).toMatchObject({
      importsFound: 3,
      importsResolved: 1,
      importsExternal: 1,
      importsUnresolved: 1,
    });
  });

  it('uses each package local paths aliases when analyzing a monorepo root', () => {
    const project = fixture({
      'packages/app/tsconfig.json': JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          baseUrl: '.',
          paths: { '@shared/*': ['../shared/src/*'] },
        },
      }),
      'packages/app/src/main.ts': "import { shared } from '@shared/main';\nvoid shared;\n",
      'packages/shared/tsconfig.json': JSON.stringify({
        compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' },
      }),
      'packages/shared/src/main.ts': 'export const shared = true;\n',
    });

    const graph = analyzeModules({ modulesRoot: join(project, 'packages'), projectRoot: project });

    expect(graph.dependencies.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: 'app', to: 'shared' },
    ]);
    expect(graph.tsconfigs).toEqual([
      'packages/app/tsconfig.json',
      'packages/shared/tsconfig.json',
    ]);
    expectAccounting(graph.collection);
  });

  it('attributes a package declaration target to its collected source entry point', () => {
    const project = fixture({
      'packages/app/tsconfig.json': JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          baseUrl: '.',
          paths: { '@workspace/lib': ['../lib/dist/index.d.ts'] },
        },
      }),
      'packages/app/src/main.ts': "import { value } from '@workspace/lib';\nvoid value;\n",
      'packages/lib/package.json': JSON.stringify({
        name: '@workspace/lib',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            default: './dist/index.js',
          },
        },
      }),
      'packages/lib/tsconfig.json': JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          rootDir: 'src',
          outDir: 'dist',
        },
      }),
      'packages/lib/src/index.ts': 'export const value = true;\n',
      'packages/lib/dist/index.d.ts': 'export declare const value = true;\n',
    });

    const graph = analyzeModules({ modulesRoot: join(project, 'packages'), projectRoot: project });

    expect(graph.dependencies.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: 'app', to: 'lib' },
    ]);
    expect(graph.internalImports).toMatchObject([
      {
        fromFile: 'packages/app/src/main.ts',
        toFile: 'packages/lib/src/index.ts',
        specifier: '@workspace/lib',
      },
    ]);
    expect(graph.unresolvedImports).toEqual([]);
    expectAccounting(graph.collection);
  });

  it('merges aliases from one level of solution-style config references', () => {
    const project = fixture({
      'scope/tsconfig.json': JSON.stringify({
        files: [],
        references: [{ path: './config/tsconfig.alias.json' }],
      }),
      'scope/config/tsconfig.alias.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@solution/*': ['../beta/*'] },
        },
      }),
      'scope/alpha/main.ts': "import { beta } from '@solution/main';\nvoid beta;\n",
      'scope/beta/main.ts': 'export const beta = true;\n',
    });

    const graph = analyzeModules({ modulesRoot: join(project, 'scope'), projectRoot: project });

    expect(graph.dependencies.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: 'alpha', to: 'beta' },
    ]);
    expect(graph.tsconfigs).toEqual([
      'scope/config/tsconfig.alias.json',
      'scope/tsconfig.json',
    ]);
    expectAccounting(graph.collection);
  });

  it('uses full referenced project options when that project contains the source file', () => {
    const project = fixture({
      'scope/tsconfig.json': JSON.stringify({
        files: [],
        references: [{ path: './tsconfig.app.json' }],
        compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
      }),
      'scope/tsconfig.app.json': JSON.stringify({
        compilerOptions: {
          composite: true,
          module: 'ESNext',
          moduleResolution: 'Bundler',
          resolveJsonModule: true,
          baseUrl: '.',
          paths: { '@/*': ['./src/*'] },
        },
        include: ['src'],
      }),
      'scope/src/alpha/main.ts': "import data from '@/mock/data.json';\nvoid data;\n",
      'scope/src/mock/data.json': '{"ok":true}\n',
    });

    const graph = analyzeModules({
      modulesRoot: join(project, 'scope/src'),
      projectRoot: join(project, 'scope'),
    });

    expect(graph.unresolvedImports).toEqual([]);
    expect(graph.collection).toMatchObject({
      importsFound: 1,
      importsResolved: 1,
      importsExternal: 0,
      importsUnresolved: 0,
    });
    expect(graph.tsconfigs).toEqual(['tsconfig.app.json', 'tsconfig.json']);
    expectAccounting(graph.collection);
  });

  it('classifies unresolved imports against nearest and referenced paths', () => {
    const project = fixture({
      'scope/tsconfig.json': JSON.stringify({
        files: [],
        references: [{ path: './tsconfig.app.json' }],
        compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
      }),
      'scope/tsconfig.app.json': JSON.stringify({
        compilerOptions: { composite: true, module: 'ESNext', moduleResolution: 'Bundler' },
        include: ['src'],
      }),
      'scope/src/alpha/main.ts': "import '@/missing';\n",
    });

    const graph = analyzeModules({
      modulesRoot: join(project, 'scope/src'),
      projectRoot: join(project, 'scope'),
    });

    expect(graph.unresolvedImports).toMatchObject([
      { specifier: '@/missing', classification: 'alias' },
    ]);
    expect(graph.collection.importsExternal).toBe(0);
    expectAccounting(graph.collection);
  });

  it('falls back from unusable configs and reports every failure', () => {
    const project = fixture({
      'packages/unknown/tsconfig.json': JSON.stringify({ compilerOptions: { madeUpOption: true } }),
      'packages/unknown/main.ts': "import 'external';\n",
      'packages/enum/tsconfig.json': JSON.stringify({ compilerOptions: { module: 'NotAModule' } }),
      'packages/enum/main.ts': "import 'external';\n",
      'packages/extends/tsconfig.json': JSON.stringify({ extends: '@tsconfig/not-installed' }),
      'packages/extends/main.ts': "import 'external';\n",
      'packages/missing-ref/tsconfig.json': JSON.stringify({ references: [{ path: './missing' }] }),
      'packages/missing-ref/main.ts': "import 'external';\n",
      'packages/bad-ref/tsconfig.json': JSON.stringify({ references: [{ path: './referenced.json' }] }),
      'packages/bad-ref/referenced.json': '{ invalid json',
      'packages/bad-ref/main.ts': "import 'external';\n",
    });

    const graph = analyzeModules({ modulesRoot: join(project, 'packages'), projectRoot: project });

    expect(graph.sourceFiles).toHaveLength(5);
    expect(graph.collection.configFailures.map((failure) => failure.config)).toEqual([
      'packages/bad-ref/referenced.json',
      'packages/enum/tsconfig.json',
      'packages/extends/tsconfig.json',
      'packages/missing-ref/missing/tsconfig.json',
      'packages/unknown/tsconfig.json',
    ]);
    expect(graph.collection.configFailures.every((failure) => failure.reason.length > 0)).toBe(true);
    expectAccounting(graph.collection);
  });

  it('does not use a TypeScript config above projectRoot', () => {
    const project = fixture({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@outside/*': ['./shared/*'] } },
      }),
      'repo/scope/alpha/main.ts': "import '@outside/missing';\n",
    });

    const graph = analyzeModules({
      modulesRoot: join(project, 'repo/scope'),
      projectRoot: join(project, 'repo'),
    });

    expect(graph.tsconfigs).toEqual([]);
    expect(graph.unresolvedImports).toEqual([]);
    expect(graph.collection.importsExternal).toBe(1);
  });

  it('records source files whose parser produced diagnostics', () => {
    const project = fixture({
      'scope/alpha/main.ts': "import '../beta/main.js';\nfunction broken( {\nimport '../beta/other.js';\n",
      'scope/beta/main.ts': 'export const beta = true;\n',
      'scope/beta/other.ts': 'export const other = true;\n',
    });

    const graph = analyzeModules({ modulesRoot: join(project, 'scope'), projectRoot: project });

    expect(graph.collection.parseDiagnosticFiles).toEqual(['scope/alpha/main.ts']);
    expectAccounting(graph.collection);
  });

  it('records an unresolvable paths alias as an alias hole', () => {
    const project = fixture({
      'scope/tsconfig.json': JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          baseUrl: '.',
          paths: { '@/*': ['src/*'] },
        },
      }),
      'scope/alpha/main.ts': "import '@/missing';\n",
    });

    const graph = analyzeModules({ modulesRoot: join(project, 'scope'), projectRoot: project });

    expect(graph.unresolvedImports).toEqual([
      {
        fromModule: 'alpha',
        fromFile: 'scope/alpha/main.ts',
        specifier: '@/missing',
        kind: 'static',
        line: 1,
        classification: 'alias',
      },
    ]);
    expect(graph.collection).toMatchObject({
      importsFound: 1,
      importsResolved: 0,
      importsExternal: 0,
      importsUnresolved: 1,
    });
    expectAccounting(graph.collection);
  });

  it('counts an unresolvable bare specifier as external rather than a hole', () => {
    const project = fixture({ 'scope/alpha/main.ts': "import 'not-installed';\n" });

    const graph = analyzeModules({ modulesRoot: join(project, 'scope'), projectRoot: project });

    expect(graph.unresolvedImports).toEqual([]);
    expect(graph.collection).toMatchObject({
      importsFound: 1,
      importsResolved: 0,
      importsExternal: 1,
      importsUnresolved: 0,
    });
    expectAccounting(graph.collection);
  });

  it('records non-literal import and require calls as dynamic-expression holes', () => {
    const project = fixture({
      'scope/alpha/main.ts': [
        "const modulePath = './lazy.js';",
        'void import(modulePath);',
        'void require(getModulePath());',
      ].join('\n'),
    });

    const graph = analyzeModules({ modulesRoot: join(project, 'scope'), projectRoot: project });

    expect(graph.unresolvedImports).toEqual([
      {
        fromModule: 'alpha',
        fromFile: 'scope/alpha/main.ts',
        specifier: 'modulePath',
        kind: 'dynamic',
        line: 2,
        classification: 'dynamic-expression',
      },
      {
        fromModule: 'alpha',
        fromFile: 'scope/alpha/main.ts',
        specifier: 'getModulePath()',
        kind: 'require',
        line: 3,
        classification: 'dynamic-expression',
      },
    ]);
    expectAccounting(graph.collection);
  });

  it('produces the same graph through a symlinked project parent', () => {
    const project = fixture({
      'scope/alpha/main.ts': "import '../beta/main.js';\n",
      'scope/beta/main.ts': 'export const beta = true;\n',
    });
    const linkParent = mkdtempSync(join(tmpdir(), 'module-dependencies-link-'));
    temporaryDirectories.push(linkParent);
    const linkedProject = join(linkParent, 'project');
    symlinkSync(project, linkedProject, 'dir');

    const realGraph = analyzeModules({
      modulesRoot: join(project, 'scope'),
      projectRoot: project,
    });
    const linkedGraph = analyzeModules({
      modulesRoot: join(linkedProject, 'scope'),
      projectRoot: linkedProject,
    });

    expect(linkedGraph).toEqual(realGraph);
    expectAccounting(linkedGraph.collection);
  });

  it('accounts for every resolved, external, and unresolved import', () => {
    const project = fixture({
      'scope/tsconfig.json': JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          baseUrl: '.',
          paths: { '@/*': ['src/*'] },
        },
      }),
      'scope/alpha/main.ts': [
        "import '../beta/main.js';",
        "import './missing.js';",
        "import 'external-package';",
        "import '@/missing';",
        'void import(getModulePath());',
      ].join('\n'),
      'scope/beta/main.ts': 'export const beta = true;\n',
    });

    const graph = analyzeModules({ modulesRoot: join(project, 'scope'), projectRoot: project });

    expect(graph.collection).toEqual({
      importsFound: 5,
      importsResolved: 1,
      importsExternal: 1,
      importsUnresolved: 3,
      skippedDirectories: [],
      walkMode: 'disk',
      configFailures: [],
      parseDiagnosticFiles: [],
    });
    expectAccounting(graph.collection);
  });

  it('returns byte-stable ordering for the same files', () => {
    const project = fixture({
      'modules/zeta/z.ts': "import '../alpha/a.js';\n",
      'modules/alpha/a.ts': 'export const a = true;\n',
    });

    const options = { modulesRoot: join(project, 'modules'), projectRoot: project };
    expect(JSON.stringify(analyzeModules(options))).toBe(JSON.stringify(analyzeModules(options)));
  });

  it('fails instead of writing an empty graph', () => {
    const project = fixture({ 'modules/empty/README.md': 'No source yet.\n' });

    expect(() =>
      analyzeModules({ modulesRoot: join(project, 'modules'), projectRoot: project }),
    ).toThrow('no production source files');
  });
});

function fixture(files: Record<string, string>): string {
  const project = mkdtempSync(join(tmpdir(), 'module-dependencies-'));
  temporaryDirectories.push(project);
  write(
    project,
    'tsconfig.json',
    `${JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' } })}\n`,
  );
  for (const [path, content] of Object.entries(files)) write(project, path, content);
  return project;
}

function write(project: string, path: string, content: string): void {
  const absolute = join(project, path);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

function expectAccounting(collection: {
  importsFound: number;
  importsResolved: number;
  importsExternal: number;
  importsUnresolved: number;
}): void {
  expect(collection.importsFound).toBe(
    collection.importsResolved + collection.importsExternal + collection.importsUnresolved,
  );
}
