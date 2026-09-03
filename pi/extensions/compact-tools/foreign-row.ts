import type { Theme } from "@earendil-works/pi-coding-agent";
import { CompactLine, collapseWhitespace, countLines, outputComponent, shortenPath, unit } from "./row.ts";

/** Keys worth reading first, whatever order a tool happens to declare its arguments in. */
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

/** Arguments of a tool this extension knows nothing about, read as a person would skim them. */
export function describeArgs(args: unknown, cwd?: string): string {
  if (typeof args === "string") return collapseWhitespace(args).slice(0, MAX_ARG_VALUE);
  if (!args || typeof args !== "object") return "";

  const rank = (key: string) => {
    const index = PREFERRED_KEYS.indexOf(key);
    return index < 0 ? PREFERRED_KEYS.length : index;
  };
  const ranked = Object.entries(args as Record<string, unknown>).sort(([a], [b]) => rank(a) - rank(b));

  const parts: string[] = [];
  for (const [key, value] of ranked) {
    if (parts.length >= MAX_ARG_FIELDS) break;
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "boolean") {
      if (value) parts.push(key);
    } else if (typeof value === "number") {
      parts.push(String(value));
    } else if (typeof value === "string") {
      const text = collapseWhitespace(value);
      parts.push(text.includes("/") ? shortenPath(text, cwd) : text.slice(0, MAX_ARG_VALUE));
    }
  }
  return parts.join(" · ");
}

/** The fields this extension reads off a pi tool row. */
export interface ToolRow {
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

export interface ForeignRowConfig {
  /** Active theme, once the session has one. */
  theme: () => Theme | undefined;
  /** Tools rendered through the public renderCall/renderResult API, which this must leave alone. */
  owns: (toolName: string) => boolean;
  duration: (toolCallId: string) => string | undefined;
}

function summarize(row: ToolRow, lineCount: number): string {
  if (!row.result) return row.executionStarted ? "running" : "";
  if (row.result.isError) return "failed";
  return lineCount ? unit(lineCount, "line") : "ok";
}

/**
 * A tool owned by another extension cannot be re-registered — its execute is not ours to
 * reimplement — so its row is drawn from what the component itself exposes.
 */
export function renderForeignRow(row: ToolRow, width: number, config: ForeignRowConfig): string[] | undefined {
  const name = row.toolName;
  if (!name || row.hideComponent || config.owns(name)) return undefined;

  const theme = config.theme();
  if (!theme) return undefined;
  if (row.result?.content?.some((block) => block?.type === "image")) return undefined;

  const output = typeof row.getTextOutput === "function" ? row.getTextOutput() : "";
  const line = (row.compactRow ??= new CompactLine());
  line.theme = theme;
  line.parts = {
    name,
    tone: "quiet",
    args: describeArgs(row.args, row.cwd),
    summary: summarize(row, countLines(output)),
    duration: row.result ? config.duration(row.toolCallId ?? "") : undefined,
    isError: Boolean(row.result?.isError),
  };

  const lines = line.render(width);
  if (row.expanded && output) lines.push(...outputComponent(output, theme).render(width));
  return lines;
}
