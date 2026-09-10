import { appendFileSync } from "node:fs";
import { acquireFileLock } from "./locking.ts";
import { TaskService } from "./service.ts";
import { taskMutationLockPath } from "./storage.ts";

const [cwd, taskId, operation, value] = process.argv.slice(2);
if (!cwd || !taskId || !operation || value === undefined) throw new Error("Missing concurrency worker arguments.");
const service = new TaskService(cwd);
const task = service.getById(taskId);

if (operation === "append") {
	service.append(task.path, { type: "context", text: value, session: `p${process.pid}` });
} else if (operation === "status") {
	service.changeStatus(task.path, value === "paused" ? "paused" : "active");
} else if (operation === "continue") {
	const continuation = service.continueTask({ request: value });
	process.stdout.write(continuation?.task.id ?? "none");
} else if (operation === "references") {
	service.addReference(task.path, value);
} else if (operation === "crash-lock") {
	acquireFileLock(taskMutationLockPath(task.path));
	process.exit(17);
} else if (operation === "recover-probe") {
	const lock = acquireFileLock(taskMutationLockPath(task.path), { staleMs: 0 });
	appendFileSync(value, `start:${process.pid}\n`);
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
	appendFileSync(value, `end:${process.pid}\n`);
	lock.release();
} else {
	throw new Error(`Unknown concurrency worker operation: ${operation}`);
}
