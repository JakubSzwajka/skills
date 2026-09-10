# lucy CLI

`lucy` is the human's layer over Herdr: it shows and controls pi sessions across every
project on this machine. Source: `~/DEV/priv/lucy-harness`. No runtime dependencies, no
build step.

**Delegation does not go through lucy.** An agent runs work in other sessions with the
`delegate` tool, which owns the pane, the handoff, the ring and the cleanup. See
`~/.agents/ORCHESTRATION.md`. lucy answers the questions a single session cannot: what is
running anywhere, what is stuck, and what is another session's screen showing.

## Before your first call

Node 24+. The default shell may still be on Node 22, which makes the first command fail
for a reason unrelated to your task:

```sh
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
```

You must be inside a Herdr pane for the commands that create or control panes.

## The four you will actually use

```sh
lucy sessions [--all] [--needs-attention] [--json]
lucy attention [--json]
lucy subagents [--json]
lucy show <target> [--lines N] [--json]
```

- `sessions` — every live pi session, grouped by repository, with state, pane, model and
  context use. `--all` includes other Herdr agent kinds.
- `attention` — every agent in the `blocked` state, across **all** workspaces. `blocked`
  means Herdr saw an approval or question UI, so this is the "who needs me" list. Exit 10
  when at least one exists, 0 when none, 1 on error, so it works in a shell condition.
- `subagents` — `delegate` lanes read from `~/.pi/agent/delegate/<parent>/lanes.json`,
  grouped by parent session, with pane, handoff path, and whether each lane rang and was
  read. No registry yet means no lanes and exit 0.
- `show` — normalized session facts plus the latest terminal lines, 50 by default, 1 to 200.

## Control

```sh
lucy start  <repo-root> <brief> [--name N] [--model M] [--tools LIST]
            [--exclude-tools LIST] [--thinking LEVEL] [--direction right|down]
            [--ratio F] [--workspace W] [--timeout D] [--json]
lucy prompt <target> <instruction> [--timeout D] [--json]
lucy steer  <target> <correction> [--timeout D] [--json]
lucy stop   <target> [--timeout D] [--json]
lucy delegate <repo-root> <brief> --handoff <path> [same flags] [--keep] [--json]
lucy limits [--timeout D] [--json]
```

- `start` splits your current pane, starts pi in it, and delivers a first instruction. It
  waits for readiness and for the prompt to be acknowledged, not for the work to finish.
- `prompt` gives new work to a session that is `idle` or `done`. `steer` corrects one that
  is `working`. Using the wrong one errors.
- `stop` kills the process group it owns, closes the pane, and verifies. Works from any
  state including `done`. Idempotent: an already-gone target returns `alreadyGone: true`
  and exit 0.
- `delegate` is the blocking one-lane path, kept for terminal use. **An agent should use
  the `delegate` tool instead**, which cannot be interrupted out from under its own
  registry. If you ctrl-c `lucy delegate`, the worker survives and nothing owns it.
- `limits` reads provider quota through pi-managed auth.

Every command accepts `--json` and returns stable records. Human output is rendered from
those same records.

## Tool policy

`--tools` allowlists, `--exclude-tools` denylists, both passed straight to pi. There are no
agent presets at this level.

```sh
--exclude-tools edit           # cannot change code, can still write a handoff
--exclude-tools edit,write     # true read-only, no artifact, screen only
```

A session that must write a handoff needs `write`. Excluding both is right only when you
will read the result off the screen.

## Targets

`show`, `prompt`, `steer` and `stop` accept a pane ID, a full or unique-prefix session ID,
a unique agent name, or a unique repository name. `--name` on launch is optional and lucy
generates one, but pass it: you cannot address a session whose name you did not choose.

## delegate exit codes

For `lucy delegate` only. The `delegate` tool reports status instead.

| Exit | Meaning | Pane |
| --- | --- | --- |
| 0 | finished, handoff present | closed, or kept with `--keep` |
| 1 | handoff missing, so the lane failed. Also any uncaught error | closed |
| 2 | blocked, waiting for you | left open |
| 3 | timed out | left open |
| 4 | cleanup failed | still there |

## Known stale surfaces

These still read pi-subagents artifacts, which nothing writes any more, so they report
nothing forever:

- `lucy sessions --needs-attention`
- the **SUBAGENTS** column in `lucy sessions`, permanently `-`
- the `subagentRuns` field in `lucy show`

Use `lucy attention` for blocked agents and `lucy subagents` for lanes.

## Develop

```sh
cd ~/DEV/priv/lucy-harness
npm test          # 78 tests
npm run check     # tsc --noEmit && biome check
```
