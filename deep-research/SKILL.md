---
name: deep-research
description: >
  Deep codebase exploration that produces structured research reports. Use when you need
  to understand unfamiliar modules, map cross-cutting concerns, find patterns, or answer
  architectural questions before planning implementation. Works with any language or stack.
  Triggers on: "research", "deep research", "explore the codebase", "how does X work",
  "map out the X system", "understand the X module".
context: fork
agent: Explore
---

# Deep Research

Explore the codebase to answer specific research questions and produce a structured report.

**READ-ONLY**: This skill must NEVER modify any files. Only use read-only tools (Glob, Grep, Read, WebFetch, WebSearch). Do not use Edit, Write, NotebookEdit, or Bash commands that write to disk.

## Input

`$ARGUMENTS` contains the research questions or exploration goals. Examples:
- "How does the notification system work? What are the entry points?"
- "Map all places that interact with Stripe"
- "What patterns does the bookings module use for validation?"

## Step 1: Parse Questions

Extract the specific questions from `$ARGUMENTS`. If the request is vague, break it into concrete sub-questions:
- What are the key files/modules involved?
- What patterns or conventions are used?
- What are the entry points and data flows?
- What gotchas or edge cases exist?

## Step 2: Explore

Use Glob to find relevant files, Grep to search for patterns, and Read to understand implementations. Work breadth-first:

1. **Find entry points**: Search for the main classes, functions, or routes related to the topic.
2. **Trace data flow**: Follow the call chain from entry point through layers.
3. **Identify patterns**: Note conventions, base classes, mixins, or shared utilities.
4. **Check for gotchas**: Look for error handling, edge cases, TODOs, and known issues.

For large explorations, investigate multiple angles in parallel using separate search queries.

## Step 3: Report

Produce a structured report:

```
## Research: <topic>

### Key Files
- `path/to/file.py` — role/purpose (one line each)

### Architecture / Data Flow
<Brief description of how the system works, with the call chain or data flow>

### Patterns & Conventions
- <Pattern 1>: description
- <Pattern 2>: description

### Gotchas & Edge Cases
- <Issue>: explanation

### Recommendations
- <Actionable recommendation for the caller>
```

Keep the report concise. Focus on insights the caller needs to make decisions, not exhaustive listings.
