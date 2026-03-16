# HTML Style Guide for jsz-explain

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
