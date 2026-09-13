import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

export type ImportKind = 'dynamic' | 're-export' | 'require' | 'static' | 'type';
export type ImportClassification = 'alias' | 'bare' | 'dynamic-expression' | 'relative';

export interface ImportEvidence {
  fromFile: string;
  toFile: string;
  specifier: string;
  kind: ImportKind;
  line: number;
}

export interface ModuleRecord {
  id: string;
  path: string;
  files: string[];
  synthetic?: boolean;
}

export interface ModuleDependency {
  from: string;
  to: string;
  kinds: ImportKind[];
  imports: ImportEvidence[];
}

export interface InternalImport extends ImportEvidence {
  fromModule: string | null;
  toModule: string | null;
}

export interface UnresolvedImport {
  fromModule: string | null;
  fromFile: string;
  specifier: string;
  kind: ImportKind;
  line: number;
  classification: ImportClassification;
}

export interface UnmappedImport extends ImportEvidence {
  fromModule: string | null;
}

export interface ConfigFailure {
  config: string;
  reason: string;
}

export interface SkippedDirectory {
  path: string;
  reason: string;
}

export interface CollectionSummary {
  importsFound: number;
  importsResolved: number;
  importsExternal: number;
  importsUnresolved: number;
  skippedDirectories: SkippedDirectory[];
  walkMode: 'disk' | 'git';
  configFailures: ConfigFailure[];
  parseDiagnosticFiles: string[];
}

export interface ModuleGraph {
  schemaVersion: 2;
  modulesRoot: string;
  tsconfigs: string[];
  sourceFiles: string[];
  internalImports: InternalImport[];
  modules: ModuleRecord[];
  dependencies: ModuleDependency[];
  unmappedImports: UnmappedImport[];
  unresolvedImports: UnresolvedImport[];
  collection: CollectionSummary;
}

export interface AnalyzeModulesOptions {
  modulesRoot: string;
  projectRoot?: string;
  tsconfigPath?: string;
  includeTests?: boolean;
  includeUntracked?: boolean;
}

interface FoundImport {
  specifier: string;
  kind: ImportKind;
  line: number;
  dynamicExpression: boolean;
}

interface AbsoluteModule {
  id: string;
  path: string;
  files: string[];
  synthetic?: boolean;
}

interface CollectedSourceFiles {
  files: string[];
  walkMode: 'disk' | 'git';
  skippedDirectories: SkippedDirectory[];
}

interface ParsedConfig {
  path: string;
  ownOptions: ts.CompilerOptions;
  options: ts.CompilerOptions;
  pathKeys: string[];
  fileNames: Set<string>;
  referencePaths: string[];
  referencesMerged: boolean;
  usedConfigPaths: string[];
}

interface ConfigResolution {
  options: ts.CompilerOptions;
  pathKeys: string[];
  configPaths: string[];
}

interface ConfigResolver {
  resolve(sourceFile: string): ConfigResolution;
  failures(): ConfigFailure[];
}

const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  module: ts.ModuleKind.NodeNext,
};
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const ALWAYS_SKIPPED_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.hg',
  '.next',
  '.nuxt',
  '.output',
  '.parcel-cache',
  '.svn',
  '.turbo',
  '.venv',
  '.vite',
  '.worktrees',
  'bower_components',
  'node_modules',
]);
const PACKAGE_OUTPUT_DIRECTORIES = new Set([
  'build',
  'cache',
  'coverage',
  'dist',
  'out',
  'target',
  'vendor',
]);
const TEST_DIRECTORIES = new Set([
  '__fixtures__',
  '__tests__',
  'fixture',
  'fixtures',
  'test',
  'tests',
]);
const IMPORT_KIND_ORDER: ImportKind[] = ['static', 're-export', 'dynamic', 'require', 'type'];

/**
 * Collects production sources within modulesRoot. Direct child directories are
 * retained as viewer-compatible modules, while file-level imports preserve all
 * internal relationships, including root and same-module files.
 */
export function analyzeModules(options: AnalyzeModulesOptions): ModuleGraph {
  const projectRoot = canonicalPath(options.projectRoot ?? process.cwd());
  const modulesRoot = canonicalPath(options.modulesRoot);
  assertDirectory(modulesRoot, 'modules root');

  const explicitTsconfigPath = options.tsconfigPath
    ? canonicalPath(options.tsconfigPath)
    : undefined;
  const configResolver = createConfigResolver(explicitTsconfigPath, projectRoot);
  const includeTests = options.includeTests ?? false;
  const collected = collectSourceFiles(
    modulesRoot,
    includeTests,
    options.includeUntracked ?? false,
    projectRoot,
  );
  const sourceFiles = collected.files;
  if (sourceFiles.length === 0) {
    throw new Error(`modules root has no production source files: ${modulesRoot}`);
  }
  const modules = discoverModules(modulesRoot, sourceFiles);
  const collectedFiles = new Set(sourceFiles);
  const moduleForFile = buildModuleLookup(modules, modulesRoot);
  const moduleResolutionCache = ts.createModuleResolutionCache(
    projectRoot,
    (fileName) => canonicalPath(fileName),
  );
  const declarationSourceCache = new Map<string, string | null>();
  const workspacePackageNames = collectWorkspacePackageNames(sourceFiles, projectRoot);
  const dependencyEvidence = new Map<string, ImportEvidence[]>();
  const internalImports: InternalImport[] = [];
  const unmappedImports: UnmappedImport[] = [];
  const unresolvedImports: UnresolvedImport[] = [];
  const usedTsconfigs = new Set<string>();
  let importsFound = 0;
  let importsResolved = 0;
  let importsExternal = 0;
  const parseDiagnosticFiles: string[] = [];

  for (const sourceFile of sourceFiles) {
    const sourceModule = moduleForFile(sourceFile);
    const config = configResolver.resolve(sourceFile);
    for (const configPath of config.configPaths) usedTsconfigs.add(configPath);
    const sourceText = readFileSync(sourceFile, 'utf8');
    const source = ts.createSourceFile(
      sourceFile,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(sourceFile),
    );
    const parseDiagnostics = (source as ts.SourceFile & {
      parseDiagnostics?: readonly ts.Diagnostic[];
    }).parseDiagnostics;
    if (parseDiagnostics && parseDiagnostics.length > 0) {
      parseDiagnosticFiles.push(displayPath(sourceFile, projectRoot));
    }

    for (const found of findImports(source)) {
      importsFound += 1;
      const classification = classifyImport(found, config.pathKeys, workspacePackageNames);
      if (classification === 'dynamic-expression') {
        unresolvedImports.push(unresolvedImport(sourceFile, sourceModule, found, classification, projectRoot));
        continue;
      }

      let targetFile = resolveImport(
        found.specifier,
        sourceFile,
        config.options,
        moduleResolutionCache,
      );
      if (!targetFile) {
        if (classification === 'bare') {
          importsExternal += 1;
        } else {
          unresolvedImports.push(unresolvedImport(sourceFile, sourceModule, found, classification, projectRoot));
        }
        continue;
      }

      if (
        classification === 'bare' &&
        (!isInside(projectRoot, targetFile) || isDependencyPath(targetFile))
      ) {
        importsExternal += 1;
        continue;
      }

      if (classification === 'alias' && isDeclarationFile(targetFile) && isInside(projectRoot, targetFile)) {
        const attributed = attributeDeclarationToSource(
          targetFile,
          found.specifier,
          projectRoot,
          collectedFiles,
          declarationSourceCache,
        );
        if (!attributed) {
          unresolvedImports.push(unresolvedImport(sourceFile, sourceModule, found, 'alias', projectRoot));
          continue;
        }
        targetFile = attributed;
      }
      importsResolved += 1;

      if (!isInside(modulesRoot, targetFile)) {
        if (isInside(projectRoot, targetFile) && !isDependencyPath(targetFile)) {
          unmappedImports.push({
            fromModule: sourceModule?.id ?? null,
            fromFile: displayPath(sourceFile, projectRoot),
            toFile: displayPath(targetFile, projectRoot),
            specifier: found.specifier,
            kind: found.kind,
            line: found.line,
          });
        }
        continue;
      }

      // Resolved files excluded by production, ignore, or output rules do not
      // become internal nodes merely because another source references them.
      if (!collectedFiles.has(targetFile)) continue;

      const targetModule = moduleForFile(targetFile);
      const evidence: ImportEvidence = {
        fromFile: displayPath(sourceFile, projectRoot),
        toFile: displayPath(targetFile, projectRoot),
        specifier: found.specifier,
        kind: found.kind,
        line: found.line,
      };
      internalImports.push({
        ...evidence,
        fromModule: sourceModule?.id ?? null,
        toModule: targetModule?.id ?? null,
      });

      if (!sourceModule || !targetModule || targetModule.id === sourceModule.id) continue;
      const key = `${sourceModule.id}\0${targetModule.id}`;
      const imports = dependencyEvidence.get(key) ?? [];
      imports.push(evidence);
      dependencyEvidence.set(key, imports);
    }
  }

  const dependencies = [...dependencyEvidence.entries()]
    .map(([key, imports]) => {
      const [from, to] = key.split('\0');
      const sortedImports = imports.sort(compareEvidence);
      const kinds = IMPORT_KIND_ORDER.filter((kind) =>
        sortedImports.some((item) => item.kind === kind),
      );
      return { from, to, kinds, imports: sortedImports };
    })
    .sort((a, b) => compareText(a.from, b.from) || compareText(a.to, b.to));

  const sortedUnresolvedImports = unresolvedImports.sort(compareUnresolved);
  return {
    schemaVersion: 2,
    modulesRoot: displayPath(modulesRoot, projectRoot),
    tsconfigs: [...usedTsconfigs]
      .map((path) => displayPath(path, projectRoot))
      .sort(compareText),
    sourceFiles: sourceFiles.map((file) => displayPath(file, projectRoot)),
    internalImports: internalImports.sort(compareInternal),
    modules: modules.map((module) => ({
      id: module.id,
      path: displayPath(module.path, projectRoot),
      files: module.files.map((file) => displayPath(file, projectRoot)),
      ...(module.synthetic ? { synthetic: true } : {}),
    })),
    dependencies,
    unmappedImports: unmappedImports.sort(compareUnmapped),
    unresolvedImports: sortedUnresolvedImports,
    collection: {
      importsFound,
      importsResolved,
      importsExternal,
      importsUnresolved: sortedUnresolvedImports.length,
      skippedDirectories: collected.skippedDirectories.map((skipped) => ({
        path: displayPath(skipped.path, projectRoot),
        reason: skipped.reason,
      })),
      walkMode: collected.walkMode,
      configFailures: configResolver.failures(),
      parseDiagnosticFiles: parseDiagnosticFiles.sort(compareText),
    },
  };
}

export async function analyzeModulesAsync(options: AnalyzeModulesOptions): Promise<ModuleGraph> {
  await new Promise<void>((resolveReady) => setImmediate(resolveReady));
  return analyzeModules(options);
}

export function findImports(sourceFile: ts.SourceFile): FoundImport[] {
  const imports: FoundImport[] = [];

  function add(
    node: ts.Node,
    specifier: ts.Expression,
    kind: ImportKind,
    allowDynamicExpression = false,
  ): void {
    const literal = ts.isStringLiteralLike(specifier);
    if (!literal && !allowDynamicExpression) return;
    imports.push({
      specifier: literal ? specifier.text : specifier.getText(sourceFile),
      kind,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      dynamicExpression: !literal,
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      add(node, node.moduleSpecifier, isTypeOnlyImport(node) ? 'type' : 'static');
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(node, node.moduleSpecifier, isTypeOnlyExport(node) ? 'type' : 're-export');
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const expression = node.moduleReference.expression;
      if (expression) add(node, expression, 'require');
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length > 0) {
        add(node, node.arguments[0], 'dynamic', true);
      } else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require' &&
        node.arguments.length === 1
      ) {
        add(node, node.arguments[0], 'require', true);
      }
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument)) add(node, argument.literal, 'type');
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

function unresolvedImport(
  sourceFile: string,
  sourceModule: AbsoluteModule | undefined,
  found: FoundImport,
  classification: Exclude<ImportClassification, 'bare'>,
  projectRoot: string,
): UnresolvedImport {
  return {
    fromModule: sourceModule?.id ?? null,
    fromFile: displayPath(sourceFile, projectRoot),
    specifier: found.specifier,
    kind: found.kind,
    line: found.line,
    classification,
  };
}

function classifyImport(
  found: FoundImport,
  pathKeys: string[],
  workspacePackageNames: Set<string>,
): ImportClassification {
  if (!found.dynamicExpression && found.specifier.startsWith('.')) return 'relative';
  if (
    !found.dynamicExpression &&
    (pathKeys.some((key) => matchesPathKey(found.specifier, key)) ||
      [...workspacePackageNames].some(
        (name) => found.specifier === name || found.specifier.startsWith(`${name}/`),
      ))
  ) {
    return 'alias';
  }
  if (found.dynamicExpression) return 'dynamic-expression';
  return 'bare';
}

function matchesPathKey(specifier: string, key: string): boolean {
  const wildcard = key.indexOf('*');
  if (wildcard < 0) return specifier === key;
  return specifier.startsWith(key.slice(0, wildcard)) && specifier.endsWith(key.slice(wildcard + 1));
}

function discoverModules(modulesRoot: string, sourceFiles: string[]): AbsoluteModule[] {
  const filesByModulePath = new Map<string, string[]>();
  const rootFiles: string[] = [];
  for (const file of sourceFiles) {
    const rel = relative(modulesRoot, file);
    const segments = rel.split(sep);
    if (segments.length === 1) {
      rootFiles.push(file);
      continue;
    }
    const modulePath = canonicalPath(join(modulesRoot, segments[0]));
    const files = filesByModulePath.get(modulePath) ?? [];
    files.push(file);
    filesByModulePath.set(modulePath, files);
  }

  const modules: AbsoluteModule[] = [...filesByModulePath.entries()].map(([path, files]) => ({
    id: relative(modulesRoot, path).split(sep).join('/'),
    path,
    files: files.sort(compareText),
  }));
  if (rootFiles.length > 0) {
    modules.push({
      id: '(root)',
      path: modulesRoot,
      files: rootFiles.sort(compareText),
      synthetic: true,
    });
  }
  return modules.sort((left, right) => compareText(left.id, right.id));
}

function collectSourceFiles(
  directory: string,
  includeTests: boolean,
  includeUntracked: boolean,
  projectRoot: string,
): CollectedSourceFiles {
  const git = detectGitWorkTree(directory);
  const registeredWorktrees = git ? collectRegisteredWorktrees(directory) : new Set<string>();
  const scan = scanCollectionTree(directory, includeTests, registeredWorktrees, projectRoot);
  let files = scan.files;

  if (git) {
    const visibleFiles = [
      ...collectGitVisibleFiles(directory, includeUntracked),
      ...scan.nestedRepositories.flatMap((nested) =>
        collectGitVisibleFiles(nested, includeUntracked),
      ),
    ];
    const candidates = new Set(scan.files);
    files = visibleFiles.map(canonicalPath).filter((file) => candidates.has(file));
  }

  return {
    files: [...new Set(files)].sort(compareText),
    walkMode: git ? 'git' : 'disk',
    skippedDirectories: [...scan.skippedDirectories.values()].sort((left, right) =>
      compareText(left.path, right.path) || compareText(left.reason, right.reason),
    ),
  };
}

function detectGitWorkTree(directory: string): boolean {
  try {
    return execFileSync('git', ['-C', directory, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim() === 'true';
  } catch (error) {
    const detail = gitErrorDetail(error);
    if (detail.includes('not a git repository') || detail.includes('cannot change to')) return false;
    if (isMissingCommand(error)) return false;
    throw new Error(`Git worktree detection failed for ${directory}: ${detail}`);
  }
}

function collectGitVisibleFiles(directory: string, includeUntracked: boolean): string[] {
  const args = ['-C', directory, 'ls-files', '--cached'];
  if (includeUntracked) args.push('--others', '--exclude-standard');
  args.push('-z', '--', '.');
  try {
    const output = execFileSync('git', args, {
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .map((path) => resolve(directory, path));
  } catch (error) {
    throw new Error(`Git file listing failed for ${directory}: ${gitErrorDetail(error)}`);
  }
}

function collectRegisteredWorktrees(directory: string): Set<string> {
  try {
    const output = execFileSync('git', ['-C', directory, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return new Set(
      output
        .split('\n')
        .filter((line) => line.startsWith('worktree '))
        .map((line) => canonicalPath(line.slice('worktree '.length))),
    );
  } catch (error) {
    throw new Error(`Git worktree listing failed for ${directory}: ${gitErrorDetail(error)}`);
  }
}

function scanCollectionTree(
  root: string,
  includeTests: boolean,
  registeredWorktrees: Set<string>,
  projectRoot: string,
): {
  files: string[];
  nestedRepositories: string[];
  skippedDirectories: Map<string, SkippedDirectory>;
} {
  const files: string[] = [];
  const nestedRepositories: string[] = [];
  const skippedDirectories = new Map<string, SkippedDirectory>();
  const visitedDirectories = new Set<string>();

  function skip(path: string, reason: string): void {
    const absolute = resolve(path);
    if (!skippedDirectories.has(absolute)) skippedDirectories.set(absolute, { path: absolute, reason });
  }

  function visit(directory: string): void {
    const realDirectory = canonicalPath(directory);
    if (!isInside(root, realDirectory)) {
      skip(directory, 'symlink target is outside modules root');
      return;
    }
    if (visitedDirectories.has(realDirectory)) return;
    visitedDirectories.add(realDirectory);

    if (directory !== root && existsSync(join(directory, '.git'))) {
      if (isRegisteredWorktree(directory, root, registeredWorktrees, projectRoot)) {
        skip(directory, 'registered Git worktree');
        return;
      }
      nestedRepositories.push(directory);
    }

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      let stat;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        const reason = skippedDirectoryReason(path, entry.name, includeTests);
        if (reason) {
          skip(path, reason);
          continue;
        }
        visit(path);
        continue;
      }
      if (!stat.isFile() || !isSourceFile(entry.name)) continue;
      if (!includeTests && isTestFile(entry.name)) continue;
      const realFile = canonicalPath(path);
      if (!isInside(root, realFile)) {
        skip(path, 'symlink target is outside modules root');
        continue;
      }
      files.push(realFile);
    }
  }

  visit(root);
  return { files, nestedRepositories, skippedDirectories };
}

function skippedDirectoryReason(
  path: string,
  name: string,
  includeTests: boolean,
): string | undefined {
  const lowerName = name.toLowerCase();
  if (lowerName === '.worktrees') return 'registered Git worktrees';
  if (ALWAYS_SKIPPED_DIRECTORIES.has(lowerName)) return 'tooling or dependency directory';
  if (!includeTests && TEST_DIRECTORIES.has(lowerName)) return 'test sources excluded';
  if (PACKAGE_OUTPUT_DIRECTORIES.has(lowerName) && existsSync(join(dirname(path), 'package.json'))) {
    return 'package output directory';
  }
  return undefined;
}

function isRegisteredWorktree(
  directory: string,
  repositoryRoot: string,
  registeredWorktrees: Set<string>,
  projectRoot: string,
): boolean {
  const canonical = canonicalPath(directory);
  const gitEntry = join(directory, '.git');
  lstatSync(gitEntry);
  const commonDirectory = canonicalPath(runGitText(directory, ['rev-parse', '--git-common-dir']));
  const rootCommonDirectory = canonicalPath(runGitText(repositoryRoot, ['rev-parse', '--git-common-dir']));
  const rel = relative(repositoryRoot, directory).split(sep).join('/');
  const stage = runGitText(repositoryRoot, ['ls-files', '--stage', '--', rel]);
  const isGitlink = stage.split('\n').some((line) => line.startsWith('160000 '));
  const gitmodules = join(repositoryRoot, '.gitmodules');
  const listedAsSubmodule = existsSync(gitmodules) &&
    readFileSync(gitmodules, 'utf8').split('\n').some((line) => line.trim() === `path = ${rel}`);

  if (registeredWorktrees.has(canonical)) return true;
  if (commonDirectory === rootCommonDirectory && !isGitlink && !listedAsSubmodule) return true;
  if (!isInside(projectRoot, canonical)) return true;
  return false;
}

function runGitText(directory: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', directory, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    throw new Error(`Git command failed in ${directory}: ${gitErrorDetail(error)}`);
  }
}

function gitErrorDetail(error: unknown): string {
  if (isRecord(error)) {
    const stderr = error.stderr;
    if (typeof stderr === 'string' && stderr.trim()) return stderr.trim();
    if (Buffer.isBuffer(stderr) && stderr.length > 0) return stderr.toString('utf8').trim();
    if (typeof error.message === 'string') return error.message;
  }
  return String(error);
}

function isMissingCommand(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function isSourceFile(fileName: string): boolean {
  return SOURCE_EXTENSIONS.has(extname(fileName)) && !/\.d\.[cm]?ts$/.test(fileName);
}

function isTestFile(fileName: string): boolean {
  return /(?:^|\.)(?:test|spec)\.[cm]?[jt]sx?$/i.test(fileName);
}

function isDependencyPath(path: string): boolean {
  const segments = resolve(path).split(sep).map((segment) => segment.toLowerCase());
  return segments.includes('node_modules') ||
    segments.includes('bower_components') ||
    segments.includes('vendor');
}

function buildModuleLookup(
  modules: AbsoluteModule[],
  modulesRoot: string,
): (file: string) => AbsoluteModule | undefined {
  const byPath = new Map(modules.map((module) => [module.path, module]));
  return (file) => {
    const rel = relative(modulesRoot, file);
    const segments = rel.split(sep);
    const modulePath = segments.length === 1
      ? modulesRoot
      : canonicalPath(join(modulesRoot, segments[0]));
    return byPath.get(modulePath);
  };
}

function resolveImport(
  specifier: string,
  containingFile: string,
  compilerOptions: ts.CompilerOptions,
  cache: ts.ModuleResolutionCache,
): string | undefined {
  const result = ts.resolveModuleName(
    specifier,
    containingFile,
    compilerOptions,
    ts.sys,
    cache,
  ).resolvedModule;
  return result ? canonicalPath(result.resolvedFileName) : undefined;
}

function isDeclarationFile(path: string): boolean {
  return /\.d\.[cm]?ts$/i.test(path);
}

function attributeDeclarationToSource(
  declarationFile: string,
  specifier: string,
  projectRoot: string,
  collectedFiles: Set<string>,
  cache: Map<string, string | null>,
): string | undefined {
  const cacheKey = `${declarationFile}\0${specifier}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached ?? undefined;

  const packageFile = nearestPackageJson(dirname(declarationFile), projectRoot);
  if (!packageFile) {
    cache.set(cacheKey, null);
    return undefined;
  }

  let packageJson: unknown;
  try {
    packageJson = JSON.parse(readFileSync(packageFile, 'utf8'));
  } catch {
    cache.set(cacheKey, null);
    return undefined;
  }
  if (!isRecord(packageJson)) {
    cache.set(cacheKey, null);
    return undefined;
  }

  const packageRoot = dirname(packageFile);
  const packageName = typeof packageJson.name === 'string' ? packageJson.name : undefined;
  const subpath = packageSubpath(specifier, packageName);
  if (!subpath) {
    cache.set(cacheKey, null);
    return undefined;
  }

  const entryTargets: string[] = [];
  if (subpath === '.') {
    if (typeof packageJson.main === 'string') entryTargets.push(packageJson.main);
    if (typeof packageJson.module === 'string') entryTargets.push(packageJson.module);
  }
  const selectedExport = selectPackageExport(packageJson.exports, subpath);
  entryTargets.push(...collectPackageTargets(selectedExport));
  if (!entryTargets.some((target) => sameCompiledEntry(resolve(packageRoot, target), declarationFile))) {
    cache.set(cacheKey, null);
    return undefined;
  }

  const candidates = new Set<string>();
  const configPath = join(packageRoot, 'tsconfig.json');
  try {
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!config.error) {
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot);
      const rootDir = parsed.options.rootDir;
      const outDir = parsed.options.outDir;
      if (rootDir && outDir && isInside(outDir, declarationFile)) {
        addCollectedSourceCandidates(
          join(rootDir, relative(outDir, declarationFile)),
          collectedFiles,
          candidates,
        );
      }
    }
  } catch {
    // Fall through to the checked dist-to-src convention.
  }

  const packageRelative = relative(packageRoot, declarationFile);
  const segments = packageRelative.split(sep);
  if (segments[0]?.toLowerCase() === 'dist') {
    addCollectedSourceCandidates(
      join(packageRoot, 'src', ...segments.slice(1)),
      collectedFiles,
      candidates,
    );
  }

  const attributed = candidates.size === 1 ? [...candidates][0] : undefined;
  cache.set(cacheKey, attributed ?? null);
  return attributed;
}

function nearestPackageJson(start: string, projectRoot: string): string | undefined {
  let directory = canonicalPath(start);
  while (isInside(projectRoot, directory)) {
    const candidate = join(directory, 'package.json');
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Keep walking toward the project root.
    }
    if (directory === projectRoot) break;
    directory = dirname(directory);
  }
  return undefined;
}

function packageSubpath(specifier: string, packageName: string | undefined): string | undefined {
  if (!packageName) return undefined;
  if (specifier === packageName) return '.';
  if (specifier.startsWith(`${packageName}/`)) return `./${specifier.slice(packageName.length + 1)}`;
  return undefined;
}

function selectPackageExport(exportsValue: unknown, subpath: string): unknown {
  if (!isRecord(exportsValue)) return subpath === '.' ? exportsValue : undefined;
  const keys = Object.keys(exportsValue);
  if (!keys.some((key) => key.startsWith('.'))) return subpath === '.' ? exportsValue : undefined;
  if (Object.prototype.hasOwnProperty.call(exportsValue, subpath)) return exportsValue[subpath];

  for (const key of keys) {
    const wildcard = key.indexOf('*');
    if (wildcard < 0) continue;
    const prefix = key.slice(0, wildcard);
    const suffix = key.slice(wildcard + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    const matched = subpath.slice(prefix.length, subpath.length - suffix.length);
    return replacePackageTargetWildcard(exportsValue[key], matched);
  }
  return undefined;
}

function replacePackageTargetWildcard(value: unknown, matched: string): unknown {
  if (typeof value === 'string') return value.replaceAll('*', matched);
  if (Array.isArray(value)) return value.map((item) => replacePackageTargetWildcard(item, matched));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, replacePackageTargetWildcard(item, matched)]),
  );
}

function collectPackageTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectPackageTargets);
  if (!isRecord(value)) return [];
  return Object.values(value).flatMap(collectPackageTargets);
}

function sameCompiledEntry(left: string, right: string): boolean {
  return compiledEntryStem(canonicalPath(left)) === compiledEntryStem(canonicalPath(right));
}

function compiledEntryStem(path: string): string {
  if (isDeclarationFile(path)) return path.replace(/\.d\.[cm]?ts$/i, '');
  return path.slice(0, path.length - extname(path).length);
}

function addCollectedSourceCandidates(
  outputFile: string,
  collectedFiles: Set<string>,
  candidates: Set<string>,
): void {
  const stem = compiledEntryStem(outputFile);
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = canonicalPath(`${stem}${extension}`);
    if (collectedFiles.has(candidate)) candidates.add(candidate);
  }
}

function createConfigResolver(
  explicitTsconfigPath: string | undefined,
  projectRoot: string,
): ConfigResolver {
  const nearestByDirectory = new Map<string, ParsedConfig | undefined>();
  const parsedByPath = new Map<string, ParsedConfig | null>();
  const configFailures = new Map<string, ConfigFailure>();

  function recordFailure(path: string, reason: string): void {
    const canonical = canonicalPath(path);
    if (configFailures.has(canonical)) return;
    configFailures.set(canonical, {
      config: displayPath(canonical, projectRoot),
      reason,
    });
  }

  function parseConfig(path: string, followReferences: boolean): ParsedConfig | undefined {
    const canonical = canonicalPath(path);
    const cached = parsedByPath.get(canonical);
    if (cached !== undefined) return cached ?? undefined;

    let config: ReturnType<typeof ts.readConfigFile>;
    let parsed: ts.ParsedCommandLine;
    try {
      config = ts.readConfigFile(canonical, ts.sys.readFile);
      if (config.error) throw new Error(formatDiagnostic(config.error));
      parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(canonical));
      const optionErrors = parsed.errors.filter((diagnostic) => diagnostic.code !== 18003);
      if (optionErrors.length > 0) {
        throw new Error(optionErrors.map(formatDiagnostic).join('\n'));
      }
    } catch (error) {
      parsedByPath.set(canonical, null);
      recordFailure(canonical, error instanceof Error ? error.message : String(error));
      return undefined;
    }

    const ownPaths = parsed.options.paths;
    const hasOwnPaths = Boolean(ownPaths && Object.keys(ownPaths).length > 0);
    const result: ParsedConfig = {
      path: canonical,
      ownOptions: parsed.options,
      options: parsed.options,
      pathKeys: ownPaths ? Object.keys(ownPaths) : [],
      fileNames: new Set(parsed.fileNames.map(canonicalPath)),
      referencePaths: readConfigReferences(config.config, canonical),
      referencesMerged: hasOwnPaths,
      usedConfigPaths: [canonical],
    };
    // Insert before reading references so a malformed self-reference cannot recurse forever.
    parsedByPath.set(canonical, result);

    if (!followReferences || result.referencesMerged || result.referencePaths.length === 0) {
      return result;
    }
    result.referencesMerged = true;

    const mergedPaths: ts.MapLike<string[]> = {};
    for (const referencePath of result.referencePaths) {
      const referenced = parseConfig(referencePath, false);
      if (!referenced) continue;
      result.usedConfigPaths.push(referenced.path);
      const referencedPaths = referenced.ownOptions.paths ?? {};
      const pathsBase = pathsBaseFor(referenced.ownOptions, referenced.path);
      for (const [key, targets] of Object.entries(referencedPaths)) {
        if (Object.prototype.hasOwnProperty.call(mergedPaths, key)) continue;
        mergedPaths[key] = targets.map((target) =>
          isAbsolute(target) ? target : resolve(pathsBase, target),
        );
      }
    }

    if (Object.keys(mergedPaths).length > 0) {
      result.options = {
        ...result.ownOptions,
        baseUrl: result.ownOptions.baseUrl ?? dirname(canonical),
        paths: mergedPaths,
      };
      result.pathKeys = Object.keys(mergedPaths);
    }
    return result;
  }

  function nearestConfig(start: string, skipped = new Set<string>()): ParsedConfig | undefined {
    let directory = canonicalPath(start);
    const visited: string[] = [];
    let found: ParsedConfig | undefined;
    let useCache = skipped.size === 0;

    while (isInside(projectRoot, directory)) {
      if (useCache && nearestByDirectory.has(directory)) {
        found = nearestByDirectory.get(directory);
        break;
      }
      visited.push(directory);
      const candidate = join(directory, 'tsconfig.json');
      try {
        if (statSync(candidate).isFile()) {
          const canonical = canonicalPath(candidate);
          if (!skipped.has(canonical)) {
            found = parseConfig(canonical, true);
            if (found) break;
          }
        }
      } catch {
        // Keep walking toward the project root.
      }
      if (directory === projectRoot) break;
      directory = dirname(directory);
      useCache = false;
    }
    if (skipped.size === 0) {
      for (const item of visited) nearestByDirectory.set(item, found);
    }
    return found;
  }

  let explicit: ParsedConfig | undefined;
  if (explicitTsconfigPath) {
    explicit = parseConfig(explicitTsconfigPath, true);
    if (!explicit) {
      explicit = nearestConfig(dirname(explicitTsconfigPath), new Set([explicitTsconfigPath]));
    }
  }

  return {
    resolve(sourceFile) {
      const parsed = explicit ?? nearestConfig(dirname(sourceFile));
      if (!parsed) return { options: DEFAULT_COMPILER_OPTIONS, pathKeys: [], configPaths: [] };

      for (const referencePath of parsed.referencePaths) {
        const referenced = parseConfig(referencePath, false);
        if (!referenced || !referenced.fileNames.has(sourceFile)) continue;
        return {
          options: referenced.ownOptions,
          pathKeys: [...new Set([
            ...parsed.pathKeys,
            ...Object.keys(referenced.ownOptions.paths ?? {}),
          ])],
          configPaths: [parsed.path, referenced.path],
        };
      }
      return {
        options: parsed.options,
        pathKeys: parsed.pathKeys,
        configPaths: parsed.usedConfigPaths,
      };
    },
    failures() {
      return [...configFailures.values()].sort((left, right) =>
        compareText(left.config, right.config) || compareText(left.reason, right.reason),
      );
    },
  };
}

function readConfigReferences(config: unknown, configPath: string): string[] {
  if (!isRecord(config) || !Array.isArray(config.references)) return [];
  const references: string[] = [];
  for (const value of config.references) {
    if (!isRecord(value) || typeof value.path !== 'string') continue;
    const reference = resolve(dirname(configPath), value.path);
    try {
      references.push(canonicalPath(statSync(reference).isDirectory() ? join(reference, 'tsconfig.json') : reference));
    } catch {
      references.push(canonicalPath(join(reference, 'tsconfig.json')));
    }
  }
  return references;
}

function pathsBaseFor(options: ts.CompilerOptions, configPath: string): string {
  const withPathsBase = options as ts.CompilerOptions & { pathsBasePath?: string };
  return withPathsBase.pathsBasePath ?? options.baseUrl ?? dirname(configPath);
}

function collectWorkspacePackageNames(sourceFiles: string[], projectRoot: string): Set<string> {
  const nearestByDirectory = new Map<string, string | undefined>();
  const names = new Set<string>();

  function nearestPackageJson(start: string): string | undefined {
    let directory = start;
    const visited: string[] = [];
    let found: string | undefined;
    let previous = '';
    while (directory !== previous && isInside(projectRoot, directory)) {
      if (nearestByDirectory.has(directory)) {
        found = nearestByDirectory.get(directory);
        break;
      }
      visited.push(directory);
      const candidate = join(directory, 'package.json');
      try {
        if (statSync(candidate).isFile()) {
          found = candidate;
          break;
        }
      } catch {
        // Keep walking toward the project root.
      }
      previous = directory;
      directory = dirname(directory);
    }
    for (const item of visited) nearestByDirectory.set(item, found);
    return found;
  }

  const packageFiles = new Set<string>();
  for (const file of sourceFiles) {
    const packageFile = nearestPackageJson(dirname(file));
    if (packageFile) packageFiles.add(packageFile);
  }
  for (const packageFile of packageFiles) {
    try {
      const value: unknown = JSON.parse(readFileSync(packageFile, 'utf8'));
      if (isRecord(value) && typeof value.name === 'string' && value.name) names.add(value.name);
    } catch {
      // A malformed package.json should not stop TypeScript config resolution.
    }
  }
  return names;
}

function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name || !clause.namedBindings || ts.isNamespaceImport(clause.namedBindings))
    return false;
  return (
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((item) => item.isTypeOnly)
  );
}

function isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  return Boolean(
    node.exportClause &&
    ts.isNamedExports(node.exportClause) &&
    node.exportClause.elements.length > 0 &&
    node.exportClause.elements.every((item) => item.isTypeOnly),
  );
}

function scriptKindFor(file: string): ts.ScriptKind {
  const extension = extname(file);
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function displayPath(path: string, projectRoot: string): string {
  const rel = relative(projectRoot, path);
  return isInside(projectRoot, path) ? rel.split(sep).join('/') || '.' : path.split(sep).join('/');
}

function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function assertDirectory(path: string, label: string): void {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    throw new Error(`${label} does not exist: ${path}`);
  }
  if (!stat.isDirectory()) throw new Error(`${label} is not a directory: ${path}`);
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
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

function compareInternal(a: InternalImport, b: InternalImport): number {
  return compareEvidence(a, b) ||
    compareNullableText(a.fromModule, b.fromModule) ||
    compareNullableText(a.toModule, b.toModule);
}

function compareUnmapped(a: UnmappedImport, b: UnmappedImport): number {
  return compareNullableText(a.fromModule, b.fromModule) || compareEvidence(a, b);
}

function compareUnresolved(a: UnresolvedImport, b: UnresolvedImport): number {
  return (
    compareNullableText(a.fromModule, b.fromModule) ||
    compareText(a.fromFile, b.fromFile) ||
    a.line - b.line ||
    compareText(a.specifier, b.specifier) ||
    compareText(a.kind, b.kind) ||
    compareText(a.classification, b.classification)
  );
}

function compareNullableText(a: string | null, b: string | null): number {
  return compareText(a ?? '', b ?? '');
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
