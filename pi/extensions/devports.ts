/**
 * devports - browse, group and kill listening ports from inside pi.
 *
 *   /ports        open the modal
 *   ports tool    lets the model list / inspect / kill ports on request
 *
 * Rows are bucketed into groups by rules from ~/.pi/devports.json, which is written
 * with sensible defaults on first run and is yours to edit. First matching rule wins.
 *
 * A row is "stale" when its process has been up more than a day, or when the directory
 * it was started in no longer exists. A deleted cwd is the most reliable sign of a
 * forgotten dev server: nothing is ever coming back for it.
 */

// Type-only import on purpose: pi and orca-managed pi ship the same extension API under
// different package names, so a runtime import of this package would break under OMP.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";

const DEV_RE =
  /node|tsx|vite|next|nodemon|esbuild|bun|deno|webpack|ts-node|python|ruby|php|rails|uvicorn|gunicorn|flask|django|cloudflared|ngrok|serve|http-server|storybook|astro|remix|nuxt/i;

/** Installed apps and OS daemons are long-lived on purpose - never call them stale. */
const SYSTEM_RE = /^\/(Applications|System|Library|usr|sbin|bin|opt\/homebrew\/(opt|Cellar)\/[^/]*\/bin)\//;

// ---------------------------------------------------------------- config

interface GroupRule {
  name: string;
  note?: string;
  /** Every field present must match. Omit `when` entirely for a catch-all. */
  when?: {
    cmd?: string;
    cwd?: string;
    port?: Array<number | [number, number]>;
    olderThanDays?: number;
    cwdGone?: boolean;
    dev?: boolean;
    system?: boolean;
  };
}

const DEFAULT_GROUPS: GroupRule[] = [
  {
    name: "Leftovers — working directory is gone",
    note: "the repo or worktree was deleted; nothing will ever clean these up",
    when: { cwdGone: true },
  },
  {
    name: "Forgotten dev servers — up over a day",
    when: { dev: true, olderThanDays: 1 },
  },
  {
    name: "Tunnels and agents",
    when: { cmd: "cloudflared|ngrok|localtunnel|agent-browser|mcp" },
  },
  {
    name: "Running dev servers",
    when: { dev: true },
  },
  {
    name: "Apps and system",
  },
];

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const CONFIG_PATH = join(AGENT_DIR, "devports.json");
const CONFIG_LABEL = CONFIG_PATH.replace(homedir(), "~");

function loadGroups(): { groups: GroupRule[]; error?: string } {
  try {
    if (!existsSync(CONFIG_PATH)) {
      mkdirSync(AGENT_DIR, { recursive: true });
      writeFileSync(CONFIG_PATH, `${JSON.stringify({ groups: DEFAULT_GROUPS }, null, 2)}\n`);
      return { groups: DEFAULT_GROUPS };
    }
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    if (!Array.isArray(parsed?.groups) || parsed.groups.length === 0) {
      return { groups: DEFAULT_GROUPS, error: "devports.json has no groups; using defaults" };
    }
    return { groups: parsed.groups as GroupRule[] };
  } catch (err: any) {
    return { groups: DEFAULT_GROUPS, error: `devports.json: ${err?.message ?? "unreadable"}; using defaults` };
  }
}

// ---------------------------------------------------------------- scanning

interface Row {
  port: number;
  pid: number;
  age: string;
  ageDays: number;
  cmd: string;
  cwd: string;
  dev: boolean;
  system: boolean;
  cwdGone: boolean;
  old: boolean;
}

function sh(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (err: any) {
    // lsof exits non-zero when nothing matches; its stdout is still useful.
    return typeof err?.stdout === "string" ? err.stdout : "";
  }
}

/** ps etime is "[[dd-]hh:]mm:ss" - returns elapsed days as a fraction. */
function ageInDays(age: string): number {
  const [dayPart, clock] = age.includes("-") ? age.split("-") : ["0", age];
  const parts = clock.split(":").map(Number);
  const [h, m, s] = parts.length === 3 ? parts : [0, parts[0] ?? 0, parts[1] ?? 0];
  return Number(dayPart) + (h * 3600 + m * 60 + s) / 86400;
}

function scan(): Row[] {
  const listen = sh("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pn"]);
  const pairs: Array<{ pid: number; port: number }> = [];
  let pid = 0;
  for (const line of listen.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n")) {
      const addr = line.slice(1);
      const idx = addr.lastIndexOf(":");
      if (idx < 0) continue;
      const port = Number(addr.slice(idx + 1));
      if (!Number.isFinite(port) || port <= 0) continue;
      pairs.push({ pid, port });
    }
  }
  if (pairs.length === 0) return [];

  const pids = [...new Set(pairs.map((p) => p.pid))];

  const psOut = sh("ps", ["-o", "pid=,etime=,command=", "-p", pids.join(",")]);
  const info = new Map<number, { age: string; cmd: string }>();
  for (const line of psOut.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/);
    if (m) info.set(Number(m[1]), { age: m[2], cmd: m[3].trim() });
  }

  const cwdOut = sh("lsof", ["-a", "-p", pids.join(","), "-d", "cwd", "-Fpn"]);
  const cwds = new Map<number, string>();
  let cp = 0;
  for (const line of cwdOut.split("\n")) {
    if (line.startsWith("p")) cp = Number(line.slice(1));
    else if (line.startsWith("n") && !cwds.has(cp)) cwds.set(cp, line.slice(1));
  }

  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const { pid: p, port } of pairs) {
    const key = `${p}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const meta = info.get(p);
    if (!meta) continue;
    const cwd = cwds.get(p) ?? "";
    const system = SYSTEM_RE.test(meta.cmd);
    rows.push({
      port,
      pid: p,
      age: meta.age,
      ageDays: ageInDays(meta.age),
      cmd: meta.cmd,
      cwd,
      dev: DEV_RE.test(meta.cmd) && !system,
      system,
      cwdGone: cwd !== "" && cwd !== "/" && !existsSync(cwd),
      old: age1Plus(meta.age),
    });
  }
  rows.sort((a, b) => a.port - b.port || a.pid - b.pid);
  return rows;
}

const age1Plus = (age: string) => age.includes("-");
const isStale = (r: Row) => r.dev && (r.old || r.cwdGone);

// ---------------------------------------------------------------- grouping

function matches(rule: GroupRule, r: Row): boolean {
  const w = rule.when;
  if (!w) return true;
  if (w.cwdGone !== undefined && w.cwdGone !== r.cwdGone) return false;
  if (w.dev !== undefined && w.dev !== r.dev) return false;
  if (w.system !== undefined && w.system !== r.system) return false;
  if (w.olderThanDays !== undefined && r.ageDays < w.olderThanDays) return false;
  if (w.cmd !== undefined && !new RegExp(w.cmd, "i").test(r.cmd)) return false;
  if (w.cwd !== undefined && !new RegExp(w.cwd, "i").test(r.cwd)) return false;
  if (w.port !== undefined) {
    const hit = w.port.some((p) => (Array.isArray(p) ? r.port >= p[0] && r.port <= p[1] : r.port === p));
    if (!hit) return false;
  }
  return true;
}

interface Group {
  rule: GroupRule;
  rows: Row[];
}

function group(rows: Row[], rules: GroupRule[]): Group[] {
  const groups: Group[] = rules.map((rule) => ({ rule, rows: [] }));
  const spill: Group = { rule: { name: "Ungrouped" }, rows: [] };
  for (const row of rows) {
    const g = groups.find((candidate) => matches(candidate.rule, row));
    (g ?? spill).rows.push(row);
  }
  if (spill.rows.length > 0) groups.push(spill);
  return groups.filter((g) => g.rows.length > 0);
}

// ---------------------------------------------------------------- killing

/** Blocking sleep - the TUI input handler is synchronous. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** SIGTERM everything, wait once, then SIGKILL whatever is left. */
function killPids(pids: number[]): { killed: number[]; failed: number[] } {
  const targets: number[] = [];
  const failed: number[] = [];
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      targets.push(pid);
    } catch {
      failed.push(pid);
    }
  }
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline && targets.some(alive)) sleepSync(100);
  for (const pid of targets.filter(alive)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* raced us to the exit */
    }
  }
  sleepSync(100);
  return { killed: targets.filter((p) => !alive(p)), failed: [...failed, ...targets.filter(alive)] };
}

// ---------------------------------------------------------------- formatting

/** Shortens a path to its last few segments so the identifying part survives. */
function shortCwd(cwd: string): string {
  if (!cwd || cwd === "/") return "";
  const home = homedir();
  const s = cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
  const parts = s.split("/");
  return parts.length > 4 ? `…/${parts.slice(-3).join("/")}` : s;
}

/** Strips the interpreter path and preload flags so the real argv survives truncation. */
function shortCmd(cmd: string): string {
  return cmd
    .replace(/^(\/\S+\/)([^/\s]+)/, "$2")
    .replace(/\s--require\s+\S+/g, "")
    .replace(/\s--import\s+\S+/g, "")
    .replace(/\S*\/node_modules\/\.bin\//g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function table(groups: Group[]): string {
  if (groups.length === 0) return "(nothing listening)";
  const out: string[] = [];
  for (const g of groups) {
    out.push(`## ${g.rule.name} (${g.rows.length})`);
    for (const r of g.rows) {
      const flags = [r.cwdGone ? "CWD-GONE" : "", r.old ? "OLD" : ""].filter(Boolean).join(",") || "-";
      out.push(
        [
          String(r.port).padEnd(6),
          String(r.pid).padEnd(7),
          r.age.padEnd(12),
          flags.padEnd(14),
          shortCmd(r.cmd).slice(0, 58).padEnd(58),
          shortCwd(r.cwd),
        ].join(" "),
      );
    }
    out.push("");
  }
  return out.join("\n").trimEnd();
}

// ---------------------------------------------------------------- component

type Line = { kind: "header"; group: Group; index: number } | { kind: "row"; row: Row };

class PortList {
  private rows: Row[] = [];
  private groups: Group[] = [];
  private lines: Line[] = [];
  private collapsed = new Set<string>();
  private selectedPids = new Set<number>();
  private cursor = 0;
  private offset = 0;
  private staleOnly = false;
  private armed: number[] | null = null;
  private status: string;
  private killedNotes: string[] = [];
  private rules: GroupRule[];

  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(
    private theme: any,
    private height: () => number,
    private onClose: (killed: string[]) => void,
  ) {
    const cfg = loadGroups();
    this.rules = cfg.groups;
    this.status = cfg.error ?? "";
    this.refresh();
  }

  private rebuild(): void {
    const visible = this.staleOnly ? this.rows.filter(isStale) : this.rows;
    this.groups = group(visible, this.rules);
    this.lines = [];
    for (const [index, g] of this.groups.entries()) {
      this.lines.push({ kind: "header", group: g, index });
      if (!this.collapsed.has(g.rule.name)) {
        for (const row of g.rows) this.lines.push({ kind: "row", row });
      }
    }
    if (this.cursor >= this.lines.length) this.cursor = Math.max(0, this.lines.length - 1);
    this.invalidate();
  }

  refresh(): void {
    this.rows = scan();
    const live = new Set(this.rows.map((r) => r.pid));
    for (const pid of [...this.selectedPids]) if (!live.has(pid)) this.selectedPids.delete(pid);
    this.armed = null;
    this.rebuild();
  }

  private rowsShown(): number {
    // header + blank + status + hint lines cost about 7 rows
    return Math.max(4, Math.min(this.lines.length, this.height() - 9));
  }

  private currentGroup(): Group | undefined {
    const line = this.lines[this.cursor];
    if (!line) return undefined;
    if (line.kind === "header") return line.group;
    return this.groups.find((g) => g.rows.includes(line.row));
  }

  private toggle(pids: number[], force?: boolean): void {
    const on = force ?? !pids.every((p) => this.selectedPids.has(p));
    for (const p of pids) {
      if (on) this.selectedPids.add(p);
      else this.selectedPids.delete(p);
    }
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      this.cursor = Math.max(0, this.cursor - 1);
      this.armed = null;
    } else if (matchesKey(data, Key.down)) {
      this.cursor = Math.min(this.lines.length - 1, this.cursor + 1);
      this.armed = null;
    } else if (matchesKey(data, Key.escape) || data === "q") {
      this.onClose(this.killedNotes);
      return;
    } else if (data === " ") {
      const line = this.lines[this.cursor];
      if (line?.kind === "row") this.toggle([line.row.pid]);
      else if (line?.kind === "header") this.toggle([...new Set(line.group.rows.map((r) => r.pid))]);
      this.armed = null;
      this.cursor = Math.min(this.lines.length - 1, this.cursor + 1);
    } else if (matchesKey(data, Key.enter) || matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
      const g = this.currentGroup();
      if (g) {
        if (this.collapsed.has(g.rule.name)) this.collapsed.delete(g.rule.name);
        else this.collapsed.add(g.rule.name);
        this.cursor = this.lines.findIndex((l) => l.kind === "header" && l.group.rule.name === g.rule.name);
        this.rebuild();
      }
    } else if (data === "a") {
      const g = this.currentGroup();
      if (g) this.toggle([...new Set(g.rows.map((r) => r.pid))]);
    } else if (data === "c") {
      this.selectedPids.clear();
      this.armed = null;
      this.status = "selection cleared";
    } else if (data === "s") {
      this.staleOnly = !this.staleOnly;
      this.cursor = 0;
      this.offset = 0;
      this.armed = null;
      this.status = this.staleOnly ? "showing stale only" : "showing everything";
      this.rebuild();
    } else if (data === "r") {
      this.refresh();
      this.status = "rescanned";
    } else if (data === "k") {
      this.doKill();
    } else {
      return;
    }

    const shown = this.rowsShown();
    if (this.cursor < this.offset) this.offset = this.cursor;
    if (this.cursor >= this.offset + shown) this.offset = this.cursor - shown + 1;
    this.invalidate();
  }

  private doKill(): void {
    let targets = [...this.selectedPids];
    if (targets.length === 0) {
      const line = this.lines[this.cursor];
      if (line?.kind === "row") targets = [line.row.pid];
      else if (line?.kind === "header") targets = [...new Set(line.group.rows.map((r) => r.pid))];
    }
    if (targets.length === 0) return;

    const same = this.armed && this.armed.length === targets.length && this.armed.every((p) => targets.includes(p));
    if (!same) {
      this.armed = targets;
      const fromSelection = this.selectedPids.size > 0;
      const what =
        targets.length === 1
          ? `${shortCmd(this.rows.find((r) => r.pid === targets[0])?.cmd ?? "").slice(0, 46)} (pid ${targets[0]})`
          : `${targets.length} processes`;
      this.status = `kill ${fromSelection ? "selected: " : ""}${what}? press k again`;
      return;
    }

    const labels = new Map(
      targets.map((pid) => {
        const r = this.rows.find((x) => x.pid === pid);
        return [pid, r ? `:${r.port} ${shortCmd(r.cmd).slice(0, 50)}` : `pid ${pid}`];
      }),
    );
    const { killed, failed } = killPids(targets);
    for (const pid of killed) this.killedNotes.push(labels.get(pid) ?? `pid ${pid}`);
    this.selectedPids.clear();
    this.armed = null;
    this.refresh();
    this.status =
      failed.length === 0
        ? `killed ${killed.length}`
        : `killed ${killed.length}, could not kill ${failed.join(", ")}`;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
    const t = this.theme;
    const out: string[] = [];
    const staleCount = this.rows.filter(isStale).length;

    const sel = this.selectedPids.size;
    out.push(
      t.fg("accent", " listening ports  ") +
        t.fg(
          "dim",
          `${this.rows.length} open · ${staleCount} stale` +
            (sel > 0 ? ` · ${sel} process${sel === 1 ? "" : "es"} selected` : "") +
            (this.staleOnly ? " · filter: stale" : ""),
        ),
    );
    out.push("");

    const shown = this.rowsShown();
    const window = this.lines.slice(this.offset, this.offset + shown);
    if (window.length === 0) out.push(t.fg("dim", "  nothing to show"));

    for (const [i, line] of window.entries()) {
      const here = this.offset + i === this.cursor;
      const caret = here ? "\u203a" : " ";

      if (line.kind === "header") {
        const g = line.group;
        const pids = new Set(g.rows.map((r) => r.pid));
        const picked = [...pids].filter((p) => this.selectedPids.has(p)).length;
        const box = picked === 0 ? "[ ]" : picked === pids.size ? "[x]" : "[~]";
        const arrow = this.collapsed.has(g.rule.name) ? "▸" : "▾";
        let head = `${caret}${box} ${arrow} ${g.rule.name} ${t.fg("dim", `(${g.rows.length})`)}`;
        if (g.rule.note) head += t.fg("dim", ` — ${g.rule.note}`);
        out.push(here ? t.bg("selectedBg", truncateToWidth(head, width - 1)) : truncateToWidth(head, width - 1));
        continue;
      }

      const r = line.row;
      const box = this.selectedPids.has(r.pid) ? "[x]" : "[ ]";
      const flag = r.cwdGone ? "✗" : r.old ? "·" : " ";
      const left =
        `${caret}${box}  ${flag} ` +
        String(r.port).padEnd(6) +
        t.fg("dim", String(r.pid).padEnd(8)) +
        r.age.padEnd(13);
      const cwd = shortCwd(r.cwd);
      const rest = cwd ? `${shortCmd(r.cmd)}  ${t.fg("dim", cwd)}` : shortCmd(r.cmd);
      let text = truncateToWidth(left + rest, width - 1);
      if (r.cwdGone) text = t.fg("warning", text);
      else if (!r.dev) text = t.fg("muted", text);
      if (here) text = t.bg("selectedBg", truncateToWidth(text, width - 1));
      out.push(text);
    }

    const hidden = this.lines.length - this.offset - shown;
    if (hidden > 0) out.push(t.fg("dim", `  … ${hidden} more below`));
    out.push("");
    if (this.armed) out.push(t.fg("warning", `  ${this.status}`));
    else if (this.status) out.push(t.fg("dim", `  ${this.status}`));
    out.push(t.fg("dim", "  ↑↓ move · space select · a whole group · ← → fold · k kill · c clear"));
    out.push(
      t.fg("dim", "  s stale only · r rescan · esc close   ") +
        t.fg("warning", "✗") +
        t.fg("dim", ` cwd deleted · · over a day · groups: ${CONFIG_LABEL}`),
    );

    this.cachedLines = out;
    this.cachedWidth = width;
    return out;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

// ---------------------------------------------------------------- wiring

export default function (pi: ExtensionAPI) {
  pi.registerCommand("ports", {
    description: "Browse listening ports by group; select and kill forgotten dev servers",
    handler: async (_args: string, ctx: ExtensionContext & { ui: any }) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/ports needs the TUI", "warning");
        return;
      }
      const killed = await ctx.ui.custom<string[]>((tui: any, theme: any, _kb: any, done: any) => {
        const list = new PortList(theme, () => tui?.terminal?.rows ?? 30, done);
        return {
          render: (width: number) => list.render(width),
          handleInput: (data: string) => {
            list.handleInput(data);
            tui.requestRender();
          },
          invalidate: () => list.invalidate(),
        };
      });

      if (killed && killed.length > 0) {
        ctx.ui.notify(`Killed ${killed.length}: ${killed.join("; ")}`, "info");
      }
    },
  });

  pi.registerTool({
    name: "ports",
    label: "Ports",
    description:
      "Inspect or clean up TCP listeners on this machine. action=list groups every listening port using the rules in the devports.json config and shows pid, uptime and the directory each process was started in; action=stale shows only dev processes older than a day or whose working directory was deleted; action=who needs a port; action=kill needs either a port or a list of pids and terminates them (SIGTERM then SIGKILL).",
    parameters: Type.Object({
      action: Type.Union(
        [Type.Literal("list"), Type.Literal("stale"), Type.Literal("who"), Type.Literal("kill")],
        { description: "What to do" },
      ),
      port: Type.Optional(Type.Number({ description: "Port, for who and kill" })),
      pids: Type.Optional(
        Type.Array(Type.Number(), { description: "Process ids to kill, as an alternative to port" }),
      ),
    }),
    async execute(_id: string, params: { action: string; port?: number; pids?: number[] }) {
      const rows = scan();
      const rules = loadGroups().groups;
      const text = (s: string, isError = false) => ({
        content: [{ type: "text" as const, text: s }],
        details: {},
        ...(isError ? { isError: true } : {}),
      });

      if (params.action === "list") return text(table(group(rows, rules)));
      if (params.action === "stale") {
        const stale = rows.filter(isStale);
        return text(
          stale.length === 0
            ? "No stale listeners. Nothing older than a day, no deleted working directories."
            : table(group(stale, rules)),
        );
      }

      if (params.action === "kill" && params.pids?.length) {
        const labels = new Map(rows.map((r) => [r.pid, `:${r.port} ${shortCmd(r.cmd).slice(0, 60)}`]));
        const { killed, failed } = killPids(params.pids);
        return text(
          [
            ...killed.map((p) => `killed ${p} — ${labels.get(p) ?? ""}`),
            ...failed.map((p) => `FAILED ${p} — ${labels.get(p) ?? ""}`),
          ].join("\n") || "nothing to kill",
        );
      }

      if (params.port === undefined) return text(`action=${params.action} requires a port or pids`, true);

      const hits = rows.filter((r) => r.port === params.port);
      if (hits.length === 0) return text(`Nothing listening on ${params.port}.`);
      if (params.action === "who") return text(table(group(hits, rules)));

      const labels = new Map(hits.map((r) => [r.pid, `:${r.port} ${shortCmd(r.cmd).slice(0, 60)}`]));
      const { killed, failed } = killPids([...new Set(hits.map((h) => h.pid))]);
      return text(
        [
          ...killed.map((p) => `killed ${p} — ${labels.get(p) ?? ""}`),
          ...failed.map((p) => `FAILED ${p} — ${labels.get(p) ?? ""}`),
        ].join("\n"),
      );
    },
  });
}
