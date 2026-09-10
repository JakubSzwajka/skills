import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { decodeTask, encodeNewTask, type Task } from "./codec.ts";
import { atomicWriteFile, withFileLock } from "./locking.ts";
import { resolveRepository, UnsupportedRepositoryError, type RepositoryIdentity } from "./repository.ts";

interface TaskSource {
	path: string;
	raw: Buffer;
	hash: string;
	origin?: string;
	task: Task;
	canonical: boolean;
}

// Worktree-relative origins distinguish accepted legacy files from later stale copies with the same bytes.
interface MigrationManifest {
	version: 2;
	legacyOrigins: Record<string, Record<string, string>>;
}

export class DuplicateTaskIdConflict extends Error {
	readonly taskId: string;
	readonly paths: string[];

	constructor(taskId: string, paths: string[]) {
		super(`Task ID "${taskId}" has divergent files and requires an explicit merge choice:\n${paths.join("\n")}`);
		this.name = "DuplicateTaskIdConflict";
		this.taskId = taskId;
		this.paths = paths;
	}
}

export class InvalidTaskIdentityError extends Error {
	readonly path: string;

	constructor(path: string) {
		super(`Task file has no ID and cannot be moved to canonical repository storage: ${path}`);
		this.name = "InvalidTaskIdentityError";
		this.path = path;
	}
}

function markdownFiles(directory: string): string[] {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => join(directory, entry.name));
}

function legacyOrigin(repository: RepositoryIdentity, path: string): string {
	const worktree = repository.worktrees
		.filter((candidate) => isPathInside(candidate.root, path))
		.sort((a, b) => b.root.length - a.root.length)[0];
	if (!worktree) return `unassociated:${path}`;
	return `${relative(repository.commonDir, worktree.gitDir)}:${relative(worktree.root, path)}`;
}

function sources(repository: RepositoryIdentity): TaskSource[] {
	const directories = [repository.tasksDir, ...repository.legacyTaskDirs];
	const paths = [...new Set(directories.flatMap(markdownFiles))].sort();
	return paths.map((path) => {
		const raw = readFileSync(path);
		const canonical = isPathInside(repository.tasksDir, path);
		return {
			path,
			raw,
			hash: createHash("sha256").update(raw).digest("hex"),
			...(canonical ? {} : { origin: legacyOrigin(repository, path) }),
			task: decodeTask(raw.toString("utf8"), path),
			canonical,
		};
	});
}

function isPathInside(directory: string, path: string): boolean {
	const child = relative(directory, path);
	return child === "" || (child !== ".." && !child.startsWith(`..${sep}`));
}

function groupedById(all: TaskSource[]): Map<string, TaskSource[]> {
	const groups = new Map<string, TaskSource[]>();
	for (const source of all) {
		if (!source.task.id) throw new InvalidTaskIdentityError(source.path);
		const group = groups.get(source.task.id) ?? [];
		group.push(source);
		groups.set(source.task.id, group);
	}
	return groups;
}

function assertSameBytes(id: string, group: TaskSource[]): void {
	if (group.length < 2) return;
	const first = group[0].raw;
	if (group.some((candidate) => !candidate.raw.equals(first))) {
		throw new DuplicateTaskIdConflict(id, group.map((candidate) => candidate.path));
	}
}

function emptyManifest(): MigrationManifest {
	return { version: 2, legacyOrigins: Object.create(null) as Record<string, Record<string, string>> };
}

function readManifest(path: string): MigrationManifest {
	if (!existsSync(path)) return emptyManifest();
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { version?: number; legacyOrigins?: unknown };
		if (parsed.version === 1) return emptyManifest();
		if (parsed.version !== 2 || !parsed.legacyOrigins || typeof parsed.legacyOrigins !== "object" || Array.isArray(parsed.legacyOrigins)) {
			throw new Error("invalid shape");
		}
		const legacyOrigins = Object.create(null) as Record<string, Record<string, string>>;
		for (const [id, origins] of Object.entries(parsed.legacyOrigins)) {
			if (!origins || typeof origins !== "object" || Array.isArray(origins)) throw new Error("invalid origins");
			const safeOrigins = Object.create(null) as Record<string, string>;
			for (const [origin, hash] of Object.entries(origins)) {
				if (typeof hash !== "string") throw new Error("invalid hash");
				safeOrigins[origin] = hash;
			}
			legacyOrigins[id] = safeOrigins;
		}
		return { version: 2, legacyOrigins };
	} catch (error) {
		throw new Error(`Task migration manifest is malformed: ${path} (${error instanceof Error ? error.message : String(error)})`);
	}
}

function knownLegacyHash(manifest: MigrationManifest, id: string, origin: string | undefined): string | undefined {
	if (!origin || !Object.hasOwn(manifest.legacyOrigins, id)) return undefined;
	const origins = manifest.legacyOrigins[id];
	return Object.hasOwn(origins, origin) ? origins[origin] : undefined;
}

function assertNoConflicts(groups: Map<string, TaskSource[]>, manifest: MigrationManifest): void {
	for (const [id, group] of groups) {
		const canonical = group.filter((candidate) => candidate.canonical);
		assertSameBytes(id, canonical);
		const unknownLegacy = group.filter((candidate) => candidate.canonical || knownLegacyHash(manifest, id, candidate.origin) !== candidate.hash);
		assertSameBytes(id, canonical.length > 0 ? unknownLegacy : group.filter((candidate) => !candidate.canonical));
	}
}

function recordLegacyOrigin(manifest: MigrationManifest, id: string, origin: string, hash: string): boolean {
	const origins = Object.hasOwn(manifest.legacyOrigins, id)
		? manifest.legacyOrigins[id]
		: Object.create(null) as Record<string, string>;
	if (origins[origin] === hash) return false;
	origins[origin] = hash;
	manifest.legacyOrigins[id] = origins;
	return true;
}

function canonicalFileName(task: Task): string {
	const title = task.title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40)
		.replace(/-+$/g, "") || "task";
	const identity = createHash("sha256").update(task.id).digest("hex").slice(0, 12);
	return `${title}-${identity}.md`;
}

function migrate(repository: RepositoryIdentity): TaskSource[] {
	mkdirSync(repository.tasksDir, { recursive: true });
	return withFileLock(join(repository.storeDir, "migration.lock"), () => {
		const manifestPath = join(repository.storeDir, "migration-manifest.json");
		const manifest = readManifest(manifestPath);
		const groups = groupedById(sources(repository));

		assertNoConflicts(groups, manifest);

		let manifestChanged = false;
		for (const [id, group] of groups) {
			let canonical = group.find((candidate) => candidate.canonical);
			if (!canonical) {
				const source = group[0];
				const destination = join(repository.tasksDir, canonicalFileName(source.task));
				if (existsSync(destination)) {
					const existing = readFileSync(destination);
					if (!existing.equals(source.raw)) throw new DuplicateTaskIdConflict(id, [source.path, destination]);
				} else {
					atomicWriteFile(destination, source.raw);
				}
				canonical = { ...source, path: destination, canonical: true };
			}
			for (const legacy of group.filter((candidate) => !candidate.canonical)) {
				if (!legacy.origin) continue;
				if (!canonical.raw.equals(legacy.raw) && knownLegacyHash(manifest, id, legacy.origin) !== legacy.hash) continue;
				if (recordLegacyOrigin(manifest, id, legacy.origin, legacy.hash)) manifestChanged = true;
			}
		}
		if (manifestChanged) atomicWriteFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

		const migratedGroups = groupedById(sources(repository));
		assertNoConflicts(migratedGroups, manifest);
		return [...migratedGroups.values()].map((group) => {
			const canonical = group.filter((candidate) => candidate.canonical);
			assertSameBytes(group[0].task.id, canonical);
			return canonical[0] ?? group[0];
		});
	});
}

export function repositoryTasks(cwd: string): { repository: RepositoryIdentity; tasks: Task[] } {
	const repository = resolveRepository(cwd);
	const tasks = migrate(repository).map((source) => decodeTask(source.raw.toString("utf8"), source.path));
	return { repository, tasks };
}

export function canonicalTasksDir(cwd: string): string {
	return resolveRepository(cwd).tasksDir;
}

export function findTaskById(cwd: string, taskId: string): { repository: RepositoryIdentity; task: Task } | undefined {
	const resolved = repositoryTasks(cwd);
	const task = resolved.tasks.find((candidate) => candidate.id === taskId);
	return task ? { repository: resolved.repository, task } : undefined;
}

export function createCanonicalTask(cwd: string, title: string, description: string, created: string): Task {
	const repository = resolveRepository(cwd);
	mkdirSync(repository.tasksDir, { recursive: true });
	return withFileLock(join(repository.storeDir, "create.lock"), () => {
		migrate(repository);
		const id = `t-${randomUUID()}`;
		const draft = decodeTask(encodeNewTask(id, title, created, description), "draft.md");
		const path = join(repository.tasksDir, canonicalFileName(draft));
		atomicWriteFile(path, encodeNewTask(id, title, created, description));
		return decodeTask(readFileSync(path, "utf8"), path);
	});
}

function canonicalizePotentialPath(path: string, visited = new Set<string>()): string {
	const absolute = resolve(path);
	if (visited.has(absolute)) throw new Error(`Symlink cycle while resolving task path: ${path}`);
	visited.add(absolute);

	const root = resolve(absolute, "/");
	const parts = relative(root, absolute).split(sep).filter(Boolean);
	let cursor = realpathSync(root);
	for (let index = 0; index < parts.length; index++) {
		const candidate = join(cursor, parts[index]);
		try {
			const metadata = lstatSync(candidate);
			if (metadata.isSymbolicLink()) {
				const target = resolve(dirname(candidate), readlinkSync(candidate));
				return canonicalizePotentialPath(join(target, ...parts.slice(index + 1)), visited);
			}
			cursor = candidate;
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") {
				return resolve(cursor, ...parts.slice(index));
			}
			throw error;
		}
	}
	return realpathSync(cursor);
}

export function isRepositoryTaskPath(cwd: string, path: string): boolean {
	try {
		const repository = resolveRepository(cwd);
		const directories = [repository.tasksDir, ...repository.legacyTaskDirs];
		if (directories.some((directory) => isPathInside(directory, path))) return true;
		const canonicalPath = canonicalizePotentialPath(path);
		return directories.some((directory) => isPathInside(canonicalizePotentialPath(directory), canonicalPath));
	} catch (error) {
		if (error instanceof UnsupportedRepositoryError) return false;
		return true;
	}
}

export function taskMutationLockPath(path: string): string {
	return join(dirname(path), `.${basename(path)}.mutation.lock`);
}
