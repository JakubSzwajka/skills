# compact-tools

The transcript view for this machine: one scannable line per tool call, rules around prose.

```
 ┊ $        sed -n '155,175p' node_modules/@effect/cli/src/Command.ts + 1 more     24 lines    0.9s
 ────────────────────────────────────────────────────────────────────────────────

 Now I'll apply the fixes myself: flatten the command tree (upstream @effect/cli renders depth-3
 paths incorrectly), add the two rationale comments, and add a help contract test.

 ────────────────────────────────────────────────────────────────────────────────
 ┊ write    agents/cli/src/commands.ts                                           76 written    0.1s
 ┊ Thinking...
 ┊ todo     update · 3 · completed                                                   1 line    0.0s
 ┊ subagent review the CLI help contract · reviewer · async                         2 lines    3.2s
 ✗ task_log next                                                                     failed    0.0s
 ✗ $        npm test                                                                 failed   12.4s
```

Pi's default row is a padded `Box` preceded by a transcript spacer — four rows of screen for one
line of information, each a coloured block. This replaces that with a fixed grid:

| Column | Content |
|---|---|
| gutter | `┊` binds a run of calls into one block, red `✗` when the call failed |
| name | eight characters, `$` for bash; longer names push their arguments right |
| arguments | cwd-relative path, then `~`; long values truncated in the middle |
| summary | right-aligned: lines, hits, files, `+added -removed`, `failed`, `≥n` when truncated |
| duration | right-aligned, measured from `tool_execution_start` to `tool_execution_end` |
| tone | how bright the row is — see below |

## Tone

Colour carries meaning instead of filling the row. Rows are ranked by how much they should cost
you to read, so a run of lookups sinks into the background and a file mutation is what the eye
lands on:

| Tone | Tools | Reads as |
|---|---|---|
| `mutate` | `write`, `edit` | bold light name, accent arguments — the loudest row |
| `run` | `bash` | bold light name, light arguments |
| `read` | `read`, `grep`, `find`, `ls` | muted throughout, the same grey as a hidden thinking run |
| `quiet` | every tool owned by another extension | dim throughout |
| error | any failed call | red from gutter to summary, whatever the tone |

`ctrl+o` expands every tool output at once (it is a global toggle, so rows carry no per-row hint);
expanded output is indented under the gutter and capped at 400 lines.

## Files

| File | Job |
|---|---|
| `index.ts` | per-tool presenters for the seven built-ins, timing, the prose separator |
| `row.ts` | the grid: columns, truncation, colours, the `CompactLine` component |
| `command.ts` | reading a shell command the way a person skims it |
| `transcript.ts` | the render patches: foreign rows, gap trimming, flush thinking runs |
| `index.test.ts` | 30 tests |

## The three surfaces it touches

**Built-in tools** go through the public API. Each of `read`, `bash`, `edit`, `write`, `grep`,
`find`, `ls` is re-registered with `renderShell: "self"` plus `renderCall`/`renderResult`.
Execution is unchanged — it delegates to the built-in definition for `ctx.cwd`, and descriptions,
schemas and prompt contributions come from that same definition. Interactive mode warns on startup
that built-ins were overridden; that is expected.

**Tools owned by other extensions** (`todo`, `subagent`, `task_log`, MCP tools) cannot be
re-registered — their `execute` is not ours to reimplement. They are rendered from the patch
instead, which reads `toolName`, `args`, `result` and `getTextOutput()` off the row and draws the
same grid. Arguments are skimmed generically: known keys first (`path`, `command`, `subject`,
`agent`, `action`, `id`, `status`, …), booleans shown by name when true, values joined with `·`.
Rows carrying images, hidden rows, and rows we own fall through to the original renderer.

**Assistant prose** gets a `---` rule above and below through `registerMarkdownTransformer`, which
is public API and needs no patch. The trailing rule is added only once streaming ends, so nothing
jumps mid-answer. User messages are left alone.

**Hidden thinking runs** join the same column: `setHiddenThinkingLabel("┊ Thinking...")` puts the
label in the gutter, and `AssistantMessageComponent.prototype.render` is wrapped with the same
blank-edge trim so the line sits flush inside a block of tool rows. This only applies while
thinking blocks are hidden — with `hideThinkingBlock: false`, or after `ctrl+t`, pi renders the
reasoning itself and the label is unused.

## The patch

Every transcript item emits its own leading blank line, and the default tool shell adds a padded
row above and below its content. Neither is reachable from the extension API, so
`transcript.ts` wraps `ToolExecutionComponent.prototype.render`: it either renders a foreign row
as our grid line, or trims the blank lines framing whatever the original renderer produced. Blank
lines *inside* an expanded output are kept, and escape sequences carried by a dropped line — the
OSC 133 shell-integration zone markers live on the first line — are moved onto the kept text.

This is a monkey patch on a pi internal. It is isolated in one file and fails soft: if a future pi
build stops exporting `ToolExecutionComponent` or renames `render`, `patchToolRows()` returns
`false`, the built-in rows keep their public-API rendering, and foreign rows go back to their own.

## Tests

```bash
node --test index.test.ts
```

Resolution of `@earendil-works/*` comes from the symlinks in `../node_modules/@earendil-works/`
(gitignored). Recreate them with:

```bash
PI=$(dirname $(dirname $(readlink -f $(which pi))))/lib/node_modules/@earendil-works/pi-coding-agent
mkdir -p ../node_modules/@earendil-works && cd ../node_modules/@earendil-works
ln -sfn "$PI" pi-coding-agent
for p in pi-tui pi-agent-core pi-ai; do ln -sfn "$PI/node_modules/@earendil-works/$p" "$p"; done
```
