# Subagent history

A local, read-only Pi companion extension for browsing async `pi-subagents` workflows associated with the current session. It opens as a centered modal overlay, with workflow metadata and selected-attempt details rendered inline in one full-width tree.

## Usage

Pi auto-loads `index.ts` from this directory. In an interactive Pi TUI, run:

```text
/subagents-history
```

## Reading the timeline

The modal is one vertical chronological list. Read it from top to bottom:

- The left column is the observed start time.
- Older workflows and attempts appear above newer ones.
- Attempt rows include their workflow and logical key, such as `W1 / review · #1 reviewer`.
- `#1`, `#2`, and so on are attempts within one logical workflow key.
- State and duration appear at the right.
- `--:--:--` means the start time is unavailable.

The view does not infer or visualize parallel groups. If two runs overlap, their start order is still shown vertically.

## Keys

- `↑`/`↓`, `j`/`k`, `Home`/`End`: select
- `Enter`: expand a workflow/logical child, or toggle an attempt's inline summary
- `Space`: expand/collapse rows with children
- `p`, `t`, `a`, `o`: prompt, transcript, activity/tools, output
- `PgUp`/`PgDn`, `Shift+K`/`Shift+J`: scroll details
- `b`: active branch / whole session
- `r`: authoritative refresh
- `Left`/`Backspace`: close the selected attempt's inline detail
- `Esc`, `q`, `Ctrl+C`: close

The dashboard intentionally has no steer, stop, interrupt, or resume controls. `s`, `R`, and `D` do nothing.

## Data and privacy

Discovery is session-scoped. It uses retained parent `subagent` tool-result details, live public extension events, current lifecycle artifacts referenced by those records, and a compact companion ledger under:

```text
~/.pi/agent/subagent-history/<encoded-session-id>/ledger.json
```

It does not scan global temporary directories and does not modify `pi-subagents`. The ledger stores normalized milestone snapshots and bounded lifecycle activity, not streaming token/output chunks. Data stays local. Transcript and output previews are bounded to 64 KiB / 200 lines, lifecycle event tails to 256 KiB, and JSON artifacts to explicit size limits. Reads reject symlinks and require containment under roots recorded by lifecycle status.

## Known limits

- History created before this extension was installed may be unavailable after parent details or `pi-subagents` lifecycle retention is cleaned up.
- Foreground-only runs have no durable parity and are not claimed as complete history.
- Fork prompts remain unavailable unless a future public source provides a durable launch boundary; inherited first-user messages are never presented as launch tasks.
- Native nested projections and lifecycle event history are limited to the bounded data retained by upstream artifacts.
- Per-attempt session usage is aggregated only when the complete child session fits the 1 MiB safety bound; otherwise it remains unknown.
- This adapter supports lifecycle artifact versions through v3 and workflow receipt v1. Unsupported required versions are surfaced as warnings and last-good ledger history is retained.
- Pi's modal overlay API is experimental; final placement and available space remain controlled by Pi's TUI layout.
- Parallel and sequential markers describe observed timestamp overlap. They do not reconstruct unavailable workflow-script intent.
