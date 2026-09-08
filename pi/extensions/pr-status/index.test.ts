import assert from "node:assert/strict";
import test from "node:test";
import prStatus, {
  parsePullRequest,
  PR_OPEN_COMMAND,
  PR_STATUS_KEY,
  renderPullRequestStatus,
} from "./index.ts";

const openPr = JSON.stringify({
  number: 42,
  state: "OPEN",
  isDraft: false,
  url: "https://github.com/acme/rocket/pull/42",
});

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function createHarness(exec: (...args: any[]) => Promise<any>) {
  const commands = new Map<string, { handler: (...args: any[]) => Promise<void> }>();
  const handlers = new Map<string, (...args: any[]) => void>();
  prStatus({
    exec,
    registerCommand(name: string, command: { handler: (...args: any[]) => Promise<void> }) {
      commands.set(name, command);
    },
    on(name: string, handler: (...args: any[]) => void) {
      handlers.set(name, handler);
    },
  } as any);
  return { commands, handlers };
}

function createContext(statuses: Array<{ key: string; value: string | undefined }>) {
  return {
    cwd: "/work/rocket",
    mode: "tui",
    ui: {
      theme: {
        fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
      },
      setStatus(key: string, value: string | undefined) {
        statuses.push({ key, value });
      },
    },
  } as any;
}
test("parses active, draft, merged, and closed pull requests", () => {
  assert.deepEqual(parsePullRequest(openPr), {
    repository: "rocket",
    number: 42,
    status: "active",
    url: "https://github.com/acme/rocket/pull/42",
  });
  assert.equal(parsePullRequest(JSON.stringify({
    number: 43,
    state: "OPEN",
    isDraft: true,
    url: "https://github.com/acme/rocket/pull/43",
  }))?.status, "draft");
  assert.equal(parsePullRequest(JSON.stringify({
    number: 44,
    state: "MERGED",
    isDraft: false,
    url: "https://github.com/acme/rocket/pull/44",
  }))?.status, "merged");
  assert.equal(parsePullRequest(JSON.stringify({
    number: 45,
    state: "CLOSED",
    isDraft: false,
    url: "https://github.com/acme/rocket/pull/45",
  }))?.status, "closed");
});

test("rejects malformed or unexpected gh output", () => {
  assert.equal(parsePullRequest("not json"), undefined);
  assert.equal(parsePullRequest(JSON.stringify({ number: 0, state: "OPEN", url: "https://github.com/a/b/pull/0" })), undefined);
  assert.equal(parsePullRequest(JSON.stringify({ number: 1, state: "UNKNOWN", url: "https://github.com/a/b/pull/1" })), undefined);
  assert.equal(parsePullRequest(JSON.stringify({ number: 1, state: "OPEN", url: "https://example.com/a/b/issues/1" })), undefined);
});

test("renders the requested status colors", () => {
  const theme = { fg: (color: string, text: string) => `${color}:${text}` } as any;
  const url = "https://github.com/acme/rocket/pull/1";
  assert.equal(renderPullRequestStatus({ repository: "rocket", number: 1, status: "draft", url }, theme), "muted:◇ rocket #1 draft");
  assert.equal(renderPullRequestStatus({ repository: "rocket", number: 2, status: "active", url }, theme), "success:● rocket #2 active");
  assert.equal(renderPullRequestStatus({ repository: "rocket", number: 3, status: "merged", url }, theme), "accent:◆ rocket #3 merged");
  assert.equal(renderPullRequestStatus({ repository: "rocket", number: 4, status: "closed", url }, theme), "muted:× rocket #4 closed");
});

test("registers a command that opens the current PR in Brave", async () => {
  const calls: any[][] = [];
  const notifications: any[][] = [];
  const { commands } = createHarness(async (...args: any[]) => {
    calls.push(args);
    return calls.length === 1
      ? { code: 0, stdout: openPr, stderr: "" }
      : { code: 0, stdout: "", stderr: "" };
  });

  assert.deepEqual([...commands.keys()], [PR_OPEN_COMMAND]);
  await commands.get(PR_OPEN_COMMAND)?.handler("", {
    cwd: "/work/rocket",
    ui: { notify: (...args: any[]) => notifications.push(args) },
  });

  assert.deepEqual(calls, [
    ["gh", ["pr", "view", "--json", "number,state,isDraft,url"], { cwd: "/work/rocket", timeout: 5_000 }],
    ["open", ["-a", "Brave Browser", "https://github.com/acme/rocket/pull/42"], { cwd: "/work/rocket", timeout: 5_000 }],
  ]);
  assert.deepEqual(notifications, [["Opened rocket #42 in Brave.", "info"]]);
});

test("reports an error when Brave cannot open", async () => {
  const notifications: any[][] = [];
  let callCount = 0;
  const { commands } = createHarness(async () => {
    callCount++;
    if (callCount === 1) return { code: 0, stdout: openPr, stderr: "" };
    throw new Error("Brave Browser was not found");
  });

  await commands.get(PR_OPEN_COMMAND)?.handler("", {
    cwd: "/work/rocket",
    ui: { notify: (...args: any[]) => notifications.push(args) },
  });

  assert.deepEqual(notifications, [["Could not open Brave: Brave Browser was not found", "error"]]);
});

test("warns instead of opening Brave when the branch has no PR", async () => {
  const calls: any[][] = [];
  const notifications: any[][] = [];
  const { commands } = createHarness(async (...args: any[]) => {
    calls.push(args);
    return { code: 1, stdout: "", stderr: "no pull requests found" };
  });

  await commands.get(PR_OPEN_COMMAND)?.handler("", {
    cwd: "/work/rocket",
    ui: { notify: (...args: any[]) => notifications.push(args) },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(notifications, [["No GitHub pull request found for the current branch.", "warning"]]);
});

test("loads the current branch PR and clears the status when none exists", async () => {
  const calls: any[][] = [];
  const results = [
    { code: 0, stdout: openPr, stderr: "" },
    { code: 1, stdout: "", stderr: "no pull requests found" },
  ];
  const { handlers } = createHarness(async (...args: any[]) => {
    calls.push(args);
    return results.shift();
  });
  assert.deepEqual([...handlers.keys()], ["session_start", "agent_settled", "session_shutdown"]);

  const statuses: Array<{ key: string; value: string | undefined }> = [];
  const ctx = createContext(statuses);
  handlers.get("session_start")?.({}, ctx);
  await tick();

  assert.deepEqual(calls[0], [
    "gh",
    ["pr", "view", "--json", "number,state,isDraft,url"],
    { cwd: "/work/rocket", timeout: 5_000 },
  ]);
  assert.deepEqual(statuses.at(-1), {
    key: PR_STATUS_KEY,
    value: "<success>● rocket #42 active</success>",
  });

  handlers.get("agent_settled")?.({}, ctx);
  await tick();
  assert.deepEqual(statuses.at(-1), { key: PR_STATUS_KEY, value: undefined });
});

test("silently clears status when gh fails", async () => {
  const { handlers } = createHarness(async () => { throw new Error("gh missing"); });
  const statuses: Array<{ key: string; value: string | undefined }> = [];
  const ctx = createContext(statuses);
  handlers.get("session_start")?.({}, ctx);
  await tick();
  assert.deepEqual(statuses.at(-1), { key: PR_STATUS_KEY, value: undefined });
});

test("ignores an async result after session shutdown", async () => {
  let resolveExec!: (value: any) => void;
  const pending = new Promise<any>((resolve) => { resolveExec = resolve; });
  const { handlers } = createHarness(async () => pending);
  const statuses: Array<{ key: string; value: string | undefined }> = [];
  const ctx = createContext(statuses);

  handlers.get("session_start")?.({}, ctx);
  handlers.get("session_shutdown")?.({}, ctx);
  resolveExec({ code: 0, stdout: openPr, stderr: "" });
  await tick();

  assert.equal(statuses.some(({ value }) => value?.includes("rocket #42")), false);
  assert.deepEqual(statuses.at(-1), { key: PR_STATUS_KEY, value: undefined });
});
