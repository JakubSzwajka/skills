import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { appendSpecLog, transitionStatus } from "../progress.ts";
import { describeSpec } from "../discovery.ts";

const [operation, root, folder, value, barrier] = process.argv.slice(2);
const record = describeSpec(folder, root);
if (record.kind !== "spec") throw new Error(record.error);

if (operation === "lock" || operation === "orphan-lock") {
	const owner = {
		version: 1,
		token: randomUUID(),
		pid: process.pid,
		startedAt: Math.floor((Date.now() - process.uptime() * 1_000) / 1_000),
		ticket: 1,
	};
	const path = join(root, `.${basename(folder)}.status.lock.${owner.pid}.${owner.startedAt}.${owner.token}`);
	writeFileSync(path, `${JSON.stringify(owner)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
	writeFileSync(`${barrier}.${process.pid}.ready`, "");
	if (operation === "orphan-lock") process.exit(0);
	while (!existsSync(barrier)) await delay(1);
	unlinkSync(path);
	process.stdout.write(JSON.stringify({ path }));
} else {
	writeFileSync(`${barrier}.${process.pid}.ready`, "");
	while (!existsSync(barrier)) await delay(1);
	if (operation === "status") {
		const result = transitionStatus(record, "done", root, Number(value));
		process.stdout.write(JSON.stringify({ changed: result.changed, completedAt: result.record.completedAt }));
	} else if (operation === "log") {
		const path = appendSpecLog(record, value, root, 1_789_126_400_000);
		process.stdout.write(JSON.stringify({ path }));
	} else {
		throw new Error(`Unknown operation: ${operation}`);
	}
}
