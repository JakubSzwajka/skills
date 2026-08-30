import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, release, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const EXTENSION_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SWIFT_SOURCE = join(EXTENSION_DIRECTORY, "native", "Redactor.swift");
const CACHE_DIRECTORY = join(homedir(), "Library", "Caches", "pi-screenshot-redactor");

type Source = "clipboard" | "file" | "screen";
type Action = "interactive" | "apply";
type RedactionStyle = "solid" | "pixelated";

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ToolParameters {
  action: Action;
  source: Source;
  path?: string;
  rectangles?: Rectangle[];
  outputPath?: string;
  copyToClipboard?: boolean;
  overwrite?: boolean;
  style?: RedactionStyle;
  pixelBlockSize?: number;
  maskColor?: string;
}

interface NativeRequest extends ToolParameters {
  path?: string;
  outputPath: string;
  temporaryDirectory: string;
}

interface NativeResult {
  status: "saved" | "cancelled" | "error";
  path?: string;
  width?: number;
  height?: number;
  rectangles?: number;
  style?: RedactionStyle;
  pixelBlockSize?: number;
  copiedToClipboard?: boolean;
  error?: string;
}

function stripPathDecoration(value: string): string {
  let path = value.trim();
  const unquote = () => {
    if (path.length >= 2 && ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'")))) {
      path = path.slice(1, -1);
    }
  };
  unquote();
  if (path.startsWith("@")) path = path.slice(1);
  unquote();
  return path;
}

function resolveUserPath(value: string, cwd: string, label: string): string {
  let path = stripPathDecoration(value);
  if (!path) throw new Error(`${label} cannot be empty.`);
  if (path === "~") path = homedir();
  else if (path.startsWith("~/")) path = join(homedir(), path.slice(2));
  return resolve(cwd, path);
}

function timestamp(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}${get("second")}`;
}

function defaultOutputPath(): string {
  const desktop = join(homedir(), "Desktop");
  const stem = `redacted-${timestamp()}`;
  let candidate = join(desktop, `${stem}.png`);
  for (let suffix = 2; existsSync(candidate); suffix += 1) candidate = join(desktop, `${stem}-${suffix}.png`);
  return candidate;
}

async function secureCacheDirectory(): Promise<void> {
  await mkdir(CACHE_DIRECTORY, { recursive: true, mode: 0o700 });
  const before = await lstat(CACHE_DIRECTORY);
  const uid = process.getuid?.();
  if (!before.isDirectory() || (uid !== undefined && before.uid !== uid)) {
    throw new Error("Refusing to use a screenshot editor cache that is not an owned directory.");
  }
  await chmod(CACHE_DIRECTORY, 0o700);
  const after = await lstat(CACHE_DIRECTORY);
  if (!after.isDirectory() || (after.mode & 0o777) !== 0o700 || (uid !== undefined && after.uid !== uid)) {
    throw new Error("Could not secure the screenshot editor cache directory.");
  }
}

async function validCachedHelper(path: string): Promise<boolean> {
  try {
    const binary = await lstat(path);
    const uid = process.getuid?.();
    return binary.isFile()
      && (uid === undefined || binary.uid === uid)
      && (binary.mode & 0o777) === 0o700;
  } catch {
    return false;
  }
}

async function ensureHelper(pi: ExtensionAPI, signal?: AbortSignal): Promise<string> {
  const source = await readFile(SWIFT_SOURCE);
  const key = createHash("sha256")
    .update(source)
    .update(process.arch)
    .update(release())
    .digest("hex")
    .slice(0, 20);
  const binary = join(CACHE_DIRECTORY, `redactor-${key}`);

  await secureCacheDirectory();
  if (await validCachedHelper(binary)) return binary;
  // Invalid entries are never executed. Remove the path and install a fresh binary exclusively.
  await rm(binary, { force: true });

  const buildDirectory = await mkdtemp(join(CACHE_DIRECTORY, ".build-"));
  try {
    await chmod(buildDirectory, 0o700);
    const temporaryBinary = join(buildDirectory, "Redactor");
    const compilation = await pi.exec(
      "/usr/bin/xcrun",
      ["swiftc", "-swift-version", "5", SWIFT_SOURCE, "-o", temporaryBinary],
      { signal },
    );
    if (compilation.code !== 0) {
      const diagnostic = (compilation.stderr || compilation.stdout || "unknown compiler error").trim();
      throw new Error(`Could not compile the native screenshot editor with Xcode Command Line Tools: ${diagnostic}`);
    }
    await chmod(temporaryBinary, 0o700);
    try {
      await link(temporaryBinary, binary);
    } catch (error: any) {
      if (error?.code !== "EEXIST" || !(await validCachedHelper(binary))) {
        throw new Error("Could not securely install the compiled screenshot editor in the user cache.");
      }
    }
    if (!(await validCachedHelper(binary))) {
      throw new Error("The cached screenshot editor failed its owner and permission checks.");
    }
    return binary;
  } finally {
    await rm(buildDirectory, { recursive: true, force: true });
  }
}

function validateParameters(params: ToolParameters, ctx: ExtensionContext): NativeRequest {
  if (params.action !== "interactive" && params.action !== "apply") {
    throw new Error("action must be interactive or apply.");
  }
  if (params.source !== "clipboard" && params.source !== "file" && params.source !== "screen") {
    throw new Error("source must be clipboard, file, or screen.");
  }
  if (params.action === "interactive" && ctx.mode !== "tui") {
    throw new Error("Interactive screenshot redaction needs Pi's TUI so a foreground macOS editor can be opened. Use action=apply with exact pixel rectangles in print or RPC mode.");
  }
  if (params.action === "interactive" && params.rectangles !== undefined) {
    throw new Error("Interactive mode does not accept rectangles; draw them in the native macOS editor.");
  }
  if (params.action === "apply" && (!params.rectangles || params.rectangles.length === 0)) {
    throw new Error("Apply mode requires at least one exact pixel rectangle.");
  }
  if (params.source === "file" && !params.path) throw new Error("source=file requires path.");
  if (params.source !== "file" && params.path !== undefined) throw new Error("path is only valid when source=file.");
  const style = params.style ?? "solid";
  if (style !== "solid" && style !== "pixelated") {
    throw new Error("style must be solid or pixelated.");
  }
  if (params.pixelBlockSize !== undefined && (!Number.isInteger(params.pixelBlockSize) || params.pixelBlockSize < 2 || params.pixelBlockSize > 128)) {
    throw new Error("pixelBlockSize must be an integer between 2 and 128 source pixels.");
  }
  if (params.maskColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(params.maskColor)) {
    throw new Error("maskColor must be an opaque color in #RRGGBB form.");
  }
  if (style === "pixelated" && params.maskColor !== undefined) {
    throw new Error("maskColor applies only when style=solid.");
  }

  const inputPath = params.path ? resolveUserPath(params.path, ctx.cwd, "Input path") : undefined;
  const outputPath = params.outputPath
    ? resolveUserPath(params.outputPath, ctx.cwd, "Output path")
    : defaultOutputPath();
  if (inputPath && inputPath === outputPath && !params.overwrite) {
    throw new Error("Output resolves to the source image. Choose another outputPath, or explicitly set overwrite=true.");
  }

  return {
    ...params,
    path: inputPath,
    outputPath,
    temporaryDirectory: "",
    copyToClipboard: params.copyToClipboard ?? true,
    overwrite: params.overwrite ?? false,
    style,
    pixelBlockSize: params.pixelBlockSize ?? 16,
  };
}

async function invokeHelper(
  pi: ExtensionAPI,
  request: NativeRequest,
  signal?: AbortSignal,
): Promise<NativeResult> {
  if (signal?.aborted) throw new Error("Screenshot redaction was cancelled before it started.");
  const helper = await ensureHelper(pi, signal);
  const runtimeDirectory = await mkdtemp(join(tmpdir(), "pi-screenshot-redactor-"));
  try {
    await chmod(runtimeDirectory, 0o700);
    const requestPath = join(runtimeDirectory, "request.json");
    request.temporaryDirectory = runtimeDirectory;
    await writeFile(requestPath, JSON.stringify(request), { mode: 0o600, flag: "wx" });
    const execution = await pi.exec(helper, [requestPath], { signal });
    const lines = execution.stdout.trim().split(/\r?\n/).filter(Boolean);
    let result: NativeResult | undefined;
    try {
      result = JSON.parse(lines.at(-1) ?? "") as NativeResult;
    } catch {
      // The helper intentionally emits only one JSON line. Treat anything else as a native failure.
    }
    if (!result) {
      const diagnostic = (execution.stderr || "No structured result was returned.").trim();
      throw new Error(`The native screenshot editor failed: ${diagnostic}`);
    }
    if (result.status === "error" || execution.code !== 0) {
      throw new Error(result.error || "The native screenshot editor exited with an unknown error.");
    }
    return result;
  } finally {
    // This parent-owned directory also contains full-screen captures, so aborts cannot strand them.
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
}

async function redact(
  pi: ExtensionAPI,
  params: ToolParameters,
  ctx: ExtensionContext,
  signal?: AbortSignal,
): Promise<NativeResult> {
  const request = validateParameters(params, ctx);
  return withFileMutationQueue(request.outputPath, () => invokeHelper(pi, request, signal));
}

function resultText(result: NativeResult): string {
  if (result.status === "cancelled") {
    const dimensions = result.width && result.height ? ` (${result.width}x${result.height})` : "";
    return `Redaction cancelled${dimensions}; no file was written and the clipboard was not changed.`;
  }
  const style = result.style ?? "solid";
  const rectangleCount = result.rectangles ?? 0;
  const maskLabel = `${rectangleCount} ${style === "pixelated" ? "pixelated" : "secure solid"} mask${rectangleCount === 1 ? "" : "s"}`;
  const clipboard = `clipboard ${result.copiedToClipboard ? "updated" : "unchanged"}`;
  if (style === "pixelated") {
    return `Saved pixelated PNG — NOT SAFE FOR SECRETS: ${result.path} (${result.width}x${result.height}, ${maskLabel} at ${result.pixelBlockSize ?? 16}px blocks; pixelation can leak text shapes, ${clipboard}).`;
  }
  return `Saved sanitized PNG: ${result.path} (${result.width}x${result.height}, ${maskLabel}, ${clipboard}).`;
}

function commandParameters(raw: string): ToolParameters {
  const argument = raw.trim();
  if (!argument || argument === "clipboard") return { action: "interactive", source: "clipboard" };
  if (argument === "screen") return { action: "interactive", source: "screen" };
  if (argument === "file") throw new Error("Usage: /redact, /redact screen, or /redact <file path>.");
  const filePath = argument.startsWith("file ") ? argument.slice(5).trim() : argument;
  if (!filePath) throw new Error("Usage: /redact, /redact screen, or /redact <file path>.");
  return { action: "interactive", source: "file", path: filePath };
}

export default function screenshotRedactor(pi: ExtensionAPI) {
  pi.registerCommand("redact", {
    description: "Redact a clipboard screenshot, full screen, or image file with native solid or pixelated masks",
    handler: async (args, ctx) => {
      try {
        if (ctx.mode !== "tui") throw new Error("/redact needs Pi's interactive TUI to open the native macOS editor.");
        const result = await redact(pi, commandParameters(args), ctx);
        const severity = result.status === "cancelled" || result.style === "pixelated" ? "warning" : "info";
        ctx.ui.notify(resultText(result), severity);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerTool({
    name: "screenshot_redact",
    label: "Screenshot Redact",
    description:
      "Sanitize an image using secure opaque solid masks, or optionally apply non-secure block pixelation for non-secret visual obfuscation. Interactive mode opens a native macOS pointer editor. Apply mode is non-interactive and requires exact integer rectangles in source pixels with a top-left origin. Sources are clipboard image data, a file, or a fresh full-screen capture. The result is a fresh PNG re-encoded without source metadata.",
    promptSnippet: "Redact screenshots with secure solid masks or explicitly requested non-secret pixelation",
    promptGuidelines: [
      "Use style=solid (the default) for sensitive data and secrets; action=apply rectangles use exact source pixels with a top-left origin.",
      "Use style=pixelated only when the user explicitly requests it for non-secret visual obfuscation because mosaic pixelation can leak text shapes.",
      "Do not claim sensitive content is sanitized unless style=solid and screenshot_redact reports a saved output path.",
    ],
    parameters: Type.Object(
      {
        action: StringEnum(["interactive", "apply"] as const, {
          description: "Open the native editor, or apply exact rectangles without a GUI",
        }),
        source: StringEnum(["clipboard", "file", "screen"] as const, {
          description: "Clipboard image data, an image file, or a fresh full-screen capture",
        }),
        path: Type.Optional(Type.String({ description: "Input image path; required only for source=file" })),
        rectangles: Type.Optional(
          Type.Array(
            Type.Object(
              {
                x: Type.Integer({ minimum: 0 }),
                y: Type.Integer({ minimum: 0 }),
                width: Type.Integer({ minimum: 1 }),
                height: Type.Integer({ minimum: 1 }),
              },
              { additionalProperties: false },
            ),
            { description: "Exact source-pixel rectangles with a top-left origin; required for action=apply" },
          ),
        ),
        outputPath: Type.Optional(Type.String({ description: "Destination PNG; defaults to a timestamped Desktop filename" })),
        copyToClipboard: Type.Optional(Type.Boolean({ description: "Copy the exact saved PNG bytes; defaults to true" })),
        overwrite: Type.Optional(Type.Boolean({ description: "Permit replacing an existing regular destination; defaults to false" })),
        style: Type.Optional(StringEnum(["solid", "pixelated"] as const, {
          description: "Secure solid masking (default), or non-secure pixelation for explicitly requested non-secret obfuscation",
        })),
        pixelBlockSize: Type.Optional(Type.Integer({
          minimum: 2,
          maximum: 128,
          description: "Pixelated block size in source pixels; defaults to 16",
        })),
        maskColor: Type.Optional(Type.String({ description: "Opaque #RRGGBB mask color for style=solid only; defaults to #000000" })),
      },
      { additionalProperties: false },
    ),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const result = await redact(pi, params as ToolParameters, ctx, signal);
      return {
        content: [{ type: "text" as const, text: resultText(result) }],
        details: {
          status: result.status,
          path: result.path,
          width: result.width,
          height: result.height,
          rectangles: result.rectangles,
          style: result.style,
          pixelBlockSize: result.pixelBlockSize,
          warning: result.style === "pixelated" ? "Pixelated output is not secure and can leak text shapes." : undefined,
          copiedToClipboard: result.copiedToClipboard,
        },
      };
    },
  });
}
