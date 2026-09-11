import assert from "node:assert/strict";
import { execFile, execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	statSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
	acquireGitTransactionLock,
	captureGitPreflight,
	createGitTools,
	ProcessGitExecutor,
	validateCommitMessage,
	validateStagePaths,
	type GitExecutor,
	type GitResult,
} from "./git-tools.ts";

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function repository(): string {
	const cwd = mkdtempSync(join(tmpdir(), "pi-commit-test-"));
	git(cwd, ["init", "-q"]);
	git(cwd, ["config", "user.name", "Pi Commit Test"]);
	git(cwd, ["config", "user.email", "pi-commit@example.invalid"]);
	git(cwd, ["config", "commit.gpgsign", "false"]);
	writeFileSync(join(cwd, "tracked.txt"), "base\n");
	writeFileSync(join(cwd, "staged.txt"), "base\n");
	git(cwd, ["add", "--", "tracked.txt", "staged.txt"]);
	git(cwd, ["commit", "-q", "-m", "test: initial"]);
	return cwd;
}

function tool(tools: any[], name: string): any {
	const found = tools.find((entry) => entry.name === name);
	assert.ok(found, `${name} tool exists`);
	return found;
}

async function execute(definition: any, params: unknown = {}): Promise<any> {
	return definition.execute("test-call", params, undefined, undefined, {});
}

function waitForOutput(child: ChildProcessWithoutNullStreams, expected: string): Promise<string> {
	return new Promise((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => reject(new Error(`timed out waiting for ${expected}; stderr: ${stderr}`)), 30_000);
		const onStdout = (chunk: Buffer) => {
			stdout += chunk.toString();
			if (!stdout.includes(expected)) return;
			clearTimeout(timer);
			cleanup();
			resolve(stdout);
		};
		const onStderr = (chunk: Buffer) => { stderr += chunk.toString(); };
		const onExit = (code: number | null) => {
			clearTimeout(timer);
			cleanup();
			reject(new Error(`lock worker exited ${code} before ${expected}; stderr: ${stderr}`));
		};
		const cleanup = () => {
			child.stdout.off("data", onStdout);
			child.stderr.off("data", onStderr);
			child.off("exit", onExit);
		};
		child.stdout.on("data", onStdout);
		child.stderr.on("data", onStderr);
		child.once("exit", onExit);
	});
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
	if (child.exitCode !== null) {
		return child.exitCode === 0 ? Promise.resolve() : Promise.reject(new Error(`lock worker exited ${child.exitCode}`));
	}
	return new Promise((resolve, reject) => {
		child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`lock worker exited ${code}`)));
	});
}

function indexExecutor(indexPath: string): GitExecutor {
	return {
		async run(_cwd, args) {
			assert.deepEqual(args, ["rev-parse", "--git-path", "index"]);
			return { stdout: `${indexPath}\n`, stderr: "", code: 0 };
		},
	};
}

function environmentIndexExecutor(indexPath: string): GitExecutor {
	return {
		run(cwd, args, signal) {
			return new Promise((done) => {
				execFile("git", [...args], { cwd, encoding: "utf8", signal, env: { ...process.env, GIT_INDEX_FILE: indexPath } }, (error, stdout, stderr) => {
					const code = typeof (error as NodeJS.ErrnoException | null)?.code === "number"
						? (error as NodeJS.ErrnoException & { code: number }).code
						: error ? -1 : 0;
					done({ stdout: String(stdout ?? ""), stderr: String(stderr ?? error?.message ?? ""), code });
				});
			});
		},
	};
}

test("temp repository commit preserves staged work and adds tracked and untracked paths", async () => {
	const cwd = repository();
	writeFileSync(join(cwd, "tracked.txt"), "changed\n");
	writeFileSync(join(cwd, "staged.txt"), "already staged\n");
	git(cwd, ["add", "--", "staged.txt"]);
	writeFileSync(join(cwd, "untracked.txt"), "new\n");

	const executor = new ProcessGitExecutor();
	const preflight = await captureGitPreflight(cwd, executor);
	assert.match(preflight.status, /tracked\.txt/);
	assert.match(preflight.status, /staged\.txt/);
	assert.match(preflight.status, /untracked\.txt/);
	assert.match(preflight.cachedNames, /staged\.txt/);

	const controller = new AbortController();
	const created = createGitTools({ cwd, executor, preflight, operationSignal: controller.signal });
	assert.equal(tool(created.tools, "git_stage").executionMode, "sequential");
	assert.equal(tool(created.tools, "git_commit").executionMode, "sequential");
	const snapshot = await execute(tool(created.tools, "git_snapshot"));
	const snapshotText = snapshot.content[0].text;
	assert.match(snapshotText, /## status/);
	assert.match(snapshotText, /\?\? untracked\.txt/);
	assert.match(snapshotText, /## staged diff/);

	await execute(tool(created.tools, "git_stage"), { paths: ["tracked.txt", "untracked.txt"] });
	const result = await execute(tool(created.tools, "git_commit"), { message: "test: preserve selected index" });
	assert.equal(result.terminate, true);
	assert.deepEqual(result.details, created.state.committed);
	assert.equal(created.state.commitAttempts, 1);
	assert.equal(created.state.mutated, true);
	assert.match(created.state.committed?.hash ?? "", /^[0-9a-f]{12}$/);
	assert.equal(created.state.committed?.subject, "test: preserve selected index");

	const names = git(cwd, ["show", "--pretty=", "--name-only", "HEAD"]).trim().split("\n").sort();
	assert.deepEqual(names, ["staged.txt", "tracked.txt", "untracked.txt"]);
	assert.equal(git(cwd, ["status", "--short"]), "");
});

test("snapshot reserves an independent staged-diff budget when the unstaged diff is huge", async () => {
	const cwd = repository();
	writeFileSync(join(cwd, "tracked.txt"), `${"unstaged-data-".repeat(8_000)}\n`);
	writeFileSync(join(cwd, "staged.txt"), "must-see-staged-content\n");
	git(cwd, ["add", "--", "staged.txt"]);

	const executor = new ProcessGitExecutor();
	const preflight = await captureGitPreflight(cwd, executor);
	const created = createGitTools({ cwd, executor, preflight, operationSignal: new AbortController().signal });
	const snapshot = await execute(tool(created.tools, "git_snapshot"));
	const text = snapshot.content[0].text;
	assert.ok(Buffer.byteLength(text, "utf8") <= 48 * 1024);
	assert.match(text, /\[unstaged diff truncated\.\]/);
	assert.match(text, /## staged diff/);
	assert.match(text, /must-see-staged-content/);
});

test("rejecting hook freezes all later staging and leaves the attempted index intact", async () => {
	const cwd = repository();
	writeFileSync(join(cwd, "tracked.txt"), "blocked\n");
	const hooks = join(cwd, ".git", "hooks");
	mkdirSync(hooks, { recursive: true });
	const hook = join(hooks, "pre-commit");
	writeFileSync(hook, "#!/bin/sh\necho blocked by test hook >&2\nexit 1\n");
	chmodSync(hook, 0o755);

	const executor = new ProcessGitExecutor();
	const preflight = await captureGitPreflight(cwd, executor);
	const before = git(cwd, ["rev-parse", "HEAD"]).trim();
	const created = createGitTools({ cwd, executor, preflight, operationSignal: new AbortController().signal });
	await execute(tool(created.tools, "git_stage"), { paths: ["tracked.txt"] });
	await assert.rejects(
		execute(tool(created.tools, "git_commit"), { message: "test: hook must run" }),
		/blocked by test hook/,
	);
	writeFileSync(join(cwd, "extra.txt"), "must remain unstaged\n");
	await assert.rejects(
		execute(tool(created.tools, "git_stage"), { paths: ["extra.txt"] }),
		/staging is closed/,
	);
	assert.equal(git(cwd, ["rev-parse", "HEAD"]).trim(), before);
	assert.equal(git(cwd, ["diff", "--cached", "--name-only"]).trim(), "tracked.txt");
	assert.equal(created.state.committed, undefined);
	assert.equal(created.state.mutated, true);
	assert.match(created.state.lastFailure ?? "", /blocked by test hook/);
});

test("a live cross-process lock holder is refused and cannot union staged paths", async () => {
	const cwd = repository();
	writeFileSync(join(cwd, "first.txt"), "base\n");
	writeFileSync(join(cwd, "second.txt"), "base\n");
	git(cwd, ["add", "--", "first.txt", "second.txt"]);
	git(cwd, ["commit", "-q", "-m", "test: lock fixtures"]);
	writeFileSync(join(cwd, "first.txt"), "first change\n");
	writeFileSync(join(cwd, "second.txt"), "second change\n");

	const moduleUrl = pathToFileURL(join(process.cwd(), "pi/extensions/commit/git-tools.ts")).href;
	const childSource = `
		import { acquireGitTransactionLock, captureGitPreflight, createGitTools, ProcessGitExecutor } from ${JSON.stringify(moduleUrl)};
		const cwd = process.argv[1];
		const executor = new ProcessGitExecutor();
		await acquireGitTransactionLock(cwd, executor);
		const preflight = await captureGitPreflight(cwd, executor);
		const created = createGitTools({ cwd, executor, preflight, operationSignal: new AbortController().signal });
		const stage = created.tools.find((entry) => entry.name === "git_stage");
		const commit = created.tools.find((entry) => entry.name === "git_commit");
		await stage.execute("stage", { paths: ["first.txt"] }, undefined, undefined, {});
		process.stdout.write("staged\\n");
		process.stdin.once("data", async () => {
			await commit.execute("commit", { message: "test: isolated first commit" }, undefined, undefined, {});
			process.stdout.write("committed\\n", () => process.exit(0));
		});
		process.stdin.resume();
	`;
	const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", childSource, cwd], {
		stdio: ["pipe", "pipe", "pipe"],
	});

	try {
		await waitForOutput(child, "staged\n");
		const secondExecutor = new ProcessGitExecutor();
		const expectedLockPath = join(realpathSync(cwd), ".git", "index.pi-commit.lock");
		await assert.rejects(
			acquireGitTransactionLock(cwd, secondExecutor),
			(error: Error) => error.message === `the /commit lock exists at ${expectedLockPath}; clear it with: rm -- '${expectedLockPath}'`,
		);
		const committed = waitForOutput(child, "committed\n");
		child.stdin.write("continue\n");
		await committed;
		await waitForExit(child);

		assert.deepEqual(git(cwd, ["show", "--pretty=", "--name-only", "HEAD"]).trim().split("\n"), ["first.txt"]);
		assert.equal(git(cwd, ["status", "--short", "--", "second.txt"]).trim(), "M second.txt");
		assert.equal(existsSync(expectedLockPath), true, "a process exit leaves an operator-owned cleanup task");
		await assert.rejects(acquireGitTransactionLock(cwd, secondExecutor), /clear it with: rm --/);
		unlinkSync(expectedLockPath);
		const nextLock = await acquireGitTransactionLock(cwd, secondExecutor);
		await nextLock.release();
		assert.equal(existsSync(expectedLockPath), false);
	} finally {
		if (child.exitCode === null) child.kill();
		const lockPath = join(realpathSync(cwd), ".git", "index.pi-commit.lock");
		if (existsSync(lockPath)) unlinkSync(lockPath);
	}
});

test("a synchronized multi-process acquisition race has exactly one winner", async () => {
	const cwd = repository();
	const moduleUrl = pathToFileURL(join(process.cwd(), "pi/extensions/commit/git-tools.ts")).href;
	const childSource = `
		import { acquireGitTransactionLock, ProcessGitExecutor } from ${JSON.stringify(moduleUrl)};
		const cwd = process.argv[1];
		process.stdout.write("READY\\n");
		process.stdin.once("data", async () => {
			try {
				const lock = await acquireGitTransactionLock(cwd, new ProcessGitExecutor());
				process.stdout.write("RESULT=ACQUIRED\\n");
				process.stdin.once("data", async () => {
					await lock.release();
					process.exit(0);
				});
			} catch (error) {
				process.stdout.write("RESULT=REJECTED\\n", () => process.exit(0));
			}
		});
		process.stdin.resume();
	`;
	const children = Array.from({ length: 24 }, () => spawn(
		process.execPath,
		["--experimental-strip-types", "--input-type=module", "-e", childSource, cwd],
		{ stdio: ["pipe", "pipe", "pipe"] },
	));

	try {
		await Promise.all(children.map((child) => waitForOutput(child, "READY\n")));
		const results = children.map((child) => waitForOutput(child, "RESULT="));
		for (const child of children) child.stdin.write("go\n");
		const output = await Promise.all(results);
		const winners = output.map((value, index) => value.includes("RESULT=ACQUIRED") ? index : -1).filter((index) => index >= 0);
		assert.equal(winners.length, 1);
		children[winners[0]].stdin.write("release\n");
		await Promise.all(children.map(waitForExit));
		assert.equal(existsSync(join(realpathSync(cwd), ".git", "index.pi-commit.lock")), false);
	} finally {
		for (const child of children) if (child.exitCode === null) child.kill();
	}
});

test("every leftover lock is refused immediately with an exact cleanup command", async () => {
	const cwd = repository();
	const executor = new ProcessGitExecutor();
	const probe = await acquireGitTransactionLock(cwd, executor);
	const { lockPath } = probe;
	await probe.release();

	for (const contents of ["", "{\"pid\":", `${JSON.stringify({ pid: 999_999, createdAt: "old" })}\n`]) {
		writeFileSync(lockPath, contents, { flag: "wx" });
		const started = Date.now();
		await assert.rejects(
			acquireGitTransactionLock(cwd, executor),
			(error: Error) => error.message === `the /commit lock exists at ${lockPath}; clear it with: rm -- '${lockPath}'`,
		);
		assert.ok(Date.now() - started < 500, "contention must not wait or inspect holder data");
		assert.equal(readFileSync(lockPath, "utf8"), contents);
		unlinkSync(lockPath);
	}
});

test("aliases of one existing index resolve to the same lock", async () => {
	const cwd = repository();
	const indexPath = join(cwd, ".git", "index");
	const aliasA = join(cwd, "index-alias-a");
	const aliasB = join(cwd, "index-alias-b");
	symlinkSync(indexPath, aliasA);
	symlinkSync(indexPath, aliasB);
	const first = await acquireGitTransactionLock(cwd, indexExecutor(aliasA));

	try {
		assert.equal(first.indexPath, realpathSync(indexPath));
		await assert.rejects(acquireGitTransactionLock(cwd, indexExecutor(aliasB)), /the \/commit lock exists/);
	} finally {
		await first.release();
	}
});

test("two processes resolve dangling aliases of one absent index to the same lock", async () => {
	const cwd = repository();
	const missingIndex = join(cwd, "missing-index");
	const chainA = join(cwd, "missing-index-chain-a");
	const chainB = join(cwd, "missing-index-chain-b");
	const aliasA = join(cwd, "missing-index-alias-a");
	const aliasB = join(cwd, "missing-index-alias-b");
	symlinkSync(missingIndex, chainA);
	symlinkSync(missingIndex, chainB);
	symlinkSync(chainA, aliasA);
	symlinkSync(chainB, aliasB);
	const moduleUrl = pathToFileURL(join(process.cwd(), "pi/extensions/commit/git-tools.ts")).href;
	const childSource = `
		import { acquireGitTransactionLock } from ${JSON.stringify(moduleUrl)};
		const cwd = process.argv[1];
		const indexPath = process.argv[2];
		const executor = { async run() { return { stdout: indexPath + "\\n", stderr: "", code: 0 }; } };
		const lock = await acquireGitTransactionLock(cwd, executor);
		process.stdout.write("LOCKED=" + lock.indexPath + "\\n");
		process.stdin.once("data", async () => {
			await lock.release();
			process.exit(0);
		});
		process.stdin.resume();
	`;
	const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", childSource, cwd, aliasA], {
		stdio: ["pipe", "pipe", "pipe"],
	});

	try {
		const output = await waitForOutput(child, "LOCKED=");
		assert.equal(output, `LOCKED=${join(realpathSync(cwd), "missing-index")}\n`);
		await assert.rejects(acquireGitTransactionLock(cwd, indexExecutor(aliasB)), /the \/commit lock exists/);
		assert.equal(existsSync(missingIndex), false);
		child.stdin.write("release\n");
		await waitForExit(child);
		assert.equal(existsSync(`${missingIndex}.pi-commit.lock`), false);
	} finally {
		if (child.exitCode === null) child.kill();
		const lockPath = `${missingIndex}.pi-commit.lock`;
		if (existsSync(lockPath)) unlinkSync(lockPath);
	}
});

test("a dangling index symlink loop is rejected", async () => {
	const cwd = repository();
	const aliasA = join(cwd, "loop-a");
	const aliasB = join(cwd, "loop-b");
	symlinkSync(aliasB, aliasA);
	symlinkSync(aliasA, aliasB);
	await assert.rejects(acquireGitTransactionLock(cwd, indexExecutor(aliasA)), /Git index symlink loop/);
});

test("canonical index identity covers subdirectories, linked worktrees, and GIT_INDEX_FILE", async () => {
	const cwd = repository();
	const executor = new ProcessGitExecutor();
	const subdirectory = join(cwd, "nested");
	mkdirSync(subdirectory);
	const rootLock = await acquireGitTransactionLock(cwd, executor);
	try {
		await assert.rejects(acquireGitTransactionLock(subdirectory, executor), /the \/commit lock exists/);
	} finally {
		await rootLock.release();
	}

	const linkedWorktree = `${cwd}-linked-worktree`;
	git(cwd, ["worktree", "add", "-q", "-b", "linked-test", linkedWorktree]);
	mkdirSync(join(linkedWorktree, "nested"));
	const linkedLock = await acquireGitTransactionLock(join(linkedWorktree, "nested"), executor);
	const linkedIndex = git(linkedWorktree, ["rev-parse", "--git-path", "index"]).trim();
	assert.equal(linkedLock.indexPath, realpathSync(resolve(linkedWorktree, linkedIndex)));
	const independentMainLock = await acquireGitTransactionLock(cwd, executor);
	await independentMainLock.release();
	await linkedLock.release();

	const customIndex = join(cwd, "custom-index");
	copyFileSync(join(cwd, ".git", "index"), customIndex);
	const customLock = await acquireGitTransactionLock(cwd, environmentIndexExecutor(customIndex));
	assert.equal(customLock.indexPath, realpathSync(customIndex));
	await customLock.release();

	const missingIndex = join(cwd, "missing-index");
	const missingLock = await acquireGitTransactionLock(cwd, environmentIndexExecutor(missingIndex));
	assert.equal(missingLock.indexPath, join(realpathSync(cwd), "missing-index"));
	await missingLock.release();
});

test("an existing lock in a read-only Git directory still reports the exact cleanup command", async () => {
	const cwd = repository();
	const executor = new ProcessGitExecutor();
	const probe = await acquireGitTransactionLock(cwd, executor);
	const { lockPath } = probe;
	await probe.release();
	writeFileSync(lockPath, "leftover\n", { flag: "wx" });
	const gitDirectory = dirname(lockPath);
	const originalMode = statSync(gitDirectory).mode & 0o777;
	chmodSync(gitDirectory, 0o555);

	try {
		await assert.rejects(
			acquireGitTransactionLock(cwd, executor),
			(error: Error) => error.message === `the /commit lock exists at ${lockPath}; clear it with: rm -- '${lockPath}'`,
		);
		const tempPrefix = `${basename(lockPath)}.`;
		assert.deepEqual(readdirSync(gitDirectory).filter((name) => name.startsWith(tempPrefix) && name.endsWith(".tmp")), []);
	} finally {
		chmodSync(gitDirectory, originalMode);
		if (existsSync(lockPath)) unlinkSync(lockPath);
	}
});

test("the published holder file is always complete and leaves no temporary file", async () => {
	const cwd = repository();
	const executor = new ProcessGitExecutor();
	const probe = await acquireGitTransactionLock(cwd, executor);
	const { lockPath } = probe;
	await probe.release();
	const moduleUrl = pathToFileURL(join(process.cwd(), "pi/extensions/commit/git-tools.ts")).href;
	const childSource = `
		import { acquireGitTransactionLock, ProcessGitExecutor } from ${JSON.stringify(moduleUrl)};
		const cwd = process.argv[1];
		for (let index = 0; index < 100; index += 1) {
			const lock = await acquireGitTransactionLock(cwd, new ProcessGitExecutor());
			await new Promise((resolve) => setTimeout(resolve, 2));
			await lock.release();
		}
	`;
	const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", childSource, cwd], {
		stdio: ["pipe", "pipe", "pipe"],
	});
	let observed = 0;

	while (child.exitCode === null) {
		try {
			const contents = readFileSync(lockPath, "utf8");
			assert.ok(contents.endsWith("\n"));
			const holder = JSON.parse(contents);
			assert.ok(Number.isSafeInteger(holder.pid) && holder.pid > 0);
			assert.match(holder.createdAt, /^\d{4}-\d{2}-\d{2}T/);
			observed += 1;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	await waitForExit(child);
	assert.ok(observed > 0, "observer must see at least one published holder");
	assert.equal(existsSync(lockPath), false);
	const tempPrefix = `${lockPath.slice(lockPath.lastIndexOf("/") + 1)}.`;
	assert.deepEqual(readdirSync(join(cwd, ".git")).filter((name) => name.startsWith(tempPrefix) && name.endsWith(".tmp")), []);
});

test("release refuses to unlink a replacement lock", async () => {
	const cwd = repository();
	const lock = await acquireGitTransactionLock(cwd, new ProcessGitExecutor());
	unlinkSync(lock.lockPath);
	writeFileSync(lock.lockPath, "replacement\n", { flag: "wx" });

	await assert.rejects(lock.release(), /changed owners before release/);
	assert.equal(readFileSync(lock.lockPath, "utf8"), "replacement\n");
	unlinkSync(lock.lockPath);
});

test("refuses when HEAD moves before a mutation", async () => {
	const cwd = repository();
	writeFileSync(join(cwd, "tracked.txt"), "first change\n");
	const executor = new ProcessGitExecutor();
	const preflight = await captureGitPreflight(cwd, executor);

	writeFileSync(join(cwd, "staged.txt"), "other process\n");
	git(cwd, ["add", "--", "staged.txt"]);
	git(cwd, ["commit", "-q", "-m", "test: concurrent head"]);

	const created = createGitTools({ cwd, executor, preflight, operationSignal: new AbortController().signal });
	await assert.rejects(execute(tool(created.tools, "git_stage"), { paths: ["tracked.txt"] }), /HEAD moved/);
	assert.equal(created.state.mutated, false);
});

test("path and message validation blocks pathspec and control injection", async () => {
	const cwd = "/repo";
	for (const paths of [
		[], ["."], ["../outside"], ["/absolute"], ["C:\\absolute"], ["-A"], [":(top)"], ["*.ts"], ["bad\npath"],
	]) {
		assert.throws(() => validateStagePaths(paths, cwd));
	}
	assert.deepEqual(validateStagePaths(["@src/file.ts", "name;touch-pwn"], cwd), ["src/file.ts", "name;touch-pwn"]);
	assert.throws(() => validateCommitMessage(""));
	assert.throws(() => validateCommitMessage(" padded "));
	assert.throws(() => validateCommitMessage("line one\nline two"));
	assert.throws(() => validateCommitMessage("line one\u2028line two"));
	assert.throws(() => validateCommitMessage("x".repeat(201)));
	assert.equal(validateCommitMessage("test: safe; $(touch nope)"), "test: safe; $(touch nope)");

	class RecordingExecutor implements GitExecutor {
		calls: string[][] = [];
		head = "1111111111111111111111111111111111111111";
		async run(_cwd: string, args: readonly string[]): Promise<GitResult> {
			this.calls.push([...args]);
			if (args[0] === "rev-parse" && args[1] === "--verify") return { stdout: `${this.head}\n`, stderr: "", code: 0 };
			if (args[0] === "diff" && args.includes("--quiet")) return { stdout: "", stderr: "", code: 1 };
			if (args[0] === "commit") {
				this.head = "abcdef1234567890abcdef1234567890abcdef12";
				return { stdout: "", stderr: "", code: 0 };
			}
			if (args[0] === "rev-parse" && String(args[1]).startsWith("--short")) return { stdout: "abcdef123456\n", stderr: "", code: 0 };
			if (args[0] === "log") return { stdout: "test: safe; $(touch nope)\n", stderr: "", code: 0 };
			return { stdout: "", stderr: "", code: 0 };
		}
	}
	const executor = new RecordingExecutor();
	const created = createGitTools({
		cwd,
		executor,
		preflight: { head: executor.head, status: "", cachedNames: "" },
		operationSignal: new AbortController().signal,
	});
	await execute(tool(created.tools, "git_stage"), { paths: ["name;touch-pwn"] });
	await execute(tool(created.tools, "git_commit"), { message: "test: safe; $(touch nope)" });
	assert.ok(executor.calls.some((args) => JSON.stringify(args) === JSON.stringify(["add", "--", "name;touch-pwn"])));
	assert.ok(executor.calls.some((args) => JSON.stringify(args) === JSON.stringify(["commit", "-m", "test: safe; $(touch nope)"])));
});

class EmptyExecutor implements GitExecutor {
	async run(_cwd: string, args: readonly string[]): Promise<GitResult> {
		if (args[0] === "rev-parse") return { stdout: "1111111111111111111111111111111111111111\n", stderr: "", code: 0 };
		return { stdout: "", stderr: "", code: 0 };
	}
}

test("an invalid commit message preserves the index but freezes staging", async () => {
	const executor = new EmptyExecutor();
	const created = createGitTools({
		cwd: "/repo",
		executor,
		preflight: { head: "1111111111111111111111111111111111111111", status: "", cachedNames: "" },
		operationSignal: new AbortController().signal,
	});
	await assert.rejects(execute(tool(created.tools, "git_commit"), { message: " padded " }), /trimmed/);
	assert.equal(created.state.commitAttempts, 1);
	assert.equal(created.state.mutated, false);
	assert.equal(created.state.retryableWithoutMutation, true);
	await assert.rejects(execute(tool(created.tools, "git_stage"), { paths: ["file.ts"] }), /staging is closed/);
});

test("commit refuses an empty index and can only be attempted once", async () => {
	const executor = new EmptyExecutor();
	const created = createGitTools({
		cwd: "/repo",
		executor,
		preflight: { head: "1111111111111111111111111111111111111111", status: "", cachedNames: "" },
		operationSignal: new AbortController().signal,
	});
	const commit = tool(created.tools, "git_commit");
	await assert.rejects(execute(commit, { message: "test: empty" }), /no staged changes/);
	await assert.rejects(execute(commit, { message: "test: again" }), /only once/);
	assert.equal(created.state.commitAttempts, 2);
});
