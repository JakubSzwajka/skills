import type { EditToolDetails } from "@earendil-works/pi-coding-agent";
import { condenseCommand } from "./command.ts";
import { collapseWhitespace, countLines, shortenPath, type Tone, unit } from "./row.ts";

export interface ToolResultShape {
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
}

/** The parts of pi's render context this extension reads; pi does not export the type. */
export interface RowContext {
  args: any;
  cwd: string;
  isError: boolean;
}

export interface ToolPresenter {
  name: string;
  tone: Tone;
  describe: (args: any, cwd: string) => string;
  summarize: (result: ToolResultShape, context: RowContext) => string;
  /** Output shown when the row is expanded, when the text result is not the interesting part. */
  body?: (result: ToolResultShape) => string;
}

export function resultText(result: ToolResultShape): string {
  const block = result.content.find((c) => c.type === "text");
  return typeof block?.text === "string" ? block.text : "";
}

function truncated(result: ToolResultShape): boolean {
  return Boolean((result.details as { truncation?: { truncated?: boolean } } | undefined)?.truncation?.truncated);
}

function counted(result: ToolResultShape, singular: string, plural?: string): string {
  return unit(countLines(resultText(result)), singular, { plural, atLeast: truncated(result) });
}

function editStats(result: ToolResultShape): string {
  const patch = (result.details as EditToolDetails | undefined)?.patch ?? "";
  let added = 0;
  let removed = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return `+${added} -${removed}`;
}

export const presenters: Record<string, ToolPresenter> = {
  read: {
    name: "read",
    tone: "read",
    describe: (args, cwd) => {
      const path = shortenPath(args?.path ?? "", cwd);
      if (!args?.offset && !args?.limit) return path;
      const start = args.offset ?? 1;
      return `${path}:${start}${args.limit ? `-${start + args.limit - 1}` : ""}`;
    },
    summarize: (result) =>
      result.content.some((c) => c.type === "image") ? "image" : counted(result, "line"),
  },
  bash: {
    name: "$",
    tone: "read",
    describe: (args, cwd) => condenseCommand(args?.command ?? "", cwd),
    summarize: (result, context) => {
      if (context.isError) return "failed";
      return countLines(resultText(result)) ? counted(result, "line") : "no output";
    },
  },
  edit: {
    name: "edit",
    tone: "mutate",
    describe: (args, cwd) => shortenPath(args?.path ?? "", cwd),
    summarize: (result, context) => (context.isError ? "failed" : editStats(result)),
    body: (result) => (result.details as EditToolDetails | undefined)?.diff ?? resultText(result),
  },
  write: {
    name: "write",
    tone: "mutate",
    describe: (args, cwd) => shortenPath(args?.path ?? "", cwd),
    summarize: (_result, context) =>
      context.isError ? "failed" : `${countLines(context.args?.content ?? "")} written`,
  },
  grep: {
    name: "grep",
    tone: "read",
    describe: (args, cwd) => {
      let label = collapseWhitespace(args?.pattern ?? "");
      if (args?.glob) label += ` ${args.glob}`;
      if (args?.path) label += ` in ${shortenPath(args.path, cwd)}`;
      return label;
    },
    summarize: (result) => counted(result, "hit"),
  },
  find: {
    name: "find",
    tone: "read",
    describe: (args, cwd) =>
      args?.path ? `${args.pattern ?? ""} in ${shortenPath(args.path, cwd)}` : (args?.pattern ?? ""),
    summarize: (result) => counted(result, "file"),
  },
  ls: {
    name: "ls",
    tone: "read",
    describe: (args, cwd) => shortenPath(args?.path ?? ".", cwd),
    summarize: (result) => counted(result, "entry", "entries"),
  },
};
