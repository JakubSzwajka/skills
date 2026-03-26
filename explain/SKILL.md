---
name: explain
description: Visual concept explainer that researches code and generates a styled HTML page. Use when the user says "_explain", "explain this", "break this down visually", or asks for a visual explanation of a codebase concept, architecture pattern, or technical question. Generates an HTML file in /tmp and returns the file link.
---

# Visual Concept Explainer

Generate a self-contained HTML explanation page for a code concept, architecture pattern, or codebase question. The page renders mermaid diagrams, styled callouts, and structured prose for easy visual digestion.

## Arguments

`$ARGUMENTS` — the concept or question to explain. May reference specific files, modules, patterns, or abstract concepts.

## Workflow

### 1. Research

Spawn a research subagent to gather context:

```
agent: Research the following to prepare an explanation: $ARGUMENTS

Read relevant source files, trace data flow and dependencies, identify key abstractions and relationships. Note anything uncertain or context-dependent.
```

Collect findings before generating HTML.

### 2. Structure

Organize the explanation into sections. Typical structure:

1. **Overview** — one-paragraph summary, what this is and why it matters
2. **How it works** — the core mechanism, with a mermaid diagram
3. **Key components** — the pieces involved, their roles and relationships
4. **Data flow** — how data moves through the system (if applicable)
5. **Gotchas & edge cases** — things that are easy to get wrong

Adapt sections to what makes sense for the topic. Not every explanation needs all sections.

### 3. Generate HTML

Read the HTML template at [assets/template.html](assets/template.html). The template is lightweight — styling and scripts are loaded from external files automatically. Do NOT inline any CSS or JS.

Replace the placeholders:
- `{{TITLE}}` — short descriptive title
- `{{CONTENT}}` — the full HTML body content
- `{{DATE}}` — current date

For callout syntax, visual patterns, and **writing voice**, read [references/style-guide.md](references/style-guide.md). The voice section is critical — explanations must match the conversational, practitioner tone described there.

**Diagram guidelines:**
- Use mermaid flowcharts for data flow and architecture
- Use sequence diagrams for request/response lifecycles
- Keep diagrams focused: 5-10 nodes max, split if needed
- Wrap in `<div class="mermaid">` tags

**Uncertainty markers — ALWAYS use these when appropriate:**
- `callout-uncertainty` with label "Needs further investigation" — when you couldn't fully verify something from the code
- `callout-depends` with label "Depends on" — when the answer varies based on config, environment, or runtime state

**File references:**
- Use `<span class="file-ref">path/to/file.ts:42</span>` when citing source locations

### 4. Write and return

Write the complete HTML file to: `/tmp/_explain-<slug>.html`

Where `<slug>` is a kebab-case short name derived from the topic (e.g., `auth-middleware`, `data-pipeline`).

Return ONLY the link to the user:
```
file:///tmp/_explain-<slug>.html
```

Do NOT summarize the page content in conversation. The HTML page IS the output. Just provide the link.
