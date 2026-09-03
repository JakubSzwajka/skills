import { AssistantMessageComponent, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { type Renderer, stripRenderer } from "./blank-edges.ts";
import { type ForeignRowConfig, renderForeignRow, type ToolRow } from "./foreign-row.ts";

export interface RowTiming {
  /**
   * Stamped from the row rather than from tool_execution_* events: the event id and the id a row
   * renders under are not guaranteed to be the same string, and when they differ every duration
   * silently reads as unknown.
   */
  onStart: (toolCallId: string) => void;
  onEnd: (toolCallId: string) => void;
}

let rowsPatched = false;
let assistantPatched = false;

/**
 * Returns false on any pi build that no longer exposes what is wrapped here, leaving the default
 * rendering in place rather than failing the session.
 */
export function patchToolRows(config: ForeignRowConfig, timing: RowTiming): boolean {
  if (rowsPatched) return true;
  const prototype = ToolExecutionComponent?.prototype as
    | {
        render?: Renderer;
        markExecutionStarted?: (this: ToolRow) => void;
        updateResult?: (this: ToolRow, result: unknown, isPartial?: boolean) => void;
      }
    | undefined;
  const original = prototype?.render;
  if (typeof original !== "function") return false;

  const stripped = stripRenderer(original);
  prototype!.render = function render(this: ToolRow, width: number): string[] {
    return renderForeignRow(this, width, config) ?? stripped.call(this, width);
  };

  const originalStart = prototype!.markExecutionStarted;
  if (typeof originalStart === "function") {
    prototype!.markExecutionStarted = function markExecutionStarted(this: ToolRow) {
      timing.onStart(this.toolCallId ?? "");
      return originalStart.call(this);
    };
  }

  const originalUpdate = prototype!.updateResult;
  if (typeof originalUpdate === "function") {
    prototype!.updateResult = function updateResult(this: ToolRow, result: unknown, isPartial = false) {
      if (!isPartial) timing.onEnd(this.toolCallId ?? "");
      return originalUpdate.call(this, result, isPartial);
    };
  }

  rowsPatched = true;
  return true;
}

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
