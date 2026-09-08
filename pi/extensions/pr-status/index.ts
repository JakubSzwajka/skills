import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const PR_STATUS_KEY = "github-pr";
export const PR_OPEN_COMMAND = "gh:pr:open";

export type PullRequestStatus = "draft" | "active" | "merged" | "closed";

export interface BranchPullRequest {
  repository: string;
  number: number;
  status: PullRequestStatus;
  url: string;
}

interface GhPullRequest {
  number?: unknown;
  state?: unknown;
  isDraft?: unknown;
  url?: unknown;
}

type StatusTheme = Pick<ExtensionContext["ui"]["theme"], "fg">;

function repositoryName(url: string): string | undefined {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (parts.length < 4 || parts[2] !== "pull") return undefined;
    return decodeURIComponent(parts[1] ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "") || undefined;
  } catch {
    return undefined;
  }
}

export function parsePullRequest(json: string): BranchPullRequest | undefined {
  let value: GhPullRequest;
  try {
    value = JSON.parse(json) as GhPullRequest;
  } catch {
    return undefined;
  }

  if (
    typeof value.number !== "number"
    || !Number.isInteger(value.number)
    || value.number < 1
    || typeof value.url !== "string"
    || typeof value.state !== "string"
  ) {
    return undefined;
  }

  const repository = repositoryName(value.url);
  if (!repository) return undefined;

  const state = value.state.toUpperCase();
  if (state !== "OPEN" && state !== "MERGED" && state !== "CLOSED") return undefined;

  const status: PullRequestStatus = value.isDraft === true
    ? "draft"
    : state === "OPEN"
      ? "active"
      : state === "MERGED"
        ? "merged"
        : "closed";

  return { repository, number: value.number, status, url: value.url };
}

export function renderPullRequestStatus(pr: BranchPullRequest, theme: StatusTheme): string {
  const marker = pr.status === "draft" ? "◇" : pr.status === "active" ? "●" : pr.status === "merged" ? "◆" : "×";
  const text = `${marker} ${pr.repository} #${pr.number} ${pr.status}`;

  if (pr.status === "active") return theme.fg("success", text);
  if (pr.status === "merged") return theme.fg("accent", text);
  return theme.fg("muted", text);
}

async function findPullRequest(pi: ExtensionAPI, cwd: string): Promise<BranchPullRequest | undefined> {
  const result = await pi.exec(
    "gh",
    ["pr", "view", "--json", "number,state,isDraft,url"],
    { cwd, timeout: 5_000 },
  );
  if (result.code !== 0) return undefined;
  return parsePullRequest(result.stdout);
}

export default function prStatus(pi: ExtensionAPI): void {
  let sessionGeneration = 0;
  let refreshRun: { generation: number; promise: Promise<void> } | undefined;

  const refresh = (ctx: ExtensionContext, generation: number): Promise<void> => {
    if (refreshRun?.generation === generation) return refreshRun.promise;

    let promise: Promise<void>;
    promise = findPullRequest(pi, ctx.cwd)
      .then((pr) => {
        if (generation !== sessionGeneration) return;
        ctx.ui.setStatus(PR_STATUS_KEY, pr ? renderPullRequestStatus(pr, ctx.ui.theme) : undefined);
      })
      .catch(() => {
        if (generation === sessionGeneration) ctx.ui.setStatus(PR_STATUS_KEY, undefined);
      })
      .finally(() => {
        if (refreshRun?.promise === promise) refreshRun = undefined;
      });

    refreshRun = { generation, promise };
    return promise;
  };

  pi.registerCommand(PR_OPEN_COMMAND, {
    description: "Open the current branch's GitHub pull request in Brave",
    handler: async (_args, ctx) => {
      const pr = await findPullRequest(pi, ctx.cwd).catch(() => undefined);
      if (!pr) {
        ctx.ui.notify("No GitHub pull request found for the current branch.", "warning");
        return;
      }

      let result;
      try {
        result = await pi.exec(
          "open",
          ["-a", "Brave Browser", pr.url],
          { cwd: ctx.cwd, timeout: 5_000 },
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Could not open Brave: ${detail}`, "error");
        return;
      }

      if (result.code !== 0) {
        const detail = result.stderr.trim();
        ctx.ui.notify(detail ? `Could not open Brave: ${detail}` : "Could not open Brave.", "error");
        return;
      }

      ctx.ui.notify(`Opened ${pr.repository} #${pr.number} in Brave.`, "info");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    sessionGeneration++;
    const generation = sessionGeneration;
    ctx.ui.setStatus(PR_STATUS_KEY, undefined);
    if (ctx.mode === "tui") void refresh(ctx, generation);
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (ctx.mode === "tui") void refresh(ctx, sessionGeneration);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    sessionGeneration++;
    ctx.ui.setStatus(PR_STATUS_KEY, undefined);
  });
}
