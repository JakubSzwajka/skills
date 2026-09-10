/** Small primitives shared by the service and both lane runners. */

export function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function text(value: unknown): string | undefined {
	return typeof value === "string" && value.length ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function isPresent<T>(value: T | undefined): value is T {
	return value !== undefined;
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `provider/id:thinking` is one string in a profile and two flags on the command line. */
export function splitModelSpec(spec: string): { model: string; thinking?: string } {
	const match = spec.match(/^(.*):(off|minimal|low|medium|high|xhigh|max)$/);
	return match ? { model: match[1]!, thinking: match[2] } : { model: spec };
}

/** Linux's highest `pid_max`; macOS stops at 99999. Anything above this was never a pid. */
export const MAX_PID = 4_194_304;

/** A value that could be a live pid. Rejects the huge integers that poison a batched `ps`. */
export function isPid(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_PID;
}

export function processAlive(pid: number): boolean {
	try { process.kill(pid, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

export function processGroupAlive(group: number): boolean {
	try { process.kill(-group, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
