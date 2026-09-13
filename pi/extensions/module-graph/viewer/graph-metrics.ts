import type { ImportEvidence, ImportKind, ModuleGraph } from '../analyzer';

// Mirrors the analyzer constant of the same name. The viewer is transpiled
// straight into the browser, so it cannot import runtime values from the
// analyzer without pulling Node built-ins along.
const IMPORT_KIND_ORDER: ImportKind[] = ['static', 're-export', 'dynamic', 'require', 'type'];

export interface ViewNode {
  id: string;
  path: string;
  files: string[];
  inDegree: number;
  outDegree: number;
  degree: number;
  radius: number;
  cyclic: boolean;
  cycleGroup?: number;
}

export interface ViewLink {
  source: string;
  target: string;
  kinds: ImportKind[];
  weight: number;
  runtime: boolean;
  cyclic: boolean;
  imports: ModuleGraph['dependencies'][number]['imports'];
}

export interface GraphMetrics {
  moduleCount: number;
  edgeCount: number;
  runtimeEdgeCount: number;
  typeOnlyEdgeCount: number;
  cycleGroupCount: number;
}

export interface ViewGraph {
  nodes: ViewNode[];
  links: ViewLink[];
  cycles: string[][];
  metrics: GraphMetrics;
}

export type DirectoryScopeNodeKind = 'directory' | 'file' | 'boundary';

export interface DirectoryScopeNode {
  id: string;
  kind: DirectoryScopeNodeKind;
  path: string;
  label: string;
  files: string[];
  expandable: boolean;
  boundary: boolean;
  inDegree: number;
  outDegree: number;
  degree: number;
  radius: number;
  cyclic: boolean;
  cycleGroup?: number;
}

export interface DirectoryScopeLink {
  id: string;
  source: string;
  target: string;
  kinds: ImportKind[];
  weight: number;
  runtime: boolean;
  cyclic: boolean;
  boundary: boolean;
  imports: ImportEvidence[];
}

export interface DirectoryScopeMetrics {
  itemCount: number;
  edgeCount: number;
  runtimeEdgeCount: number;
  typeOnlyEdgeCount: number;
  boundaryCount: number;
  cycleGroupCount: number;
}

export interface DirectoryScopeGraph {
  rootPath: string;
  scopePath: string;
  scopeSegments: string[];
  breadcrumbs: Array<{ label: string; path: string }>;
  parentPath: string | null;
  nodes: DirectoryScopeNode[];
  links: DirectoryScopeLink[];
  cycles: string[][];
  metrics: DirectoryScopeMetrics;
}

/**
 * Builds the legacy module summary used by the command status. The interactive
 * browser uses deriveDirectoryScopeGraph at every depth instead.
 */
export function deriveViewGraph(graph: ModuleGraph): ViewGraph {
  const moduleIds = new Set(graph.modules.map((module) => module.id));
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  for (const id of moduleIds) {
    incoming.set(id, new Set());
    outgoing.set(id, new Set());
  }

  const links: ViewLink[] = graph.dependencies.map((dependency) => {
    if (!moduleIds.has(dependency.from) || !moduleIds.has(dependency.to)) {
      throw new Error(
        `Dependency ${dependency.from} -> ${dependency.to} references an unknown module.`,
      );
    }
    outgoing.get(dependency.from)?.add(dependency.to);
    incoming.get(dependency.to)?.add(dependency.from);
    return {
      source: dependency.from,
      target: dependency.to,
      kinds: dependency.kinds,
      weight: dependency.imports.length,
      runtime: dependency.kinds.some((kind) => kind !== 'type'),
      cyclic: false,
      imports: dependency.imports,
    };
  });

  const runtimeAdjacency = new Map<string, string[]>();
  for (const id of moduleIds) runtimeAdjacency.set(id, []);
  for (const link of links) {
    if (link.runtime) runtimeAdjacency.get(link.source)?.push(link.target);
  }
  for (const targets of runtimeAdjacency.values()) targets.sort(compareText);

  const cycles = stronglyConnectedComponents([...moduleIds].sort(compareText), runtimeAdjacency)
    .filter((component) => component.length > 1)
    .map((component) => component.sort(compareText))
    .sort((a, b) => compareText(a[0], b[0]));
  const cycleForModule = new Map<string, number>();
  cycles.forEach((component, index) => {
    for (const id of component) cycleForModule.set(id, index);
  });

  for (const link of links) {
    const sourceCycle = cycleForModule.get(link.source);
    link.cyclic =
      link.runtime && sourceCycle !== undefined && sourceCycle === cycleForModule.get(link.target);
  }

  const nodes = graph.modules.map((module) => {
    const inDegree = incoming.get(module.id)?.size ?? 0;
    const outDegree = outgoing.get(module.id)?.size ?? 0;
    const cycleGroup = cycleForModule.get(module.id);
    return {
      id: module.id,
      path: module.path,
      files: module.files,
      inDegree,
      outDegree,
      degree: inDegree + outDegree,
      radius: 1 + Math.sqrt(inDegree + outDegree) * 0.28,
      cyclic: cycleGroup !== undefined,
      cycleGroup,
    };
  });

  const runtimeEdgeCount = links.filter((link) => link.runtime).length;
  return {
    nodes,
    links,
    cycles,
    metrics: {
      moduleCount: nodes.length,
      edgeCount: links.length,
      runtimeEdgeCount,
      typeOnlyEdgeCount: links.length - runtimeEdgeCount,
      cycleGroupCount: cycles.length,
    },
  };
}

/** Derives one arbitrary-depth directory scope from collected file evidence. */
export function deriveDirectoryScopeGraph(
  graph: ModuleGraph,
  requestedScope = graph.modulesRoot,
): DirectoryScopeGraph {
  const rootPath = normalizeDisplayPath(graph.modulesRoot, 'modules root');
  const sourceFiles = [...new Set(graph.sourceFiles.map((file) => normalizeDisplayPath(file, 'source file')))]
    .sort(compareText);

  for (const file of sourceFiles) {
    requireSameCoordinates(rootPath, file);
    if (!isInside(rootPath, file) || file === rootPath) {
      throw new Error(`Collected source is outside modules root: ${file}`);
    }
  }

  const scopePath = normalizeDisplayPath(requestedScope, 'scope');
  requireSameCoordinates(rootPath, scopePath);
  if (!isInside(rootPath, scopePath)) throw new Error(`Scope is outside modules root: ${scopePath}`);
  if (sourceFiles.includes(scopePath)) throw new Error(`Scope is a source file, not a directory: ${scopePath}`);
  const scopeFiles = sourceFiles.filter((file) => isInside(scopePath, file) && file !== scopePath);
  if (scopePath !== rootPath && scopeFiles.length === 0) {
    throw new Error(`Unknown directory scope: ${scopePath}`);
  }

  const sourceSet = new Set(sourceFiles);
  const representedByPath = new Map<string, { kind: 'directory' | 'file'; files: string[] }>();
  for (const file of scopeFiles) {
    const relative = relativeInside(scopePath, file);
    const segments = splitPath(relative);
    if (segments.length === 1) {
      representedByPath.set(file, { kind: 'file', files: [file] });
      continue;
    }
    const directoryPath = joinPath(scopePath, segments[0]);
    const existing = representedByPath.get(directoryPath);
    if (existing) existing.files.push(file);
    else representedByPath.set(directoryPath, { kind: 'directory', files: [file] });
  }

  const realNodes: DirectoryScopeNode[] = [...representedByPath.entries()]
    .sort(([leftPath, left], [rightPath, right]) =>
      compareText(leftPath, rightPath) || compareText(left.kind, right.kind),
    )
    .map(([path, represented]) => ({
      id: represented.kind === 'directory' ? directoryId(path) : fileId(path),
      kind: represented.kind,
      path,
      label: `${baseName(path)}${represented.kind === 'directory' ? '/' : ''}`,
      files: represented.files.sort(compareText),
      expandable: represented.kind === 'directory',
      boundary: false,
      inDegree: 0,
      outDegree: 0,
      degree: 0,
      radius: 1,
      cyclic: false,
    }));
  const realNodeByPath = new Map(realNodes.map((node) => [node.path, node]));
  const boundaryKeys = new Set<string>();
  const evidenceByPair = new Map<string, { source: string; target: string; imports: ImportEvidence[] }>();

  function mappedInside(file: string): DirectoryScopeNode {
    const segments = splitPath(relativeInside(scopePath, file));
    const visiblePath = segments.length === 1 ? file : joinPath(scopePath, segments[0]);
    const node = realNodeByPath.get(visiblePath);
    if (!node) throw new Error(`Could not map collected source into scope: ${file}`);
    return node;
  }

  function mappedOutside(file: string): string {
    const key = boundaryGroup(relativePath(scopePath, file));
    boundaryKeys.add(key);
    return boundaryId(key);
  }

  function record(source: string, target: string, evidence: ImportEvidence): void {
    if (source === target) return;
    const key = linkId(source, target);
    const aggregate = evidenceByPair.get(key) ?? { source, target, imports: [] };
    aggregate.imports.push(evidence);
    evidenceByPair.set(key, aggregate);
  }

  for (const item of graph.internalImports) {
    const fromFile = normalizeDisplayPath(item.fromFile, 'internal import endpoint');
    const toFile = normalizeDisplayPath(item.toFile, 'internal import endpoint');
    requireSameCoordinates(rootPath, fromFile);
    requireSameCoordinates(rootPath, toFile);
    if (!sourceSet.has(fromFile)) throw new Error(`Internal import endpoint was not collected: ${fromFile}`);
    if (!sourceSet.has(toFile)) throw new Error(`Internal import endpoint was not collected: ${toFile}`);
    if (fromFile === toFile) continue;

    const fromInside = isInside(scopePath, fromFile) && fromFile !== scopePath;
    const toInside = isInside(scopePath, toFile) && toFile !== scopePath;
    if (!fromInside && !toInside) continue;

    const source = fromInside ? mappedInside(fromFile).id : mappedOutside(fromFile);
    const target = toInside ? mappedInside(toFile).id : mappedOutside(toFile);
    record(source, target, {
      fromFile,
      toFile,
      specifier: item.specifier,
      kind: item.kind,
      line: item.line,
    });
  }

  const boundaryNodes: DirectoryScopeNode[] = [...boundaryKeys]
    .sort(compareText)
    .map((key) => ({
      id: boundaryId(key),
      kind: 'boundary' as const,
      path: key,
      label: key,
      files: [],
      expandable: false,
      boundary: true,
      inDegree: 0,
      outDegree: 0,
      degree: 0,
      radius: 1,
      cyclic: false,
    }));
  const nodes = [...realNodes, ...boundaryNodes];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const links: DirectoryScopeLink[] = [...evidenceByPair.values()]
    .map(({ source, target, imports: unsortedImports }) => {
      const imports = unsortedImports.sort(compareEvidence);
      const kinds = IMPORT_KIND_ORDER.filter((kind) => imports.some((item) => item.kind === kind));
      const boundary = Boolean(nodeById.get(source)?.boundary || nodeById.get(target)?.boundary);
      return {
        id: linkId(source, target),
        source,
        target,
        kinds,
        weight: imports.length,
        runtime: kinds.some((kind) => kind !== 'type'),
        cyclic: false,
        boundary,
        imports,
      };
    })
    .sort((a, b) => compareText(a.source, b.source) || compareText(a.target, b.target));

  const realIds = realNodes.map((node) => node.id).sort(compareText);
  const runtimeAdjacency = new Map(realIds.map((id) => [id, [] as string[]]));
  for (const link of links) {
    if (link.runtime && !link.boundary) runtimeAdjacency.get(link.source)?.push(link.target);
  }
  for (const targets of runtimeAdjacency.values()) targets.sort(compareText);
  const cycles = stronglyConnectedComponents(realIds, runtimeAdjacency)
    .filter((component) => component.length > 1)
    .map((component) => component.sort(compareText))
    .sort((left, right) => compareText(left[0], right[0]));
  const cycleForNode = new Map<string, number>();
  cycles.forEach((component, index) => {
    for (const id of component) cycleForNode.set(id, index);
  });

  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  for (const link of links) {
    const sourceCycle = cycleForNode.get(link.source);
    link.cyclic =
      link.runtime &&
      !link.boundary &&
      sourceCycle !== undefined &&
      sourceCycle === cycleForNode.get(link.target);
    const targets = outgoing.get(link.source) ?? new Set<string>();
    targets.add(link.target);
    outgoing.set(link.source, targets);
    const sources = incoming.get(link.target) ?? new Set<string>();
    sources.add(link.source);
    incoming.set(link.target, sources);
  }
  for (const node of nodes) {
    node.inDegree = incoming.get(node.id)?.size ?? 0;
    node.outDegree = outgoing.get(node.id)?.size ?? 0;
    node.degree = node.inDegree + node.outDegree;
    node.radius = 1 + Math.sqrt(node.degree) * 0.28;
    node.cycleGroup = cycleForNode.get(node.id);
    node.cyclic = node.cycleGroup !== undefined;
  }

  const scopeSegments = splitPath(relativeInside(rootPath, scopePath));
  const breadcrumbs = [{ label: 'root', path: rootPath }];
  let breadcrumbPath = rootPath;
  for (const segment of scopeSegments) {
    breadcrumbPath = joinPath(breadcrumbPath, segment);
    breadcrumbs.push({ label: segment, path: breadcrumbPath });
  }
  const parentPath =
    scopePath === rootPath
      ? null
      : scopeSegments.length === 1
        ? rootPath
        : joinPath(rootPath, scopeSegments.slice(0, -1).join('/'));
  const runtimeEdgeCount = links.filter((link) => link.runtime).length;

  return {
    rootPath,
    scopePath,
    scopeSegments,
    breadcrumbs,
    parentPath,
    nodes,
    links,
    cycles,
    metrics: {
      itemCount: nodes.length,
      edgeCount: links.length,
      runtimeEdgeCount,
      typeOnlyEdgeCount: links.length - runtimeEdgeCount,
      boundaryCount: boundaryNodes.length,
      cycleGroupCount: cycles.length,
    },
  };
}

function encodeId(tag: string, value: string): string {
  return `${tag}:${value.length}:${value}`;
}

function directoryId(path: string): string {
  return encodeId('scope:dir', path);
}

function fileId(path: string): string {
  return encodeId('scope:file', path);
}

function boundaryId(key: string): string {
  return encodeId('scope:boundary', key);
}

function linkId(source: string, target: string): string {
  return `scope:link:${source.length}:${source}:${target.length}:${target}`;
}

function normalizeDisplayPath(input: string, description: string): string {
  if (!input.trim()) throw new Error(`Invalid empty ${description} path.`);
  const slashed = input.replaceAll('\\', '/');
  const absolute = slashed.startsWith('/');
  const segments: string[] = [];
  for (const segment of slashed.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) {
        if (absolute) continue;
        throw new Error(`${description} path escapes its coordinate root: ${input}`);
      }
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  if (absolute) return `/${segments.join('/')}` || '/';
  return segments.join('/') || '.';
}

function requireSameCoordinates(root: string, path: string): void {
  if (root.startsWith('/') !== path.startsWith('/')) {
    throw new Error(`Path uses different absolute/relative coordinates than modules root: ${path}`);
  }
}

function splitPath(path: string): string[] {
  if (path === '.' || path === '/') return [];
  return path.replace(/^\//, '').split('/');
}

function isInside(directory: string, path: string): boolean {
  if (directory === '.') return !path.startsWith('/');
  if (directory === '/') return path.startsWith('/');
  return path === directory || path.startsWith(`${directory}/`);
}

function relativeInside(directory: string, path: string): string {
  if (!isInside(directory, path)) throw new Error(`${path} is outside ${directory}`);
  if (path === directory) return '.';
  if (directory === '.') return path;
  if (directory === '/') return path.slice(1);
  return path.slice(directory.length + 1);
}

function joinPath(directory: string, child: string): string {
  if (directory === '.') return child;
  if (directory === '/') return `/${child}`;
  return `${directory}/${child}`;
}

function relativePath(fromDirectory: string, toPath: string): string {
  requireSameCoordinates(fromDirectory, toPath);
  const from = splitPath(fromDirectory);
  const to = splitPath(toPath);
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common += 1;
  return [...from.slice(common).map(() => '..'), ...to.slice(common)].join('/') || '.';
}

function boundaryGroup(relativeEndpoint: string): string {
  const segments = splitPath(relativeEndpoint);
  let parentCount = 0;
  while (segments[parentCount] === '..') parentCount += 1;
  const remainder = segments.slice(parentCount);
  if (parentCount === 0 || remainder.length === 0) {
    throw new Error(`Invalid outside endpoint relative path: ${relativeEndpoint}`);
  }
  return [...segments.slice(0, parentCount), ...(remainder.length === 1 ? remainder : [remainder[0]])].join('/');
}

function baseName(path: string): string {
  const parts = splitPath(path);
  return parts[parts.length - 1] ?? path;
}

/** Tarjan's algorithm. Each returned component is strongly connected. */
function stronglyConnectedComponents(
  nodeIds: string[],
  adjacency: Map<string, string[]>,
): string[][] {
  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  function visit(id: string): void {
    indexes.set(id, nextIndex);
    lowLinks.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);

    for (const target of adjacency.get(id) ?? []) {
      if (!indexes.has(target)) {
        visit(target);
        lowLinks.set(id, Math.min(lowLinks.get(id) ?? 0, lowLinks.get(target) ?? 0));
      } else if (onStack.has(target)) {
        lowLinks.set(id, Math.min(lowLinks.get(id) ?? 0, indexes.get(target) ?? 0));
      }
    }

    if (lowLinks.get(id) !== indexes.get(id)) return;
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (!member) throw new Error('Invalid strongly connected component stack.');
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    components.push(component);
  }

  for (const id of nodeIds) {
    if (!indexes.has(id)) visit(id);
  }
  return components;
}

function compareEvidence(a: ImportEvidence, b: ImportEvidence): number {
  return (
    compareText(a.fromFile, b.fromFile) ||
    a.line - b.line ||
    compareText(a.toFile, b.toFile) ||
    compareText(a.specifier, b.specifier) ||
    compareText(a.kind, b.kind)
  );
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
