# Block catalog

Every class in `assets/base.css`, with the shape it wants and the job it does.
Copy the HTML. Do not invent classes, and do not write a hex value in the page.

**One carrier per section.** A section is a paragraph plus one visual. Two visuals
in a section means it is two sections, or one of them is decoration.

**Inline `style` is allowed for `width` and `height` percentages only** — that is
data. Colour, spacing and borders come from the stylesheet.

---

## Choosing the carrier

| The thing you are showing | Block |
| --- | --- |
| Parts and how they connect | `figure` + hand-authored SVG |
| Sizes you want compared | `.bars` |
| A whole split into parts | `.meter` |
| Headline numbers | `.stats` |
| Several things with the same fields | `.cards` |
| Two options weighed against each other | `.compare` |
| What happened, in order, with dates | `.timeline` |
| What to do, in order | `.steps` |
| A short chain of stages | `.flow` |
| Rows of facts, many columns | `.tbl-wrap` + `table` |
| Who relates to what, many-to-many | `table.matrix` |
| Label on the left, a spray of things on the right | `.ledger` |
| A hierarchy, files, an outline | `.tree` |
| Someone's exact words, or a spec line | `.quote` |
| The thing that will bite the reader | `.callout` |
| Same shape, several variants the reader picks between | `.tabs` |
| A long list the reader wants to narrow | `.chips` + `data-tags` |
| One walkthrough, one screen at a time | `.stepper` |
| Detail most readers skip | `details.disclose` |

---

## Masthead

```html
<header class="masthead">
  <div class="stamp">subject &middot; 21 Aug 2026</div>
  <h1>The title states the finding</h1>
  <p class="thesis">One paragraph. What the reader will believe by the end, and
  <strong>the one sentence</strong> that is the whole argument.</p>
  <nav class="contents" aria-label="Contents">
    <a href="#s1"><span class="n">01 &middot; cost</span><span class="t">Where the money goes</span></a>
  </nav>
</header>
```

## Section

```html
<section id="s1">
  <div class="sec-head">
    <div class="sec-tag">01 &middot; cost</div>
    <h2>Two line items are 80% of the bill</h2>
  </div>
  <p>The point, in prose, before the picture. <span class="c">inline code</span> for
  identifiers.</p>
  <!-- one carrier -->
</section>
```

## figure

Wraps every SVG. `figcaption` states the claim the drawing supports, never
"diagram of the system". Add `.wide` when the drawing needs more than ~620px.

```html
<figure class="wide">
  <svg viewBox="0 0 900 380" role="img" aria-label="Same sentence as the caption.">
    …
  </svg>
  <figcaption>What this drawing proves, plus where the numbers came from.</figcaption>
</figure>
```

SVG classes: `.node` `.node-on` `.node-flat` `.node-store` `.node-warn` `.zone`
`.lbl` `.lbl-sm` `.sub` `.sub-on` `.sub-warn` `.edge` `.edge-on` `.edge-warn`
`.edge-dash` `.elabel` `.chip`. Chart classes are in `charts.md`.

Arrow marker, one `<defs>` per SVG with a unique id:

```html
<defs>
  <marker id="a1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7"
          orient="auto-start-reverse">
    <path d="M0,1 L9,5 L0,9 z" fill="var(--muted)"/>
  </marker>
</defs>
<path class="edge" marker-end="url(#a1)" d="M160,90 H250 V120 H350"/>
```

Rules: no `<style>` inside the SVG, no external images, no libraries. Boxes on a
grid, edges as orthogonal `H`/`V` paths, labels above horizontal runs. A red mark
in the SVG must mean the same thing as a red mark in the prose.

## .bars

Ranked comparison. Sort descending unless the order is the story. Always print
the value; the bar is for the eye, the number is the fact.

```html
<div class="bars">
  <div class="bar"><span class="bl">Hosting</span>
    <span class="bt"><i style="width:72%"></i></span><span class="bv">431 zł</span></div>
  <div class="bar warn"><span class="bl">Stripe fees</span>
    <span class="bt"><i style="width:41%"></i></span><span class="bv">246 zł</span></div>
  <div class="bar flat"><span class="bl">Domains</span>
    <span class="bt"><i style="width:8%"></i></span><span class="bv">48 zł</span></div>
</div>
```

`.bar.warn` for the item that is the problem, `.bar.flat` for context rows,
`.bar.bad` for a loss.

## .meter

One row, one hundred percent. Segments must add to 100.

```html
<div class="meter">
  <i style="width:62%" data-s="1"></i>
  <i style="width:23%" data-s="3"></i>
  <i style="width:15%" data-s="0"></i>
</div>
<div class="key">
  <span><i class="s1"></i>Shipped 62%</span>
  <span><i class="s3"></i>In review 23%</span>
  <span><i class="flat"></i>Untouched 15%</span>
</div>
```

## .stats

Three to five tiles. Every tile is a number a reader could quote. No tile without
a source behind it.

```html
<div class="stats">
  <div class="stat on"><span class="v">19</span><span class="l">workflows</span>
    <span class="d up">+4 since June</span></div>
  <div class="stat"><span class="v">2.4s</span><span class="l">p95 load</span>
    <span class="d">unchanged</span></div>
  <div class="stat warn"><span class="v">0</span><span class="l">tests on billing</span>
    <span class="d down">was 11</span></div>
</div>
```

## .cards

Several things with the same fields. The `.no` list is what makes this worth
drawing: state what each thing **refuses**, not what it happens to lack.

```html
<div class="cards">
  <article class="card">
    <div><span class="role">core</span><h3>service-offering</h3></div>
    <div><div class="heading">Owns</div>
      <ul class="yes"><li>Catalogs, items, prices.</li></ul></div>
    <div class="no-block"><div class="heading">Refuses</div>
      <ul class="no"><li>Quote amounts.</li></ul></div>
  </article>
</div>
```

`.card.secondary` for supporting items, `.card.warn` for the one that is a problem.

## .compare

Two or three options, same fields in the same order in each column, so the eye
can travel sideways. Mark the recommendation with `.on`.

```html
<div class="compare">
  <div class="side"><div class="side-head">Stay on Easytools</div>
    <ul><li>5% of every sale.</li><li>Zero build time.</li></ul></div>
  <div class="side on"><div class="side-head">Stripe + bridge — recommended</div>
    <ul><li>~19 zł a month, flat.</li><li>Two weeks of work.</li></ul></div>
</div>
```

## .timeline

```html
<ol class="timeline">
  <li><span class="when">25 Jul 2026</span><b>Swarm manager stalls</b>
    <p>60 seconds was enough to reshuffle tasks and take prod down for 15 hours.</p></li>
  <li class="warn"><span class="when">26 Jul</span><b>Monitoring moved off the manager</b>
    <p>It had shared a failure domain with the thing it watched.</p></li>
</ol>
```

## .steps

Instructions, in order. `<b>` carries the action so the list scans.

```html
<ol class="steps">
  <li><b>Freeze the schema.</b> Nothing else lands until the migration is merged.</li>
  <li class="warn"><b>Back up first.</b> The migration drops a column with data in it.</li>
</ol>
```

## .flow

A chain too small to deserve an SVG.

```html
<div class="flow">
  <span>form</span><span class="arw">&rarr;</span>
  <span>queue</span><span class="arw">&rarr;</span>
  <span class="on">quote</span><span class="arw">&rarr;</span>
  <span class="warn">payment — not built</span>
</div>
```

## table

```html
<div class="tbl-wrap">
  <table>
    <thead><tr><th>Path</th><th>Files</th><th>What lives here</th><th>Never</th></tr></thead>
    <tbody>
      <tr><td class="path">apps/api</td><td class="num">286</td>
        <td class="what">Every write in the product.</td><td class="no">UI code.</td></tr>
    </tbody>
    <tfoot><tr><td>Total</td><td class="num">1 204</td><td></td><td></td></tr></tfoot>
  </table>
</div>
```

Cell classes: `.path` (mono, accent), `.num` (right, tabular; `.up` / `.down` for
signed change), `.what` (prose), `.no` (the warn-coloured exclusion).
Keep tables under ~12 rows. Longer than that wants `.chips` filtering.

## table.matrix

Many-to-many, one dot per cell. Nothing but dots in the body.

```html
<div class="tbl-wrap">
  <table class="matrix">
    <thead><tr><th class="rowhead">Workflow</th><th>auth</th><th>plans</th></tr></thead>
    <tbody><tr><th>submit-request</th><td class="full"></td><td class="off"></td></tr></tbody>
  </table>
</div>
<div class="key">
  <span><i class="on"></i>calls</span>
  <span><i class="hollow"></i>reads only</span>
  <span><i class="warn"></i>writes across a boundary</span>
</div>
```

Cell classes: `.full` `.part` `.both` `.risk` `.off`. A `.matrix` always ships a
`.key`.

## .ledger

```html
<div class="ledger">
  <div class="row"><div class="who">service-offering</div>
    <div class="what"><div class="tags"><span class="tag">catalogs</span>
      <span class="tag warn">catalog_media — shared</span></div>
      <div class="fine">The only table two modules write.</div></div></div>
</div>
```

## .tree

Monospace hierarchy with a note and a count per row. Draw the connectors with
literal `├──` and `└──` inside `.p`.

```html
<div class="tree">
  <div class="row head"><span>path</span><span>what it is</span><span>files</span></div>
  <div class="row"><span class="p">├── apps/</span><span class="n">every deployable</span>
    <span class="ct">412</span></div>
  <div class="row warn"><span class="p">│   └── legacy/</span><span class="n">frozen, do not extend</span>
    <span class="ct">37</span></div>
  <div class="row flat"><span class="p">└── dist/</span><span class="n">build output</span>
    <span class="ct none">&mdash;</span></div>
</div>
```

## .quote

Verbatim evidence. Attribute it or delete it.

```html
<blockquote class="quote">
  <p>Every module writes down what it refuses to do.</p>
  <cite>docs/architecture/boundaries.md, line 14</cite>
</blockquote>
```

## .callout / .note / .aside

`.callout` (warn) is the thing that bites. `.note` (accent) is the load-bearing
insight. `.aside` (grey) is context that would clutter the prose. At most one per
section, and never a callout that merely repeats the paragraph above it.

```html
<div class="callout">
  <div class="h">What breaks if you skip this</div>
  <p>The migration drops <span class="c">quotes.token</span>. Any deploy still
  reading it 500s on every quote page.</p>
</div>
```

## .codeblock

```html
<div class="codeblock">
  <div class="cb-head">apps/api/src/app.ts</div>
  <pre><code>const app = build({ logger: true });</code></pre>
</div>
```

Escape `<` as `&lt;` inside `<code>`. Keep it under ~15 lines; a code dump is not
a visual.

---

# Interactive blocks

Interactivity earns its place when the reader has a **choice to make**: which
variant, which subset, which step. Motion for its own sake is noise. If the page
has no `data-` block, ship no `<script>`.

## Tabs — same shape, different variant

```html
<div class="tabs" data-tabs>
  <div class="tabstrip" role="tablist">
    <button data-tab="now" class="on" aria-selected="true">Today</button>
    <button data-tab="after" aria-selected="false">After the change</button>
  </div>
  <div data-panel="now">…any blocks…</div>
  <div data-panel="after" hidden>…any blocks…</div>
</div>
```

## Filter chips — narrow a long list

```html
<div class="chips" data-filter="#grid">
  <button data-tag="*" class="on">All</button>
  <button data-tag="risk">Risk</button>
  <button data-tag="cost">Cost</button>
</div>
<p><span data-filter-count>12</span> shown</p>
<div class="cards" id="grid">
  <article class="card" data-tags="risk cost">…</article>
</div>
```

## Stepper — one screen at a time

```html
<div class="stepper" data-stepper>
  <div data-step><figure>…</figure></div>
  <div data-step hidden><figure>…</figure></div>
  <div class="stepnav">
    <button data-prev>Back</button><span data-pos></span><button data-next>Next</button>
  </div>
</div>
```

## Disclosure — the detail most readers skip

```html
<details class="disclose">
  <summary>Every row, if you want it</summary>
  <div class="body">…</div>
</details>
```
