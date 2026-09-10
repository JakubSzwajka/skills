# Research and verification

## Evidence ownership

Research locates sources and explains what they mean. You write the page and own
every number. Treat every reported claim as a lead, not a fact. Check anything
load-bearing before it reaches the page.

## Requesting evidence

For each question, name where to look, the required output shape, and the evidence
rule. Ask for the shape you need, never a topic.

> Bad: "look into the pricing"
>
> Good: "Return a table of plan name → monthly price → what the plan gates.
> Quote the exact line from the pricing page for each price and give the URL.
> If a price is only visible after signup, say so instead of guessing."

## Evidence rules

1. **Require evidence per claim.** A file path and line, a URL, or the command
   that produced the number. A claim with nothing behind it does not go on the page.
2. **Re-derive every number yourself.** A hallucinated count reads exactly like a
   real one. Counts come from commands you ran, not from a report you received.
3. **Read the load-bearing parts yourself.** Whatever a section's central claim
   rests on, open it. Summaries are fine for inventory, never for the sentence a
   reader will act on.
4. **Where sources disagree, say so on the page.** Two credible sources with
   different numbers is a finding, not a problem to smooth over.

---

# The three passes before publishing

## 1. Numbers pass

Every number on the page traces to a command or a quoted source from this session.
Walk the page and, for each number, name where it came from. Any you cannot trace
gets cut or re-derived. Percentages in `.meter` must add to 100. Bar widths must
be proportional to their printed values.

## 2. Claims pass — this is where `/unslop` runs

**Mandatory. Not optional, and not covered by a layout review.** Structural review
does not read sentences, which is exactly how wrong numbers and puffery survive.

Extract the prose and read it away from the layout:

```bash
sed -e 's/<[^>]*>/ /g' index.html | tr -s ' \n' ' \n' | grep -v '^\s*$' | head -200
```

Then run the **`unslop` skill over that prose** and apply its edits to the file.
Every heading, every caption, every callout. What it kills most often here:

- `figcaption` that says "diagram of the system" instead of the claim
- section titles that are labels (`Cost Analysis`) instead of findings (`Two line
  items are 80% of the bill`)
- the thesis paragraph drifting into "this document explores"
- em dashes, rule-of-three lists, `Not just X, but Y`
- a callout that restates the paragraph above it

Also check in this pass: contradictions between sections, superlatives with no
number behind them, and specifics you cannot source.

## 3. Render pass

```bash
OUT=/tmp/visualize/<slug>/index.html

# every SVG has a viewBox and an aria-label
grep -o '<svg[^>]*' "$OUT" | grep -v viewBox
grep -c '<svg' "$OUT"; grep -c 'aria-label' "$OUT"

# marker ids must be unique across the page
grep -o 'marker id="[^"]*"' "$OUT" | sort | uniq -d

# no hard-coded colour outside the stylesheet
sed -n '/<\/style>/,$p' "$OUT" | grep -nE '#[0-9a-fA-F]{6}\b'

# every anchor resolves
grep -o 'href="#[^"]*"' "$OUT" | sed 's/href="#//;s/"//' | sort -u > /tmp/_a
grep -o 'id="[^"]*"' "$OUT" | sed 's/id="//;s/"//' | sort -u > /tmp/_i
comm -23 /tmp/_a /tmp/_i
```

SVG contents inside the frame, a heuristic that catches labels pushed off the
right edge:

```bash
python3 - "$OUT" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
for i, m in enumerate(re.finditer(r'<svg[^>]*viewBox="([\d.\s-]+)"(.*?)</svg>', src, re.S), 1):
    vb = [float(v) for v in m.group(1).split()]
    w, h, body = vb[2], vb[3], m.group(2)
    xs = [float(v) for v in re.findall(r'\b(?:x|cx|x1|x2)="(-?[\d.]+)"', body)]
    ys = [float(v) for v in re.findall(r'\b(?:y|cy|y1|y2)="(-?[\d.]+)"', body)]
    bad = []
    if xs and (max(xs) > w or min(xs) < 0): bad.append("x %g..%g vs 0..%g" % (min(xs), max(xs), w))
    if ys and (max(ys) > h or min(ys) < 0): bad.append("y %g..%g vs 0..%g" % (min(ys), max(ys), h))
    print("svg #%d: %s" % (i, "ok" if not bad else "OUT OF FRAME " + "; ".join(bad)))
PY
```

It reads coordinates only, so a wide `<rect>` or a long `text-anchor="start"`
label can still overflow. Look at the page too.

Then look at it. Open the file locally:

```bash
open /tmp/visualize/<slug>/index.html
```

or drive the Browser pane at that `file://` path and check, at 1280px and 375px:

- no sideways scroll on `<body>` (wide blocks scroll inside their own wrapper)
- no edge label sitting on top of a box
- both themes resolve — flip with `resize_window` `colorScheme`
- tabs, chips and stepper actually switch, and the console is clean

Screenshots go blank on long pages. Trust DOM measurements over a picture.
