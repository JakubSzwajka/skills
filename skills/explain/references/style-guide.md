# HTML Style Guide for _explain

## Writing Voice

The explanation should read like Kuba's blog — a practitioner sharing what he actually built and learned, not a textbook. Match these patterns:

### Tone
- **Conversational and direct.** Write like you're explaining to a colleague at a whiteboard, not presenting at a conference. Use contractions, casual asides, rhetorical questions.
- **Honest about gaps.** If something is uncertain, say so plainly: "I'm not 100% sure why this works this way" or "Pretty sure there are more edge cases here." Never fake authority.
- **Self-aware, not self-deprecating.** Light humor about past mistakes or complexity is fine ("Yeah, that's exactly what happened"), but don't overdo it.

### Sentence rhythm
- **Short punchy sentences for emphasis.** "That's composition in action." "Done." "And this is the thing."
- **Longer sentences for explanation**, then immediately ground them with a concrete example or code.
- **Fragments are fine** when they serve emphasis: "Easier to test, easier to compose, more predictable…"
- **Vary paragraph length.** Single-sentence paragraphs for impact. 3-5 sentence paragraphs for exposition. Never wall-of-text.

### How to explain
- **Lead with the concrete problem or scenario**, not the abstract definition. "So we needed to verify users before allowing them on the platform" before "The verification pattern is…"
- **Show before/after.** When explaining a pattern or fix, show what was broken first, then the solution. Make the improvement tangible.
- **Use "That means" as a connector** to spell out implications: "We store events in the outbox. That means if Stripe fails, the event was never committed."
- **Use "Look here" or "Come here, I'll show you"** style direct address to walk through code.
- **Use arrow notation (→)** for progression and transformation: "electron app → server logic → web app"

### What to avoid
- Academic or textbook tone ("In this section, we will explore…")
- Overly formal transitions ("Furthermore," "Moreover," "It is worth noting that")
- Explaining things the reader already knows — get to the interesting part
- Empty filler ("As we can see," "It goes without saying")
- Pretending things are simple when they're not — if it's hard, say it's hard: "Modularisation is hard. Like really hard."

### Callout voice
Callouts should match the conversational voice too. Instead of "Note: This requires configuration", prefer "Worth knowing — this needs config tweaking before it'll work."

## Callout Types

Use these div patterns for special content blocks:

### Uncertainty — something the agent isn't sure about
```html
<div class="callout callout-uncertainty">
  <span class="label">Needs further investigation</span>
  Description of what's uncertain and why.
</div>
```

### Dependency — answer depends on external context
```html
<div class="callout callout-depends">
  <span class="label">Depends on</span>
  What this depends on and how it affects the explanation.
</div>
```

### Key insight — important takeaway
```html
<div class="callout callout-key">
  <span class="label">Key insight</span>
  The critical thing to understand.
</div>
```

### Info — supplementary context
```html
<div class="callout callout-info">
  <span class="label">Note</span>
  Additional context that helps understanding.
</div>
```

### Warning — gotcha or common mistake
```html
<div class="callout callout-warning">
  <span class="label">Warning</span>
  Common pitfall or important caveat.
</div>
```

## File References

Use `<span class="file-ref">path/to/file.ts:42</span>` when referencing source files.

## Mermaid Diagrams

Wrap diagrams in `<div class="mermaid">` tags. Common diagram types:

- **flowchart TD** — data flow, request lifecycle
- **sequenceDiagram** — interaction between components
- **classDiagram** — type relationships
- **graph LR** — dependency graphs

Keep diagrams focused: 5-10 nodes max. Split into multiple diagrams if complex.

## Content Structure

Standard page layout:
```html
<div class="header">
  <h1>Title</h1>
  <p class="context">Brief context line — what this explains and why</p>
</div>

<div class="toc">
  <h3>Contents</h3>
  <ul>
    <li><a href="#section-id">Section Name</a></li>
  </ul>
</div>

<div class="section" id="section-id">
  <h2>Section Name</h2>
  <!-- content -->
</div>
```

## Code Blocks

Use `<pre><code>` for multi-line code. Add `class="language-X"` for context but syntax highlighting is not included (keeps the page lightweight).

## Tables

Use standard HTML `<table>` for comparisons, mappings, or structured data. Good for:
- Config option explanations
- Before/after comparisons
- Parameter descriptions
