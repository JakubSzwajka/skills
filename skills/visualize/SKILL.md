---
name: visualize
description: >
  Explain something as one published visual page — charts, hand-drawn SVG diagrams,
  comparison tables, stat tiles, timelines, and callouts that mark the risky parts in
  orange. Use when asked to visualize, chart, diagram, illustrate or "explain visually",
  when a decision or trade-off needs laying out side by side, when research or an
  investigation needs a readable write-up, or when a wall of prose would be better as a
  page someone can scan. Gathers the facts with one delegated scout lane first, then
  draws. Not for mapping a repository's file structure — repo-atlas does that.
---

# Visualize

Produce one page — a single `index.html` — that explains a subject to somebody who
has ten minutes and no patience for prose. Facts come from one delegated scout lane.
Styling is already decided: inline `assets/base.css` and write only HTML, SVG and
(when the reader has a choice to make) a little JavaScript.

Invoking this skill authorises one `delegate` scout lane in step 3.

## What makes this different from a summary

Four commitments. They are the whole point.

1. **Every number traces to a command or a quoted source from this session.**
   Never from memory, never from a doc that might be stale.
2. **Colour means something.** Accent is the spine of the argument. Orange is what
   bites the reader. Grey is context. A colour picked because it looked nice is a
   bug.
3. **Sections are earned.** Each carries one finding and one visual. Six real
   sections beat twenty thin ones.
4. **Discovery is delegated; conclusions come back.** The main context draws the
   page. It does not read everything itself.

## Files in this skill

- `assets/base.css` — the stylesheet. **Predefined. Inline it verbatim.** Only the
  THEME and FONTS blocks may be edited.
- `assets/shell.html` — the page skeleton with slots.
- `assets/interactive.js` — tabs, filter chips, stepper. Inline it only if used.
- `assets/gallery.html` + `assets/build-gallery.sh` — every block rendered once.
  Run the script and look at the page when you are unsure what a block does.
- `reference/blocks.md` — every block, what it is for, copy-paste HTML. **Read this
  before writing any markup.**
- `reference/charts.md` — SVG chart recipes with the coordinate maths.
- `reference/research.md` — evidence rules, output shapes, and the three passes before
  publishing. Step 3 below owns the delegation mechanism.

**Do not load `artifact-design`.** This skill is the design pass; its tokens and
classes replace it. Load `dataviz` when a chart choice is genuinely open, and
`artifact-diagramming` only for diagram mechanics past `reference/charts.md`.

## Procedure

### 1. Frame the question

Write one sentence: what will the reader believe when they finish? That sentence
becomes the `.thesis` paragraph, and every section either supports it or gets cut.

If the ask is vague ("visualize the billing thing"), ask **one** question — who is
reading this, and what decision are they making — then proceed.

### 2. Plan the sections

List them before drafting. For each: the finding, and the one block that carries
it. Use the picker table at the top of `reference/blocks.md`.

A section with no finding is a heading. Delete it. A section with two visuals is
two sections, or one of them is decoration.

### 3. Delegate one scout lane

Use `reference/research.md` for its evidence rules and output shapes. Start one
read-only worker with the `delegate` tool and the `scout` profile:

```
delegate({ action: "start", profile: "scout", brief: "<outcome, owned sources, inputs, non-goals, stop conditions, acceptance>", cwd: "<working directory>" })
```

Give the lane all planned investigations in one brief. This is one large read-only
lane, not one worker per question. Only split it when the sources are disjoint and
one lane cannot cover them. State the non-overlapping source set and why the lanes
cannot collide in each brief, and use the fewest lanes that can finish the work.

Never paste the worker's handoff into the page. It researches; you write. When it
rings, call `delegate({ action: "read", lane: "<lane>" })`, verify its evidence,
then call `delegate({ action: "stop", lane: "<lane>" })`.

### 4. Verify what the page rests on

Read the load-bearing parts yourself. Re-derive every number with your own command.
The scout handoff is fine for inventory, never for the sentence a reader will act on.

Where sources disagree, that disagreement goes on the page.

### 5. Build the page

Working file, always under the same predictable path:

```
/tmp/visualize/<slug>/index.html
```

Copy `assets/shell.html`, fill the slots, inline `assets/base.css` into `<style>`,
pick a theme and a font pairing from the tables below. Write only the classes in
`reference/blocks.md`.

Hard rules:

- No hex colours in the markup. Tokens only.
- Inline `style` is for `width` and `height` percentages only. That is data.
- No external anything except the Google Fonts stylesheet. No CDN, no libraries,
  no remote images.
- Every `<svg>` gets a `viewBox`, `role="img"` and an `aria-label` carrying the
  same claim as its `figcaption`. Marker ids unique across the whole page.
- Wide blocks scroll inside their own wrapper. The body never scrolls sideways.
- Ship a `<script>` only if the page uses `data-tabs`, `data-filter` or
  `data-stepper`.

Section titles state the finding, with the number in it.

- Good: `Two line items are 80% of the bill` · `Nobody owns the retry path`
- Bad: `Cost Analysis` · `Findings` · `Overview`

### 6. Run the three passes

All three are in `reference/research.md`: numbers, claims, render.

**The claims pass runs the `unslop` skill over the page's prose and applies its
edits. This is mandatory.** Headings, captions, callouts, thesis. A layout review
does not read sentences, which is exactly how puffery and wrong numbers survive.

### 7. Publish and hand over

Publish that same file path with the Artifact tool. Give it a short noun-phrase
title, a one-sentence description, and one emoji favicon that fits the subject.

Then tell the user both: the artifact URL, and the local path
`/tmp/visualize/<slug>/index.html`.

### 8. Updating later

Edit the same file and republish. Same conversation: same file path is enough.
Different conversation: pass the artifact `url` so the link survives. Re-run the
numbers pass first — counts rot before anything else does.

## Themes

Swap the six accent values in the THEME block. Light values go in `:root`; dark
values go in **both** dark blocks, or the toggle breaks in one direction.

| Theme | Light: accent / deep / wash | Dark: accent / deep / wash |
| --- | --- | --- |
| Pine (default) | `#347f71` `#092f29` `#e9f2ef` | `#65b9a6` `#a3d8ca` `#14302b` |
| Indigo | `#3f5bab` `#16204a` `#eceff9` | `#8ea4e8` `#b9c6f2` `#1a2140` |
| Plum | `#7a4a86` `#2e1636` `#f3ecf5` | `#c096cc` `#dcc0e4` `#2c1c31` |
| Slate | `#40626f` `#14262d` `#eaf0f2` | `#7fa9b8` `#b0cdd7` `#16292f` |

Leave `--warn` ochre and `--bad` red. They are the alarm, and they have to stay
distinct from the accent. A warm accent means finding a new hue for warn and
proving the two are still telling apart — usually not worth it.

## Fonts

Paste one `<link>` into the shell. Google Fonts is the only external host allowed.

| Pairing | Feel | `family=` string |
| --- | --- | --- |
| Familjen Grotesk + Source Serif 4 | editorial field manual (default) | `Familjen+Grotesk:wght@500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=JetBrains+Mono:wght@400;500;700` |
| Archivo + Literata | technical, signage-like | `Archivo:wght@500;600;700&family=Literata:opsz,wght@7..72,400;7..72,600&family=JetBrains+Mono:wght@400;500;700` |
| Bricolage Grotesque + Newsreader | warmer, more magazine | `Bricolage+Grotesque:wght@500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,600&family=JetBrains+Mono:wght@400;500;700` |
| Inter only | plain, screen-native | `Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700` |

Full URL: `https://fonts.googleapis.com/css2?family=<string>&display=swap`. For the
Inter row, set `--body` to Inter too.

## Scope limits

- **Read-only on the subject.** This skill investigates and publishes. It does not
  refactor code, edit docs or fix the drift it finds.
- **Never print a secret value.** Names of environment variables only.
- **Do not invent a number to fill a chart.** A section with no data is a
  paragraph, or it is nothing.
- **No decoration.** Every mark on the page earns its ink or comes off.
