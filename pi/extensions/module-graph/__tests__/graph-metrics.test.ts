import { describe, expect, it } from 'vitest';

import type { ImportKind, InternalImport, ModuleGraph } from '../analyzer';
import { deriveDirectoryScopeGraph, deriveViewGraph } from '../viewer/graph-metrics';

describe('deriveDirectoryScopeGraph', () => {
  it('shows only immediate child directories and direct files at selected root', () => {
    const graph = hierarchyFixture(
      [
        'scope/modules/admin/routes/a.ts',
        'scope/modules/admin/index.ts',
        'scope/modules/common/http.ts',
        'scope/modules/direct.ts',
      ],
      [],
      'scope/modules',
    );

    const view = deriveDirectoryScopeGraph(graph, 'scope/modules');

    expect(view.nodes.map((node) => node.label)).toEqual(['admin/', 'common/', 'direct.ts']);
    expect(view.nodes.map((node) => node.path)).not.toContain('scope/modules/admin/routes/a.ts');
    expect(view.nodes.map((node) => node.path)).not.toContain('scope/modules/admin/index.ts');
    expect(view.nodes[0]).toMatchObject({
      kind: 'directory',
      path: 'scope/modules/admin',
      expandable: true,
      files: ['scope/modules/admin/index.ts', 'scope/modules/admin/routes/a.ts'],
    });
    expect(view.nodes[2]).toMatchObject({
      kind: 'file',
      path: 'scope/modules/direct.ts',
      expandable: false,
      files: ['scope/modules/direct.ts'],
    });
  });

  it('shows next-level contents and complete navigation data at arbitrary depth', () => {
    const graph = hierarchyFixture(
      [
        'scope/modules/admin/index.ts',
        'scope/modules/admin/routes/a.ts',
        'scope/modules/admin/routes/nested/b.ts',
      ],
      [],
      'scope/modules',
    );

    const admin = deriveDirectoryScopeGraph(graph, 'scope/modules/admin');
    const routes = deriveDirectoryScopeGraph(graph, 'scope/modules/admin/routes');

    expect(admin.nodes.map((node) => node.label)).toEqual(['index.ts', 'routes/']);
    expect(admin.parentPath).toBe('scope/modules');
    expect(admin.breadcrumbs).toEqual([
      { label: 'root', path: 'scope/modules' },
      { label: 'admin', path: 'scope/modules/admin' },
    ]);
    expect(routes.nodes.map((node) => node.label)).toEqual(['a.ts', 'nested/']);
    expect(routes.parentPath).toBe('scope/modules/admin');
    expect(routes.scopeSegments).toEqual(['admin', 'routes']);
    expect(routes.breadcrumbs).toEqual([
      { label: 'root', path: 'scope/modules' },
      { label: 'admin', path: 'scope/modules/admin' },
      { label: 'routes', path: 'scope/modules/admin/routes' },
    ]);
  });

  it('maps endpoints to immediate children, aggregates evidence, and hides same-child imports', () => {
    const graph = hierarchyFixture(
      [
        'modules/admin/index.ts',
        'modules/admin/routes/a.ts',
        'modules/admin/routes/b.ts',
        'modules/common/http.ts',
      ],
      [
        ['modules/admin/routes/a.ts', 'modules/admin/index.ts', 'type', 3],
        ['modules/admin/routes/b.ts', 'modules/admin/index.ts', 'static', 1],
        ['modules/admin/routes/a.ts', 'modules/admin/routes/b.ts', 'static', 2],
        ['modules/admin/index.ts', 'modules/common/http.ts', 'dynamic', 4],
      ],
      'modules',
    );

    const root = deriveDirectoryScopeGraph(graph);
    const admin = deriveDirectoryScopeGraph(graph, 'modules/admin');
    const routes = deriveDirectoryScopeGraph(graph, 'modules/admin/routes');

    expect(root.links).toHaveLength(1);
    expect(root.links[0]).toMatchObject({ weight: 1, kinds: ['dynamic'], boundary: false });
    expect(nodePath(root, root.links[0].source)).toBe('modules/admin');
    expect(nodePath(root, root.links[0].target)).toBe('modules/common');

    expect(admin.links.filter((link) => !link.boundary)).toHaveLength(1);
    expect(admin.links.find((link) => !link.boundary)).toMatchObject({
      weight: 2,
      kinds: ['static', 'type'],
      runtime: true,
    });
    expect(
      admin.links.find((link) => !link.boundary)?.imports.map((item) => [item.line, item.kind]),
    ).toEqual([
      [3, 'type'],
      [1, 'static'],
    ]);
    expect(routes.links.some((link) => !link.boundary)).toBe(true);
  });

  it('groups incoming and outgoing boundary endpoints by nearest relative branch', () => {
    const graph = hierarchyFixture(
      [
        '/modules/admin/a.ts',
        '/modules/common/http.ts',
        '/modules/common/util.ts',
        '/modules/index.ts',
        '/storage/index.ts',
      ],
      [
        ['/modules/admin/a.ts', '/modules/common/http.ts', 'static'],
        ['/modules/admin/a.ts', '/modules/common/util.ts', 'type'],
        ['/modules/common/http.ts', '/modules/admin/a.ts', 'type'],
        ['/modules/admin/a.ts', '/storage/index.ts', 'dynamic'],
        ['/modules/index.ts', '/modules/admin/a.ts', 'static'],
      ],
      '/',
    );

    const view = deriveDirectoryScopeGraph(graph, '/modules/admin');
    const boundaries = view.nodes.filter((node) => node.kind === 'boundary');

    expect(boundaries.map((node) => node.label)).toEqual([
      '../../storage',
      '../common',
      '../index.ts',
    ]);
    expect(boundaries.every((node) => !node.expandable && node.files.length === 0)).toBe(true);
    expect(
      view.links.map((link) => `${nodeLabel(view, link.source)}->${nodeLabel(view, link.target)}`),
    ).toEqual([
      '../index.ts->a.ts',
      '../common->a.ts',
      'a.ts->../../storage',
      'a.ts->../common',
    ]);
    expect(view.links.every((link) => link.boundary && !link.cyclic)).toBe(true);
    expect(
      view.links.find(
        (link) => nodeLabel(view, link.source) === 'a.ts' && nodeLabel(view, link.target) === '../common',
      ),
    ).toMatchObject({ weight: 2, kinds: ['static', 'type'], runtime: true });
  });

  it('shows root direct files and emits no root boundary stubs for bounded imports', () => {
    const graph = hierarchyFixture(
      ['modules/admin/a.ts', 'modules/common/http.ts', 'modules/index.ts'],
      [
        ['modules/index.ts', 'modules/admin/a.ts', 'static'],
        ['modules/common/http.ts', 'modules/index.ts', 'type'],
      ],
      'modules',
    );

    const view = deriveDirectoryScopeGraph(graph);

    expect(view.nodes.map((node) => node.label)).toEqual(['admin/', 'common/', 'index.ts']);
    expect(view.nodes.some((node) => node.kind === 'boundary')).toBe(false);
    expect(view.links.every((link) => !link.boundary)).toBe(true);
    expect(view.parentPath).toBeNull();
    expect(view.metrics).toMatchObject({ itemCount: 3, edgeCount: 2, boundaryCount: 0 });
  });

  it('detects runtime cycles on aggregate real edges while excluding type-only and boundary links', () => {
    const graph = hierarchyFixture(
      ['modules/a/one.ts', 'modules/b/two.ts', 'modules/c/three.ts'],
      [
        ['modules/a/one.ts', 'modules/b/two.ts', 'static'],
        ['modules/b/two.ts', 'modules/a/one.ts', 'dynamic'],
        ['modules/b/two.ts', 'modules/c/three.ts', 'type'],
        ['modules/c/three.ts', 'modules/b/two.ts', 'static'],
      ],
      'modules',
    );

    const root = deriveDirectoryScopeGraph(graph);
    const a = deriveDirectoryScopeGraph(graph, 'modules/a');

    expect(root.cycles).toHaveLength(1);
    expect(root.cycles[0].map((id) => nodeLabel(root, id))).toEqual(['a/', 'b/']);
    expect(root.links.filter((link) => link.cyclic)).toHaveLength(2);
    expect(root.nodes.filter((node) => node.cyclic).map((node) => node.label)).toEqual(['a/', 'b/']);
    expect(a.links.every((link) => link.boundary && !link.cyclic)).toBe(true);
    expect(a.nodes.filter((node) => node.kind === 'boundary').every((node) => !node.cyclic)).toBe(
      true,
    );
  });

  it('uses collision-proof node and link ids for adversarial path text', () => {
    const graph = hierarchyFixture(
      [
        'scope/admin/scope:boundary:9:..common.ts',
        'scope/admin/nested/a.ts',
        'scope/common/b.ts',
      ],
      [
        ['scope/admin/scope:boundary:9:..common.ts', 'scope/common/b.ts', 'static'],
        ['scope/common/b.ts', 'scope/admin/nested/a.ts', 'static'],
      ],
      'scope',
    );

    const view = deriveDirectoryScopeGraph(graph, 'scope/admin');
    const nodeIds = view.nodes.map((node) => node.id);
    const linkIds = view.links.map((link) => link.id);

    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    expect(new Set(linkIds).size).toBe(linkIds.length);
    expect(nodeIds.every((id) => !linkIds.includes(id))).toBe(true);
    expect(view.nodes.find((node) => node.kind === 'boundary')?.id).toContain('scope:boundary:');
  });

  it('is deterministic for shuffled files and import evidence', () => {
    const files = [
      'modules/z/b.ts',
      'modules/a/one.ts',
      'modules/z/a.ts',
      'modules/direct.ts',
    ];
    const edges: HierarchyEdge[] = [
      ['modules/z/b.ts', 'modules/a/one.ts', 'type', 7],
      ['modules/z/a.ts', 'modules/a/one.ts', 'static', 2],
      ['modules/direct.ts', 'modules/z/a.ts', 'dynamic', 3],
    ];

    const sorted = deriveDirectoryScopeGraph(hierarchyFixture(files, edges, 'modules'));
    const shuffled = deriveDirectoryScopeGraph(
      hierarchyFixture([...files].reverse(), [...edges].reverse(), 'modules'),
    );

    expect(shuffled).toEqual(sorted);
    expect(sorted.nodes.map((node) => node.label)).toEqual(['a/', 'direct.ts', 'z/']);
    expect(sorted.links.map((link) => link.imports.map((item) => item.line))).toEqual([
      [2, 7],
      [3],
    ]);
  });

  it('normalizes dot roots, relative paths with backslashes, and absolute paths', () => {
    const dot = deriveDirectoryScopeGraph(
      hierarchyFixture(['admin\\routes\\a.ts', 'direct.ts'], [], '.'),
    );
    const relative = deriveDirectoryScopeGraph(
      hierarchyFixture(['src\\modules\\admin\\a.ts', 'src\\modules\\direct.ts'], [], 'src\\modules'),
    );
    const absolute = deriveDirectoryScopeGraph(
      hierarchyFixture(['/repo/modules/admin/a.ts', '/repo/modules/direct.ts'], [], '/repo/modules'),
    );

    expect(dot.nodes.map((node) => [node.label, node.path])).toEqual([
      ['admin/', 'admin'],
      ['direct.ts', 'direct.ts'],
    ]);
    expect(relative.nodes.map((node) => [node.label, node.path])).toEqual([
      ['admin/', 'src/modules/admin'],
      ['direct.ts', 'src/modules/direct.ts'],
    ]);
    expect(absolute.nodes.map((node) => [node.label, node.path])).toEqual([
      ['admin/', '/repo/modules/admin'],
      ['direct.ts', '/repo/modules/direct.ts'],
    ]);
  });

  it('rejects outside, unknown, file, mixed-coordinate, escaping, and uncollected endpoints', () => {
    const graph = hierarchyFixture(['modules/admin/a.ts'], [], 'modules');
    expect(() => deriveDirectoryScopeGraph(graph, 'other')).toThrow('outside modules root');
    expect(() => deriveDirectoryScopeGraph(graph, 'modules/missing')).toThrow('Unknown directory');
    expect(() => deriveDirectoryScopeGraph(graph, 'modules/admin/a.ts')).toThrow('source file');
    expect(() =>
      deriveDirectoryScopeGraph(hierarchyFixture(['/modules/admin/a.ts'], [], 'modules')),
    ).toThrow('different absolute/relative coordinates');
    expect(() =>
      deriveDirectoryScopeGraph(hierarchyFixture(['../escape.ts'], [], 'modules')),
    ).toThrow('escapes its coordinate root');

    const malformed = hierarchyFixture(['modules/admin/a.ts'], [], 'modules');
    malformed.internalImports = [internal('modules/admin/a.ts', 'modules/ghost.ts', 'static')];
    expect(() => deriveDirectoryScopeGraph(malformed)).toThrow(
      'Internal import endpoint was not collected: modules/ghost.ts',
    );
  });

  it('handles empty and single-item roots with Items metrics', () => {
    const empty = deriveDirectoryScopeGraph(hierarchyFixture([], [], 'modules'));
    const single = deriveDirectoryScopeGraph(
      hierarchyFixture(['modules/only.ts'], [], 'modules'),
    );

    expect(empty.nodes).toEqual([]);
    expect(empty.links).toEqual([]);
    expect(empty.metrics).toEqual({
      itemCount: 0,
      edgeCount: 0,
      runtimeEdgeCount: 0,
      typeOnlyEdgeCount: 0,
      boundaryCount: 0,
      cycleGroupCount: 0,
    });
    expect(single.nodes).toHaveLength(1);
    expect(single.nodes[0]).toMatchObject({ label: 'only.ts', degree: 0, cyclic: false });
    expect(single.metrics.itemCount).toBe(1);
  });

  it('ignores unmapped and unresolved imports and strips module ownership from evidence', () => {
    const graph = hierarchyFixture(
      ['modules/a.ts', 'modules/b.ts'],
      [['modules/a.ts', 'modules/b.ts', 'static']],
      'modules',
    );
    graph.unmappedImports = [
      {
        fromModule: null,
        fromFile: 'modules/a.ts',
        toFile: 'outside.ts',
        specifier: '../outside.js',
        kind: 'static',
        line: 2,
      },
    ];
    graph.unresolvedImports = [
      {
        fromModule: null,
        fromFile: 'modules/a.ts',
        specifier: './missing.js',
        kind: 'static',
        line: 3,
        classification: 'relative',
      },
    ];
    graph.collection.importsUnresolved = 1;

    const view = deriveDirectoryScopeGraph(graph);

    expect(view.links).toHaveLength(1);
    expect(view.links[0].imports).toEqual([
      {
        fromFile: 'modules/a.ts',
        toFile: 'modules/b.ts',
        specifier: './b.ts',
        kind: 'static',
        line: 1,
      },
    ]);
    expect(view.links[0].imports.every((item) => !('fromModule' in item))).toBe(true);
  });
});

describe('deriveViewGraph status summary compatibility', () => {
  it('retains module-level summary cycle metrics', () => {
    const graph = hierarchyFixture(['modules/a.ts', 'modules/b.ts'], [], 'modules');
    graph.modules = [
      { id: 'a', path: 'modules/a', files: ['modules/a.ts'] },
      { id: 'b', path: 'modules/b', files: ['modules/b.ts'] },
    ];
    graph.dependencies = [
      dependency('a', 'b'),
      dependency('b', 'a'),
    ];

    const view = deriveViewGraph(graph);

    expect(view.metrics).toMatchObject({ moduleCount: 2, edgeCount: 2, cycleGroupCount: 1 });
  });
});

type HierarchyEdge = [string, string, ImportKind, number?];

function hierarchyFixture(
  sourceFiles: string[],
  edges: HierarchyEdge[],
  modulesRoot: string,
): ModuleGraph {
  return {
    schemaVersion: 2,
    modulesRoot,
    tsconfigs: [],
    sourceFiles,
    internalImports: edges.map(([from, to, kind, line = 1]) => internal(from, to, kind, line)),
    modules: [],
    dependencies: [],
    unmappedImports: [],
    unresolvedImports: [],
    collection: {
      importsFound: edges.length,
      importsResolved: edges.length,
      importsExternal: 0,
      importsUnresolved: 0,
      skippedDirectories: [],
      walkMode: 'disk',
      configFailures: [],
      parseDiagnosticFiles: [],
    },
  };
}

function internal(
  fromFile: string,
  toFile: string,
  kind: ImportKind,
  line = 1,
): InternalImport {
  return {
    fromFile,
    toFile,
    specifier: `./${toFile.split('/').at(-1) ?? toFile}`,
    kind,
    line,
    fromModule: null,
    toModule: null,
  };
}

function dependency(from: string, to: string): ModuleGraph['dependencies'][number] {
  return {
    from,
    to,
    kinds: ['static'],
    imports: [
      {
        fromFile: `${from}.ts`,
        toFile: `${to}.ts`,
        specifier: `./${to}.js`,
        kind: 'static',
        line: 1,
      },
    ],
  };
}

function nodePath(
  graph: ReturnType<typeof deriveDirectoryScopeGraph>,
  id: string,
): string | undefined {
  return graph.nodes.find((node) => node.id === id)?.path;
}

function nodeLabel(graph: ReturnType<typeof deriveDirectoryScopeGraph>, id: string): string {
  return graph.nodes.find((node) => node.id === id)?.label ?? id;
}
