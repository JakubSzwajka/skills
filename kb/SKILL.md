---
name: kb
description: Search, explore, and create knowledge nodes in the Obsidian-backed knowledge graph at ~/knowledge/knowledge/. Use when you need to recall concepts, find related nodes, check graph health, or create new durable knowledge. Activate proactively when a conversation touches domain concepts that likely have knowledge nodes.
user-invocable: true
argument-hint: <command> [args...]
---

# KB — Knowledge Graph Skill

**Hard rule:** This skill is the ONLY interface to the knowledge graph. Never use Grep, Glob, or Bash to search `~/knowledge/knowledge/` directly. When a conversation touches domain concepts, course material, DDD patterns, or Kuba asks "what do we know about X" / "based on our knowledge" — use this skill first, not raw file tools.

Query and manage the knowledge graph stored in `~/knowledge/knowledge/`. Wraps the Obsidian CLI.

## CLI

```bash
python3 ~/.claude/skills/kb/kb.py <command> [args...]
```

## Commands

### Read & explore

```bash
# Search nodes by text
kb search "value object"
kb search "aggregate" --context           # show matching lines
kb search "event" --tag topic/ddd --limit 5

# Read a node by wikilink name
kb get tactical-ddd-value-objects

# Outgoing links from a node
kb links tactical-ddd-value-objects

# Incoming links to a node
kb backlinks tactical-ddd-value-objects

# Local graph neighborhood (links + backlinks, recursive)
kb graph tactical-ddd-value-objects
kb graph tactical-ddd-value-objects --depth 2

# File metadata
kb info tactical-ddd-value-objects
```

### Browse

```bash
# List all nodes (with descriptions)
kb list
kb list --tag topic/domain-driven-design
kb list --sort modified

# List tags
kb tags
kb tags --prefix topic/
kb tags --sort name
```

### Create

```bash
kb create my-node-name \
  --description "One-line description" \
  --tags "type/concept,topic/domain-driven-design" \
  --content "Body text with [[wikilinks]]..."
```

### Graph health

```bash
kb orphans      # nodes with zero inbound links
kb deadends     # nodes with zero outbound links
kb unresolved   # broken wikilinks
kb lint         # full quality check (frontmatter, tags, size, links)
```

## How to handle /kb

If `$ARGUMENTS` is empty, run `kb list --sort modified` to show recent nodes.

Otherwise, pass arguments directly:
```bash
python3 ~/.claude/skills/kb/kb.py $ARGUMENTS
```

## When to use proactively

Use this skill **before answering domain questions** when:
- The conversation mentions a concept that likely has a knowledge node (DDD patterns, architecture, course material)
- You need to ground your answer in Kuba's specific framing rather than generic training data
- You want to follow wikilinks to build a connected answer

Typical flow:
1. `kb search "<concept>"` to find relevant nodes
2. `kb get <node-name>` to read the full node
3. `kb graph <node-name>` to see the neighborhood
4. Answer using the node content + linked context

## Node conventions

- Names are kebab-case: `tactical-ddd-value-objects`
- Every node needs `type/*` and `topic/*` tags
- Frontmatter: `name`, `description`, `tags`, `created`
- Body uses `[[wikilinks]]` for cross-references
- Max 100 lines per node (enforced by lint)
- Prefer concept nodes over source-shaped summaries
