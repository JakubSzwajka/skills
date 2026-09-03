import { formatDuration } from "./row.ts";

const MAX_ENTRIES = 500;

const timings = new Map<string, { start: number; end?: number }>();

export function trackStart(toolCallId: string): void {
  if (timings.size > MAX_ENTRIES) {
    for (const key of [...timings.keys()].slice(0, MAX_ENTRIES / 2)) timings.delete(key);
  }
  if (!timings.has(toolCallId)) timings.set(toolCallId, { start: Date.now() });
}

export function trackEnd(toolCallId: string): void {
  const entry = timings.get(toolCallId);
  if (entry && !entry.end) entry.end = Date.now();
}

/** Undefined until a row has both stamps: replayed history has no timing and must not invent one. */
export function durationLabel(toolCallId: string): string | undefined {
  const entry = timings.get(toolCallId);
  return entry?.end ? formatDuration(entry.end - entry.start) : undefined;
}
