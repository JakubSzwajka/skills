# delegate

A pi extension that gives one session the `delegate` tool: it runs work in other pi
sessions as Herdr panes, and those workers report back through a handoff file and an
intercom ring. Design: `~/.agents/audit/experiments/herdr-orchestration/DELEGATE-DESIGN.md`.

## Tool surface

```ts
delegate({ action: "start", profile?, brief, name?, cwd?, model?, handoff? })
  → { lane, pane, session, handoff, transitionConfirmed?: false, error? }
delegate({ action: "list" })
  → { lanes: [{ lane, profile, status, contextPct, spendUsd, rang,
                handoffPresent, unread, ownership, owner }] }
delegate({ action: "read", lane })   → { status, handoffPresent, handoff, body }
delegate({ action: "wait", lanes?, timeoutMs? })  → blocks until one lane settles
delegate({ action: "stop", lane })   → kills the process group, closes the pane, deregisters
```

The tool owns three things the caller must never write: the appended worker return
contract, the assigned handoff path, and the doorbell line naming the parent session.
If a worker needs a decision, the contract tells it to ask the orchestrator through
intercom and wait for the reply. The orchestrator answers the question directly instead
of forwarding it blindly.

## Files

- `index.ts` — registration, widget, turn-end nudge, doorbell correlation, load guards
- `delegate.ts` — the five actions, herdr calls, profiles, handoff reads
- `registry.ts` — `~/.pi/agent/delegate/<parent>/lanes.json`, atomic write behind a lock dir
- `types.ts` — records and the herdr runner seam
- `delegate.test.ts` — `node --experimental-strip-types delegate.test.ts`

## Profiles

`~/.agents/pi/delegate/profiles.json`, keyed by name, each with `model` and optional
`readOnly`, `tools`, and `excludeTools`. `readOnly` becomes `--exclude-tools edit` and
keeps `write`, because a worker without `write` cannot produce a handoff. A missing or
malformed file falls back to built-in profiles (worker, scout, reviewer, oracle) and says
so in the tool result. Every built-in profile excludes `ask_user_question` on purpose, so
a worker cannot stall in a dialog that nobody may be watching. The reviewer and oracle
fallbacks use `amazon-bedrock/global.anthropic.claude-opus-5`; worker and scout keep their
existing models. There is no automatic provider-failure retry.

## Safety

- A worker runs with `PI_DELEGATE_ROLE=child`, and the extension registers nothing when
  that variable is set. Depth is 1 by construction.
- Without `HERDR_ENV=1` or the `herdr` binary, the tool still registers and every action
  returns a clear error.
- The registry entry is written before any pane exists, so a failed spawn leaves an
  addressable lane instead of an orphan pane. Once the pane exists, `start` returns the
  lane even if Herdr does not confirm the transition to `working`; in that case
  `transitionConfirmed` is `false`.
- Registry files are not created for sessions with no lanes. Pruning the final lane removes
  the empty file and its directory when no handoff files remain.
- Each lane records its parent process. A new session adopts it only after that process is
  confirmed gone. Lanes with a live or unknown parent stay visible in `list` with
  `ownership: "other-parent"`, but cannot be read, waited on, or stopped by that session.
