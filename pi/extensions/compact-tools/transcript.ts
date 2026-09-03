import { AssistantMessageComponent, ToolExecutionComponent, type Theme } from "@earendil-works/pi-coding-agent";
import { CompactLine, collapseWhitespace, countLines, outputComponent, shortenPath, unit } from "./row.ts";

/** CSI colour codes and OSC sequences such as the shell-integration zone markers. */
const ESCAPES = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const PREFERRED_KEYS = [
  "path",
  "command",
  "pattern",
  "query",
  "subject",
  "task",
  "message",
  "text",
  "agent",
  "name",
  "action",
  "id",
  "status",
];
const MAX_ARG_FIELDS = 4;
const MAX_ARG_VALUE = 60;

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

type Renderer = (this: unknown, width: number) => string[];

export function stripRenderer(original: Renderer): Renderer {
  return function render(this: unknown, width: number): string[] {
    const lines = original.call(this, width);
    return Array.isArray(lines) ? stripBlankEdges(lines) : lines;
  };
}

/** Arguments of a tool this extension knows nothing about, read as a person would skim them. */
export function describeArgs(args: unknown, cwd?: string): string {
  if (typeof args === "string") return collapseWhitespace(args).slice(0, MAX_ARG_VALUE);
  if (!args || typeof args !== "object") return "";

  const entries = Object.entries(args as Record<string, unknown>);
  const ranked = [...entries].sort(([a], [b]) => {
    const rankA = PREFERRED_KEYS.indexOf(a);
    const rankB = PREFERRED_KEYS.indexOf(b);
    return (rankA < 0 ? PREFERRED_KEYS.length : rankA) - (rankB < 0 ? PREFERRED_KEYS.length : rankB);
  });

  const parts: string[] = [];
  for (const [key, value] of ranked) {
    if (parts.length >= MAX_ARG_FIELDS) break;
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "boolean") {
      if (value) parts.push(key);
      continue;
    }
    if (typeof value === "number") {
      parts.push(String(value));
      continue;
    }
    if (typeof value !== "string") continue;
    const text = collapseWhitespace(value);
    parts.push(text.includes("/") ? shortenPath(text, cwd) : text.slice(0, MAX_ARG_VALUE));
  }
  return parts.join(" · ");
}

interface ToolRow {
  toolName?: string;
  toolCallId?: string;
  args?: unknown;
  cwd?: string;
  expanded?: boolean;
  hideComponent?: boolean;
  executionStarted?: boolean;
  result?: { content?: Array<{ type?: string }>; isError?: boolean };
  getTextOutput?: () => string;
  compactRow?: CompactLine;
}

export interface RowPatchConfig {
  /** Active theme, once the session has one. */
  theme: () => Theme | undefined;
  /** Tools this extension renders through the public renderCall/renderResult API. */
  owns: (toolName: string) => boolean;
  duration: (toolCallId: string) => string | undefined;
}

export function renderForeignRow(row: ToolRow, width: number, config: RowPatchConfig): string[] | undefined {
  const name = row.toolName;
  if (!name || row.hideComponent || config.owns(name)) return undefined;

  const theme = config.theme();
  if (!theme) return undefined;
  if (row.result?.content?.some((block) => block?.type === "image")) return undefined;

  const output = typeof row.getTextOutput === "function" ? row.getTextOutput() : "";
  const isError = Boolean(row.result?.isError);
  const lineCount = countLines(output);

  let summary: string;
  if (!row.result) summary = row.executionStarted ? "running" : "";
  else if (isError) summary = "failed";
  else summary = lineCount ? unit(lineCount, "line") : "ok";

  const line = (row.compactRow ??= new CompactLine());
  line.theme = theme;
  line.parts = {
    name,
    args: describeArgs(row.args, row.cwd),
    summary,
    duration: row.result ? config.duration(row.toolCallId ?? "") : undefined,
    isError,
  };

  const lines = line.render(width);
  if (row.expanded && output) lines.push(...outputComponent(output, theme).render(width));
  return lines;
}

let patched = false;

export function patchToolRows(config: RowPatchConfig): boolean {
  if (patched) return true;
  const prototype = ToolExecutionComponent?.prototype as { render?: (width: number) => string[] } | undefined;
  const original = prototype?.render;
  if (typeof original !== "function") return false;

  const stripped = stripRenderer(original as Renderer);
  prototype!.render = function render(this: ToolRow, width: number): string[] {
    return renderForeignRow(this, width, config) ?? stripped.call(this, width);
  };
  patched = true;
  return true;
}

let assistantPatched = false;

/** Let a hidden thinking run sit flush in a block of tool rows instead of floating between gaps. */
export function patchAssistantMessages(): boolean {
  if (assistantPatched) return true;
  const prototype = AssistantMessageComponent?.prototype as { render?: Renderer } | undefined;
  const original = prototype?.render;
  if (typeof original !== "function") return false;

  prototype!.render = stripRenderer(original);
  assistantPatched = true;
  return true;
}
