---
name: repo-atlas
description: >
  Map a codebase as a published visual atlas — where every file lives, where a new one
  goes, which gate enforces it, and how the running system is layered and wired. Use when
  asked to map, chart or explain a repository's structure or architecture, to onboard
  someone to a codebase, to draw module boundaries and their dependencies, or when a
  question starts "where does X live" or "how is this put together". Also use to refresh
  an atlas after a structural change. Not for explaining a single function or debugging —
  this maps territory, it does not read code line by line.
---

# Repo Atlas

Produce one published artifact — a single `index.html` — that answers two questions a
codebase never answers on its own:

- **Where does a thing live, and where does a new one go?** (Lane A)
- **How is the running system put together?** (Lane B)

Both lanes ship in one page with a sticky rail between them. One URL, one entry point.

## What makes this different from a tree dump

Four commitments, and they are the whole point:

1. **Every number is derived from a command in this session.** Never from memory,
   never from a doc that might be stale.
2. **Every boundary states what it refuses**, not only what it contains.
3. **Sections are earned.** Each has a trigger; a repo that does not meet it does not
   get that section. Six full sections beat twenty empty ones.
4. **Discovery fans out to subagents; conclusions come back.** The main context draws
   the map, it does not read the whole repo. See step 3.

## Files in this skill

- `assets/base.css` — the stylesheet. **Predefined. Inline it verbatim.** Styling is
  not this skill's job at run time; the only editable part is the FONTS block.
- `assets/shell.html` — the page skeleton with slots and copy-from snippets.
- `reference/sections.md` — the twenty-five sections, each with asks / from / form /
  trigger. This is the template.
- `reference/devices.md` — the six devices that carry the artifact.
- `reference/verification.md` — the counting rules, the failure modes, and the two
  passes to run before publishing.

## Procedure

### 1. Numbers pass

Run the commands in `reference/verification.md` under "The numbers pass" before
writing anything. Keep the output in scrollback; every count in the artifact traces
back to it. Note in-flight working-tree changes and leave them alone — you describe
HEAD, not somebody's uncommitted work.

### 2. Choose the sections

Read `reference/sections.md`. For each of the twenty-five, decide the trigger is true
or false. Write the list down before drafting. Typical outcomes:

- A single-package library: A1, A2, A7, A8, A9, A10 — six sections, no Lane B diagrams.
- A monorepo service with module boundaries: most of both lanes.
- A repo with no module boundaries: skip B5, B6, B10, B11, B12 and say plainly in B3
  that the layering is thin. **Do not draw a fiction.**

### 3. Discovery — fan out with subagents

**Do not read the codebase serially in the main context.** A repo worth mapping is
bigger than one context window, and reading it linearly burns the budget you need
for drawing. Dispatch parallel subagents, one per investigation, and keep only their
conclusions.

Launch them **in a single message with multiple tool calls** so they run at once.
Each gets a narrow brief and a required output shape.

Typical fan-out for a monorepo — adjust to the sections you chose in step 2:

| Subagent | Brief | Must return |
| --- | --- | --- |
| Tree & counts | Run the numbers pass commands; break down every top-level dir one level deeper | Raw counts with the command that produced each |
| Entry & docs | Root files, docs tree, any README/AGENTS/contributing scheme, the *kind* taxonomy if one exists | Per-file one-line purpose; quote any stated scheme |
| Gates | CI jobs, hooks, `check`/`lint`/`verify` scripts, custom gate scripts | Per gate: what it actually enforces, read from the script, not its name |
| Module boundaries | Module folders, their READMEs, any boundaries doc; **what each refuses** | Per module: owns list, refuses list, and whether each refusal is stated or derived |
| Dependency graph | Declared dependencies of every workflow; cross-module imports | Per workflow: the modules it declares, each classified ask / tell / both |
| Data ownership | Schema, migrations, which code writes which table | Table → owner, and every shared or split-ownership case |
| Lifecycle | The dominant status enum and every transition guard, **including timers, cron and background passes** | State list, transitions with their trigger, terminal states, any way back |
| Client layers | Client source tree, test file distribution by extension | Folder purposes, test counts by kind |
| Build & release | Dockerfiles, deploy workflows, tags, environments | The path from commit to running, and the point of no return |

Rules for the fan-out:

- **Give each subagent the output shape you need**, not a topic. "Return a table of
  table-name → owning module, and flag every table written by more than one" beats
  "look at the database".
- **Require file paths and commands as evidence.** A subagent claim with no path
  behind it does not go in the artifact.
- **Re-derive every number yourself.** Subagents are for finding *where things are
  and what they mean*; counts come from commands you ran in the main context. A
  hallucinated count from a subagent is indistinguishable from a real one, and it
  is the single most likely way this skill publishes something false.
- **Never dump subagent reports into the artifact.** They are research; you write
  the page.
- Follow-ups go back to the same subagent so it keeps its context, rather than
  spawning a fresh one that re-reads everything.

### 4. Read the load-bearing parts yourself

Whatever a section's central claim rests on, read it directly. Subagent summaries
are fine for inventory; they are not fine for the sentence a reader will act on.

Read yourself, always: the state machine's transition guards, the one workflow that
gets the close-up, and any refusal you are about to assert. Docs drift — where a doc
disagrees with the code, the code wins and the disagreement goes in the colophon as
observed drift.

Apply the rules in `reference/verification.md`: count the thing not the files, read
declared dependencies not call sites, follow timers and background passes.

### 5. Write titles that carry findings

Each section title states what was found, with its number in it.

- Good: `Seven workspaces` · `Four domains and a drawer` · `Which way the calls point`
- Bad: `Workspace Inventory` · `Documentation Structure` · `Dependencies`

The rail and contents links use short labels; the `<h2>` carries the finding.

### 6. Build the page

Copy `assets/shell.html`, fill every `{{SLOT}}`, inline `assets/base.css` into the
`<style>` block. No second stylesheet, no inline colour literals — use the tokens.

Pick one font pairing and paste its link line:

| Pairing | Feel | Link |
| --- | --- | --- |
| Archivo + Literata | technical, signage-like (default) | `https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Literata:opsz,wght@7..72,400;7..72,600&family=JetBrains+Mono:wght@400;500;700&display=swap` |
| Familjen Grotesk + Source Serif 4 | field-manual, editorial | `https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=JetBrains+Mono:wght@400;500;700&display=swap` |
| Bricolage Grotesque + Newsreader | warmer, more editorial | `https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,600&family=JetBrains+Mono:wght@400;500;700&display=swap` |

Google Fonts is the only external host the Artifact CSP allows. Everything else must
be inline.

For diagrams: hand-author `<svg>` with the classes in `base.css`. No libraries, no
external images, no `<style>` inside the SVG. Give each `<svg>` a `role="img"` and an
`aria-label` carrying the same claim as its `figcaption`. Define arrow markers per
SVG with unique ids.

### 7. Claims pass

Run the prose extraction in `reference/verification.md`. Read the sentences, not the
layout. Check numbers, contradictions, superlatives, invented specifics.

**This pass is not optional and not covered by a layout review.** Four wrong numbers
and one self-contradiction survived a full structural review of a previous atlas
because structural review does not read sentences.

### 8. Render pass, then publish

Run the structure checks in `reference/verification.md`: SVG text inside its viewBox,
no edge labels colliding with boxes, no sideways page scroll at 375px, every anchor
resolving, both themes resolving. Screenshots go blank on long pages — trust the DOM
measurements over a picture.

Publish with the Artifact tool. Title is `<Repo> Atlas`. Favicon `🧭`. Description is
one sentence naming the repo and what the page answers.

### 9. Refreshing an existing atlas

Republish the **same file path** to keep the URL. Re-run the numbers pass first —
counts are the first thing to rot. Update the colophon's commit and date.

## Scope limits

- **Do not modify the repo** being mapped. This skill reads and publishes; it does not
  refactor, rename, or fix the drift it finds. Report drift in the colophon.
- **Never print secret values.** Environment variable names only.
- If the repo is not a git repository, say so — the counting rules depend on
  `git ls-files`, and file-system walks include build output that makes every number
  wrong.
