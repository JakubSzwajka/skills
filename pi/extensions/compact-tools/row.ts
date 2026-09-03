import { homedir } from "node:os";
import { relative } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";

export const GUTTER = "┊ ";
export const ERROR_GUTTER = "✗ ";
export const NAME_WIDTH = 8;
export const SUMMARY_WIDTH = 11;
export const DURATION_WIDTH = 6;
export const COLUMN_GAP = 2;
export const MIN_ARGS_WIDTH = 16;
export const MAX_EXPANDED_LINES = 400;

const DROP_DURATION_BELOW = 52;
const DROP_SUMMARY_BELOW = 38;

export interface LineParts {
  name: string;
  args: string;
  summary?: string;
  duration?: string;
  isError?: boolean;
}

export function shortenPath(input: string, cwd?: string): string {
  if (!input) return "";
  let path = input;
  if (cwd && path.startsWith(`${cwd}/`)) {
    const rel = relative(cwd, path);
    if (rel && !rel.startsWith("..")) path = rel;
  }
  const home = homedir();
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) path = `~${path.slice(home.length)}`;
  return path;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

export function middleTruncate(value: string, max: number): string {
  if (max <= 1) return value.slice(0, Math.max(0, max));
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return `${value.slice(0, head)}…${tail > 0 ? value.slice(value.length - tail) : ""}`;
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function countLines(value: string): number {
  const trimmed = value.replace(/\n+$/, "");
  return trimmed ? trimmed.split("\n").length : 0;
}

export function unit(count: number, singular: string, plural = `${singular}s`, atLeast = false): string {
  return `${atLeast ? "≥" : ""}${count} ${count === 1 ? singular : plural}`;
}

interface FittedLine {
  gutter: string;
  name: string;
  args: string;
  pad: string;
  summaryCell: string;
  gap: string;
  durationCell: string;
}

export function fitLine(parts: LineParts, width: number): FittedLine {
  const gutter = parts.isError ? ERROR_GUTTER : GUTTER;
  const summary = width >= DROP_SUMMARY_BELOW ? (parts.summary ?? "") : "";
  const duration = width >= DROP_DURATION_BELOW ? (parts.duration ?? "") : "";

  const summaryCell = summary ? summary.padStart(SUMMARY_WIDTH) : "";
  const durationCell = duration ? duration.padStart(DURATION_WIDTH) : "";
  const gap = summaryCell && durationCell ? "  " : "";
  const rightWidth = summaryCell.length + gap.length + durationCell.length;

  const name = parts.name.padEnd(NAME_WIDTH);
  const prefixWidth = gutter.length + name.length + 1;
  const budget = width - prefixWidth - (rightWidth ? rightWidth + COLUMN_GAP : 0);
  const args = middleTruncate(parts.args, Math.max(MIN_ARGS_WIDTH, budget));
  const padWidth = Math.max(rightWidth ? COLUMN_GAP : 0, width - prefixWidth - args.length - rightWidth);

  return { gutter, name, args, pad: " ".repeat(padWidth), summaryCell, gap, durationCell };
}

export function plainLine(parts: LineParts, width: number): string {
  const f = fitLine(parts, width);
  return f.gutter + f.name + " " + f.args + f.pad + f.summaryCell + f.gap + f.durationCell;
}

export function colorLine(parts: LineParts, width: number, theme: Theme): string {
  const f = fitLine(parts, width);

  let line = theme.fg(parts.isError ? "error" : "dim", f.gutter);
  line += theme.fg(parts.isError ? "error" : "toolTitle", theme.bold(f.name)) + " ";
  line += theme.fg(parts.isError ? "error" : "accent", f.args);
  line += f.pad;
  if (f.summaryCell) line += theme.fg(parts.isError ? "error" : "muted", f.summaryCell);
  line += f.gap;
  if (f.durationCell) line += theme.fg("dim", f.durationCell);
  return line;
}

/** One tool call as a single grid row: gutter, name, arguments, right-aligned summary and duration. */
export class CompactLine implements Component {
  private readonly text = new Text("", 1, 0);
  private rendered?: string;
  parts: LineParts = { name: "", args: "" };
  theme?: Theme;

  render(width: number): string[] {
    const theme = this.theme;
    if (!theme) return [];
    const line = colorLine(this.parts, Math.max(NAME_WIDTH + 8, width - 2), theme);
    if (line !== this.rendered) {
      this.text.setText(line);
      this.rendered = line;
    }
    return this.text.render(width);
  }

  invalidate(): void {
    this.text.invalidate();
    this.rendered = undefined;
  }
}

export function outputComponent(body: string, theme: Theme): Text {
  const lines = body.split("\n");
  const shown = lines.slice(0, MAX_EXPANDED_LINES);
  if (lines.length > shown.length) shown.push(`… ${lines.length - shown.length} more lines`);
  return new Text(shown.map((line) => theme.fg("dim", GUTTER) + theme.fg("toolOutput", line)).join("\n"), 1, 0);
}
