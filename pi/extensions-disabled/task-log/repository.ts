import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { atomicWriteFile, withFileLock } from "./locking.ts";

export interface RepositoryWorktree {
	root: string;
	gitDir: string;
}

export interface RepositoryIdentity {
	id: string;
	root: string;
	commonDir: string;
	gitDir: string;
	branch: string;
	worktree: string;
	worktrees: RepositoryWorktree[];
	storeDir: string;
	tasksDir: string;
	legacyTaskDirs: string[];
}

export class UnsupportedRepositoryError extends Error {
	readonly cwd: string;

	constructor(cwd: string) {
		super(`Task log requires a Git repository: ${cwd}`);
		this.name = "UnsupportedRepositoryError";
		this.cwd = cwd;
	}
}

export class RepositoryResolutionError extends Error {
	readonly cwd: string;

	constructor(message: string, cwd: string) {
		super(`${message}: ${cwd}`);
		this.name = "RepositoryResolutionError";
		this.cwd = cwd;
	}
}

function git(cwd: string, args: string[], allowFailure = false): string {
	const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
	if (result.status !== 0) {
		if (allowFailure) return "";
		throw new RepositoryResolutionError(result.stderr.trim() || `git ${args.join(" ")} failed`, cwd);
	}
	return result.stdout.trim();
}

function absoluteGitPath(cwd: string, value: string): string {
	const path = isAbsolute(value) ? value : resolve(cwd, value);
	return realpathSync(path);
}

function readWorktrees(cwd: string): RepositoryWorktree[] {
	const output = git(cwd, ["worktree", "list", "--porcelain", "-z"]);
	const roots = output
		.split("\0")
		.filter((line) => line.startsWith("worktree "))
		.map((line) => line.slice("worktree ".length));
	const worktrees: RepositoryWorktree[] = [];
	for (const candidate of new Set(roots)) {
		try {
			const root = realpathSync(candidate);
			worktrees.push({ root, gitDir: absoluteGitPath(root, git(root, ["rev-parse", "--git-dir"])) });
		} catch {}
	}
	return worktrees;
}

function legacyTaskDirectories(root: string): string[] {
	const found: string[] = [];
	const pending = [root];
	while (pending.length > 0) {
		const directory = pending.pop()!;
		if (directory !== root && existsSync(join(directory, ".git"))) continue;
		let entries;
		try { entries = readdirSync(directory, { withFileTypes: true }); }
		catch { continue; }
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name === ".git") continue;
			const child = join(directory, entry.name);
			if (entry.name === ".pi") {
				if (existsSync(join(child, "tasks"))) found.push(join(child, "tasks"));
				continue;
			}
			pending.push(child);
		}
	}
	return found;
}

function readRepositoryId(path: string): string {
	const id = readFileSync(path, "utf8").trim();
	if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
		throw new RepositoryResolutionError("Repository identity file is malformed", path);
	}
	return id;
}

function createRepositoryId(path: string): string {
	mkdirSync(dirname(path), { recursive: true });
	if (existsSync(path)) return readRepositoryId(path);
	return withFileLock(`${path}.lock`, () => {
		if (!existsSync(path)) atomicWriteFile(path, `${randomUUID()}\n`);
		return readRepositoryId(path);
	});
}

export function resolveRepository(cwd: string): RepositoryIdentity {
	const start = resolve(cwd);
	if (!existsSync(start) || git(start, ["rev-parse", "--is-inside-work-tree"], true) !== "true") {
		throw new UnsupportedRepositoryError(start);
	}
	const workingDirectory = realpathSync(start);
	const root = realpathSync(git(workingDirectory, ["rev-parse", "--show-toplevel"]));
	const commonDir = absoluteGitPath(workingDirectory, git(workingDirectory, ["rev-parse", "--git-common-dir"]));
	const gitDir = absoluteGitPath(workingDirectory, git(workingDirectory, ["rev-parse", "--git-dir"]));
	const branch = git(workingDirectory, ["symbolic-ref", "--quiet", "--short", "HEAD"], true) || "(detached)";
	const storeDir = join(commonDir, "pi", "task-log");
	const id = createRepositoryId(join(storeDir, "repository-id"));
	const worktrees = readWorktrees(workingDirectory);
	const legacyTaskDirs = [...new Set(worktrees.flatMap((candidate) => legacyTaskDirectories(candidate.root)))];
	return {
		id,
		root,
		commonDir,
		gitDir,
		branch,
		worktree: root,
		worktrees,
		storeDir,
		tasksDir: join(storeDir, "tasks"),
		legacyTaskDirs,
	};
}
