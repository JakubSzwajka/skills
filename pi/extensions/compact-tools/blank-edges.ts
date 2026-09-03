/** CSI colour codes and OSC sequences such as the shell-integration zone markers. */
const ESCAPES = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export function isBlank(line: string): boolean {
  return line.replace(ESCAPES, "").trim() === "";
}

function escapesOf(line: string): string {
  return line.match(ESCAPES)?.join("") ?? "";
}

/**
 * Transcript items frame themselves with blank lines: the spacer every item prepends, plus the
 * vertical padding of the default tool shell. Neither is reachable from the extension API, so
 * they are trimmed from the rendered output instead. Escape sequences carried by a dropped line
 * are kept — a blank first line is where shell-integration zone markers live.
 */
export function stripBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  let lead = "";
  let trail = "";

  while (start < end && isBlank(lines[start]!)) lead += escapesOf(lines[start++]!);
  while (end > start && isBlank(lines[end - 1]!)) trail = escapesOf(lines[--end]!) + trail;
  if (start === 0 && end === lines.length) return lines;

  const kept = lines.slice(start, end);
  if (kept.length === 0) return kept;
  kept[0] = lead + kept[0]!;
  kept[kept.length - 1] = kept[kept.length - 1]! + trail;
  return kept;
}

export type Renderer = (this: unknown, width: number) => string[];

export function stripRenderer(original: Renderer): Renderer {
  return function render(this: unknown, width: number): string[] {
    const lines = original.call(this, width);
    return Array.isArray(lines) ? stripBlankEdges(lines) : lines;
  };
}
