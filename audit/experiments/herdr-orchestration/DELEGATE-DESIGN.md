# delegate: minimal design

A pi extension giving one session the ability to run work in other sessions. Session
scoped. Talks to herdr and pi directly, no CLI dependency.

Status: design only, nothing built.

## Boundary

```
delegate tool   one session → its own workers.        agent-facing, session-scoped
lucy CLI        you → master sessions across repos.   human-facing, cross-project
```

They do not call each other. Both read herdr. If they ever need to share anything it
is the lane registry file below, read-only.

## What it must kill

Every item is a real failure from 2026-09-09 and 2026-09-10, not a hypothetical.

| Failure | Killed by |
| --- | --- |
| Waited on `--until idle`, worker had finished in `done` | the tool owns waiting; the agent never writes the flags |
| Operator aborted a blocking call, pane orphaned | registry written before the brief is delivered |
| Brief quoting bugs in heredocs, twice | structured tool arguments |
| Doctrine said `intercom status`, no such executable | the tool injects the doorbell; the agent never writes it |
| Worker inherited "you orchestrate, do not implement" | child marked by env var, doctrine reads it |
| Read-only lane could not write its own handoff | profile owns tool policy, not the caller |
| Handoff path typo cost a lane its whole budget | the tool assigns the path |

## Profiles

`~/.agents/pi/delegate/profiles.json`. Seeded from the preserved
`audit/experiments/herdr-orchestration/snapshot/subagents-model-routing.json`.

```json
{
  "worker":   { "model": "openai-codex/gpt-5.6-sol:high" },
  "scout":    { "model": "openai-codex/gpt-5.6-luna",     "readOnly": true },
  "reviewer": { "model": "anthropic/claude-opus-5:high",   "readOnly": true },
  "oracle":   { "model": "anthropic/claude-opus-5:high",   "readOnly": true }
}
```

Fields, all optional except `model`:

- `model` — `provider/id[:thinking]`
- `readOnly` — sugar for `excludeTools: ["edit"]`. Keeps `write`, because a worker
  cannot produce a handoff without it. This is the mistake the doctrine audit caught.
- `tools` / `excludeTools` — explicit lists when `readOnly` is too blunt
- `fallbackModel` — one retry target on provider failure, no chains

No `extensions` field in v1. Children inherit the ambient set, which is how the
doorbell reaches them at all. Add the field when a real need appears, not before.

## Tool surface

Five actions. Async is not a flag, it is the only way `start` behaves.

```ts
delegate({ action: "start", profile, brief, name?, cwd?, model?, handoff? })
  → { lane, pane, session, handoff }        returns immediately

delegate({ action: "list" })
  → { lanes: [{ lane, profile, status, contextPct, spendUsd, rang, handoffPresent, unread }] }

delegate({ action: "read", lane })
  → { status, handoffPresent, handoff, body }, and marks the lane read

delegate({ action: "wait", lanes?, timeoutMs? })
  → blocks until a lane settles. Explicit, never implicit.

delegate({ action: "stop", lane })
  → terminates the process group, closes the pane, deregisters. Idempotent.
```

`fallbackModel` is accepted in a profile but nothing reads it yet; there is no
provider-failure retry. Either build it or drop the field.

`steer` is deliberately absent from v1. `lucy steer` covers it and mid-flight
correction is rare enough not to earn surface area yet.

## What start actually does

```
1. resolve profile → model, tool policy
2. assign handoff path   ~/.pi/agent/delegate/<parent>/<lane>.md
3. write registry entry  BEFORE anything is spawned
4. herdr pane split --current --direction right --ratio 0.4 --cwd <cwd>
5. herdr agent start <lane> --kind pi --pane <id> -- \
       --name <lane> --model <model> [--exclude-tools …] \
       --thinking <level>
   env: PI_DELEGATE_ROLE=child  PI_DELEGATE_PARENT=<parent session id>
6. herdr agent prompt <lane> "<brief + appended return contract>" --wait --until working
7. update registry with pane, session id, started time
8. return
```

Step 3 before step 4 is the whole orphan fix. If the process dies at any later point,
the registry still knows the pane exists.

## The appended return contract

The caller writes the brief. The tool appends this, always, so it cannot be forgotten:

```
You are a worker. Implement the work yourself. Do not delegate.
Write your handoff to <assigned path>. That file is your result; a terminal
nobody reads is not.
When the handoff is written, use the intercom tool to message session <parent>
with the handoff path and a one-line outcome. Do this even if you failed or only
partly finished.
```

## Recursion guard

`PI_DELEGATE_ROLE=child` is set on the worker. The extension checks it at load and
does not register the `delegate` tool when it is present. One line, self-enforcing,
and it doubles as the signal doctrine needs to tell a worker it is a worker.

Depth is therefore 1 by construction. If depth 2 is ever wanted it becomes a config
value rather than a redesign.

## Registry

`~/.pi/agent/delegate/<parentSessionId>/lanes.json`

```json
{ "lanes": [
  { "lane": "doc-audit", "profile": "scout", "pane": "w0:p17",
    "session": "01a08b24", "cwd": "…", "handoff": "…/doc-audit.md",
    "started": "…", "rang": "…", "read": false, "closed": false }
]}
```

Plain JSON on disk, not in-memory. Survives a crash, inspectable by hand, and later
readable by lucy if that turns out to be useful. Intercom's 64 KiB extension-channel
state is the alternative and is not needed for session-scoped data.

## Doorbell correlation

The worker's ring is an ordinary intercom message, so it triggers a turn. The
extension watches inbound messages, matches the sender session against the registry,
and marks the lane `rang`. If the message cannot be matched it is left alone; a
stranger's message is not a lane event.

The ring is the wake. The handoff file is the result. Never confuse them: a lane that
rang but whose file is missing has failed.

## Widget

`ctx.ui.setWidget("delegate", …)`, one line per live lane:

```
delegate  doc-audit    scout     working  41% ctx  $0.30  ring:—
          doctrine-a…  scout     done     36% ctx  $0.21  ring:✓  unread
          fixer        worker    BLOCKED  22% ctx  $0.88  needs you
```

`BLOCKED` sorts to the top and stays loud. Historically eight lanes were lost to an
unanswered pause, which makes it the most expensive state on the board. `unread`
marks a lane that finished and whose handoff nobody has opened.

The widget disappears when no lanes are live. This is the part that only works
in-process, and it is the main reason to build a tool rather than shell out.

## Surviving the orchestrator

The registry is a file, so a lane outlives the session that started it. On
`session_start` the extension reads the registry for its cwd, asks herdr which of
those panes still exist, and adopts them. A crashed or closed orchestrator therefore
leaves adoptable work rather than orphans.

Anything in the registry whose pane is gone is marked closed and kept for one day, so
a finished lane can still be read after its pane has been reclaimed.

## Turn-end nudge

`pi.on("turn_end")`:

- a `blocked` lane prints a line naming it and what it is waiting for, every turn
  until it is answered
- a terminal, unread lane prints one line naming it

Notify, never block. The operator is allowed to walk away, and a tool that refuses to
end a turn is a tool you disable.

## Deliberately absent

The parts that made pi-subagents heavy:

- no acceptance gates or `outputSchema`
- no workflow scripts, lanes-of-lanes, or fan-out DSL
- no managed worktrees
- no deadline kills
- no `steer`, no `resume`, no `interrupt` in v1

If this grows an output schema, we have rebuilt the thing we removed.

## Build order

1. `start`, `list`, `stop`, plus the registry and the appended return contract
2. doorbell correlation and `read`
3. widget
4. `wait` and the turn-end nudge

Items 1 and 2 remove every failure in the table above. 3 is why it is in-process.
4 is comfort.
