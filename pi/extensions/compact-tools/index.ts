import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ExtensionAPI,
  type ExtensionContext,
  type MarkdownTransformContext,
  type Theme,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import { patchAssistantMessages, patchToolRows } from "./patch.ts";
import { presenters, resultText, type RowContext } from "./presenters.ts";
import { CompactLine, GUTTER, outputComponent } from "./row.ts";
import { durationLabel, trackEnd, trackStart } from "./timing.ts";

/** Hidden thinking runs join the gutter, so a block of tool rows reads as one column. */
export const THINKING_LABEL = `${GUTTER}Thinking...`;

/** A rule above and below assistant prose, so a paragraph reads as a beat between tool runs. */
export function separate(markdown: string, messageType: string, isStreaming: boolean): string {
  if (messageType !== "assistant" || !markdown.trim()) return markdown;
  return isStreaming ? `---\n\n${markdown}` : `---\n\n${markdown}\n\n---`;
}

interface RowState {
  line?: CompactLine;
}

/** pi does not export its render context type, so this names only the fields used here. */
interface RenderContext extends RowContext {
  toolCallId: string;
  lastComponent: Component | undefined;
  state: RowState;
}

const factories: Record<string, (cwd: string) => ToolDefinition<any, any, any>> = {
  read: createReadToolDefinition,
  bash: createBashToolDefinition,
  edit: createEditToolDefinition,
  write: createWriteToolDefinition,
  grep: createGrepToolDefinition,
  find: createFindToolDefinition,
  ls: createLsToolDefinition,
};

const definitions = new Map<string, ToolDefinition<any, any, any>>();

/** Built-in tools are cwd-bound at construction, so each working directory gets its own. */
function definitionFor(name: string, cwd: string): ToolDefinition<any, any, any> {
  const key = `${name}:${cwd}`;
  let definition = definitions.get(key);
  if (!definition) {
    definition = factories[name]!(cwd);
    definitions.set(key, definition);
  }
  return definition;
}

export default function (pi: ExtensionAPI): void {
  let theme: Theme | undefined;

  patchToolRows(
    { theme: () => theme, owns: (name) => name in presenters, duration: durationLabel },
    { onStart: trackStart, onEnd: trackEnd },
  );
  patchAssistantMessages();

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    theme = ctx.ui?.theme ?? theme;
    ctx.ui?.setHiddenThinkingLabel?.(THINKING_LABEL);
  });

  pi.registerMarkdownTransformer((markdown: string, context: MarkdownTransformContext) =>
    separate(markdown, context.messageType, context.isStreaming),
  );

  for (const [name, presenter] of Object.entries(presenters)) {
    pi.registerTool({
      ...definitionFor(name, process.cwd()),
      renderShell: "self",

      execute: (toolCallId, params, signal, onUpdate, ctx) =>
        definitionFor(name, ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx),

      renderCall(args, rowTheme, context: RenderContext) {
        theme = rowTheme;
        const line = context.lastComponent instanceof CompactLine ? context.lastComponent : new CompactLine();
        line.theme = rowTheme;
        line.parts = {
          name: presenter.name,
          tone: presenter.tone,
          args: presenter.describe(args ?? {}, context.cwd),
        };
        context.state.line = line;
        return line;
      },

      renderResult(result, { expanded, isPartial }, rowTheme, context: RenderContext) {
        const line = context.state.line;
        if (line) {
          line.parts = {
            ...line.parts,
            summary: isPartial ? "running" : presenter.summarize(result, context),
            duration: isPartial ? undefined : durationLabel(context.toolCallId),
            isError: context.isError,
          };
        }

        const body = (presenter.body?.(result) ?? resultText(result)).replace(/\n+$/, "");
        if (!expanded || !body) return new Text("", 0, 0);
        return outputComponent(body, rowTheme);
      },
    });
  }
}
