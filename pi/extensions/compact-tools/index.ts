import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type EditToolDetails,
  type ExtensionAPI,
  type Theme,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import { patchAssistantMessages, patchToolRows } from "./transcript.ts";
import {
  CompactLine,
  collapseWhitespace,
  countLines,
  formatDuration,
  GUTTER,
  outputComponent,
  shortenPath,
  unit,
} from "./row.ts";

export { condenseCommand, splitCommands } from "./command.ts";
import { condenseCommand } from "./command.ts";

interface RenderContext<TState> {
  args: any;
  toolCallId: string;
  lastComponent: Component | undefined;
  state: TState;
  cwd: string;
  isPartial: boolean;
  expanded: boolean;
  isError: boolean;
}

interface RowState {
  line?: CompactLine;
}

interface ToolResultShape {
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
}

interface ToolPresenter {
  name: string;
  describe: (args: any, cwd: string) => string;
  summarize?: (result: ToolResultShape, context: RenderContext<RowState>) => string;
  body?: (result: ToolResultShape, context: RenderContext<RowState>) => string;
}

function resultText(result: ToolResultShape): string {
  const block = result.content.find((c) => c.type === "text");
  return typeof block?.text === "string" ? block.text : "";
}

function truncated(details: unknown): boolean {
  return Boolean((details as { truncation?: { truncated?: boolean } } | undefined)?.truncation?.truncated);
}

const presenters: Record<string, ToolPresenter> = {
  read: {
    name: "read",
    describe: (args, cwd) => {
      let label = shortenPath(args?.path ?? "", cwd);
      if (args?.offset || args?.limit) {
        const start = args.offset ?? 1;
        label += `:${start}${args.limit ? `-${start + args.limit - 1}` : ""}`;
      }
      return label;
    },
    summarize: (result) => {
      if (result.content.some((c) => c.type === "image")) return "image";
      return unit(countLines(resultText(result)), "line", undefined, truncated(result.details));
    },
  },
  bash: {
    name: "$",
    describe: (args, cwd) => condenseCommand(args?.command ?? "", cwd),
    summarize: (result, context) => {
      if (context.isError) return "failed";
      const lines = countLines(resultText(result));
      return lines ? unit(lines, "line", undefined, truncated(result.details)) : "no output";
    },
  },
  edit: {
    name: "edit",
    describe: (args, cwd) => shortenPath(args?.path ?? "", cwd),
    summarize: (result, context) => {
      if (context.isError) return "failed";
      const patch = (result.details as EditToolDetails | undefined)?.patch ?? "";
      let added = 0;
      let removed = 0;
      for (const line of patch.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) added++;
        else if (line.startsWith("-") && !line.startsWith("---")) removed++;
      }
      return `+${added} -${removed}`;
    },
    body: (result) => (result.details as EditToolDetails | undefined)?.diff ?? resultText(result),
  },
  write: {
    name: "write",
    describe: (args, cwd) => shortenPath(args?.path ?? "", cwd),
    summarize: (result, context) =>
      context.isError ? "failed" : `${countLines(context.args?.content ?? "")} written`,
  },
  grep: {
    name: "grep",
    describe: (args, cwd) => {
      let label = collapseWhitespace(args?.pattern ?? "");
      if (args?.glob) label += ` ${args.glob}`;
      if (args?.path) label += ` in ${shortenPath(args.path, cwd)}`;
      return label;
    },
    summarize: (result) => unit(countLines(resultText(result)), "hit", undefined, truncated(result.details)),
  },
  find: {
    name: "find",
    describe: (args, cwd) => {
      const pattern = args?.pattern ?? "";
      return args?.path ? `${pattern} in ${shortenPath(args.path, cwd)}` : pattern;
    },
    summarize: (result) => unit(countLines(resultText(result)), "file", undefined, truncated(result.details)),
  },
  ls: {
    name: "ls",
    describe: (args, cwd) => shortenPath(args?.path ?? ".", cwd),
    summarize: (result) => unit(countLines(resultText(result)), "entry", "entries", truncated(result.details)),
  },
};

const factories: Record<string, (cwd: string) => ToolDefinition<any, any, any>> = {
  read: createReadToolDefinition,
  bash: createBashToolDefinition,
  edit: createEditToolDefinition,
  write: createWriteToolDefinition,
  grep: createGrepToolDefinition,
  find: createFindToolDefinition,
  ls: createLsToolDefinition,
};

const definitionCache = new Map<string, ToolDefinition<any, any, any>>();

function definitionFor(name: string, cwd: string): ToolDefinition<any, any, any> {
  const key = `${name}:${cwd}`;
  let definition = definitionCache.get(key);
  if (!definition) {
    definition = factories[name]!(cwd);
    definitionCache.set(key, definition);
  }
  return definition;
}

const timings = new Map<string, { start: number; end?: number }>();

export function trackStart(toolCallId: string): void {
  if (timings.size > 500) {
    for (const key of [...timings.keys()].slice(0, 250)) timings.delete(key);
  }
  if (!timings.has(toolCallId)) timings.set(toolCallId, { start: Date.now() });
}

export function trackEnd(toolCallId: string): void {
  const entry = timings.get(toolCallId);
  if (entry && !entry.end) entry.end = Date.now();
}

export function durationLabel(toolCallId: string): string | undefined {
  const entry = timings.get(toolCallId);
  if (!entry?.end) return undefined;
  return formatDuration(entry.end - entry.start);
}

/** Hidden thinking runs join the gutter, so a block of tool rows reads as one column. */
export const THINKING_LABEL = `${GUTTER}Thinking...`;

/** A rule above and below assistant prose, so a paragraph reads as a beat between tool runs. */
export function separate(markdown: string, messageType: string, isStreaming: boolean): string {
  if (messageType !== "assistant" || !markdown.trim()) return markdown;
  return isStreaming ? `---\n\n${markdown}` : `---\n\n${markdown}\n\n---`;
}

export default function (pi: ExtensionAPI): void {
  let theme: Theme | undefined;

  patchToolRows({
    theme: () => theme,
    owns: (name) => name in presenters,
    duration: durationLabel,
  });
  patchAssistantMessages();

  pi.on("session_start", (_event: any, ctx: any) => {
    theme = ctx?.ui?.theme ?? theme;
    ctx?.ui?.setHiddenThinkingLabel?.(THINKING_LABEL);
  });
  pi.on("tool_execution_start", (event: any) => trackStart(event.toolCallId));
  pi.on("tool_execution_end", (event: any) => trackEnd(event.toolCallId));

  pi.registerMarkdownTransformer((markdown: string, context: any) =>
    separate(markdown, context.messageType, context.isStreaming),
  );

  for (const [name, presenter] of Object.entries(presenters)) {
    const base = definitionFor(name, process.cwd());

    pi.registerTool({
      ...base,
      renderShell: "self",

      async execute(toolCallId, params, signal, onUpdate, ctx) {
        trackStart(toolCallId);
        try {
          return await definitionFor(name, ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
        } finally {
          trackEnd(toolCallId);
        }
      },

      renderCall(args, rowTheme, context: RenderContext<RowState>) {
        theme = rowTheme;
        const line = context.lastComponent instanceof CompactLine ? context.lastComponent : new CompactLine();
        line.theme = rowTheme;
        line.parts = { name: presenter.name, args: presenter.describe(args ?? {}, context.cwd) };
        context.state.line = line;
        return line;
      },

      renderResult(result, { expanded, isPartial }, rowTheme, context: RenderContext<RowState>) {
        const summary = isPartial
          ? "running"
          : (presenter.summarize?.(result, context) ?? unit(countLines(resultText(result)), "line"));

        const line = context.state.line;
        if (line) {
          line.parts = {
            ...line.parts,
            summary,
            duration: isPartial ? undefined : durationLabel(context.toolCallId),
            isError: context.isError,
          };
        }

        const body = (presenter.body ?? resultText)(result, context).replace(/\n+$/, "");
        if (!expanded || !body) return new Text("", 0, 0);
        return outputComponent(body, rowTheme);
      },
    });
  }
}

export { fitLine, formatDuration, middleTruncate, plainLine, shortenPath } from "./row.ts";
