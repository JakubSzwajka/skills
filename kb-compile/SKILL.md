---
name: kb-compile
description: Process material from ~/knowledge/inbox, extract durable concepts, create knowledge nodes, optionally write extraction reports, and archive the processed source into ~/knowledge/sources. Use when Kuba asks to parse inbox material, process a course/article/repo dump, or extract knowledge from newly dropped source files.
---

# KB Compile

Use this skill when Kuba drops material into `~/knowledge/inbox/`
and wants Lucy to turn it into durable knowledge.

## Simple model

- `inbox/` = unprocessed material
- `sources/` = raw originals and archived processed source material
- `knowledge/` = durable distilled nodes
- `explorations/` = optional reports

If something is still in `inbox/`, treat it as not processed yet.

## Workflow

1. Inspect the target path in `~/knowledge/inbox/`.
2. Classify the material: course, article, paper, repo notes,
   transcript bundle, mixed folder.
3. **Pre-scan: build a coverage checklist.** Enumerate every processing
   unit (lesson, chapter, section, article) before reading any content.
   Write this checklist into the extraction report scaffold immediately.
4. Read the source material and extract candidate concepts.
   **Every processing unit must be read** — do not skip units or batch
   them by scanning titles alone.
5. Use parallel extraction with subagents when the material has many
   lessons/files.
6. Consolidate duplicate candidates.
7. Search existing knowledge before creating anything.
8. Create only durable, reusable nodes in `~/knowledge/knowledge/`.
8. Immediately after each `knowledge_create` call, patch the newly
   created file frontmatter with an `edit` call to insert
   `created: YYYY-MM-DD` after `tags:` and before the closing `---`.
9. Never backfill `created:` into pre-existing nodes; only patch nodes
   created during the current run.
10. After node creation, run a cross-reference patching pass against
    existing nodes.
11. Run knowledge lint after patching.
12. Write an extraction report under
    `~/knowledge/explorations/reports/`. **This is mandatory, not
    optional.** The report must include the full coverage checklist
    with every processing unit resolved (see Coverage Checklist below).
13. Archive the processed source into `~/knowledge/sources/`.
14. Run the final repository commit after nodes are created,
    cross-references are patched, and lint passes:

    ```sh
    cd ~/knowledge
    git add .
    cat > /tmp/kb-compile-commit-msg <<'EOF'
    kb-compile: <source description>

    Created: ...
    Patched: ...
    Archived: ...
    EOF
    git commit -F /tmp/kb-compile-commit-msg
    ```

15. Tell Kuba what happened.

## Cross-reference patching

After creating new nodes, patch existing nodes so the graph stays
connected through prose links instead of isolated node creation.

For each newly created node:

- use `knowledge_search` with the new node name and key terms to find
  semantically related existing nodes
- use `knowledge_search` on the new node description
  text
- run a secondary grep pass on key terms across
  `~/knowledge/knowledge/*.md`
- prefer candidates that share `topic/*` tags with the new node unless
  the connection is very strong
- read the top 5-8 candidate nodes before deciding on patches
- if an existing node discusses the new concept without linking to it,
  add `[[new-node]]` in natural prose
- patch when the concept is named without a link, when a `Connects to`
  or similar line clearly wants the link, or when the new node extends,
  refines, or contradicts an existing claim
- do not add `Related`, `See also`, or dump sections just to force
  backlinks
- do not patch if the connection is only thematic, if it would require
  rewriting a paragraph, or if the existing node already links to
  overlapping coverage
- patch at most 5 existing nodes per new node
- if more than 5 good patch candidates exist, patch the best 5 and list
  the extras for human review
- report every patch made

The goal is selective semantic integration, not mass backlink stuffing.

## Course guidance

For courses:

- raw PDFs and original assets live in
  `~/knowledge/sources/courses_raw/`
- inbox may contain the text mirror Lucy should process
- after processing, archive the text material into
  `~/knowledge/sources/courses/`
- do not create lesson-per-node sludge
- prefer course hub nodes plus durable concept nodes
- keep precise `Source Trail` references

## Coverage checklist

Every extraction run must maintain a coverage checklist. Build it during
the pre-scan step and resolve it during extraction.

Each processing unit gets one of these dispositions:

- **Extracted** → list the node(s) created or updated
- **Merged** → concept was already covered by an existing node (name it)
- **Skipped** → no durable concepts found (state the reason briefly)

The checklist goes into the extraction report. Any unit left unresolved
at the end of the run is a **gap** — flag it prominently.

Example:

```
| Unit   | Disposition | Detail |
|--------|-------------|--------|
| M02L01 | Extracted   | brownfield-ai-advantage, macrokernel-sdk-architecture |
| M02L02 | Extracted   | macrokernel-sdk-architecture (same node, L01+L02) |
| M02L07 | Skipped     | Practical walkthrough, reinforces L01-L06, no new concepts |
```

## Course index update rule

When processing a course module, update the course index file in
`~/knowledge/sources/courses/<course>/index.md` with lesson summaries
for the processed module. An index that only covers earlier modules is
incomplete and makes future audits impossible.

## Non-negotiable rules

- Do not turn every lesson, README, or transcript into a node.
- Do not create knowledge nodes without checking existing nodes first.
- `knowledge_create` does not accept a `created` parameter; add
  `created: YYYY-MM-DD` only via an immediate post-creation `edit` on
  files created in the current run.
- Do not backfill `created:` into existing nodes from earlier runs.
- Prefer one strong concept node over many weak source-shaped nodes.
- Keep source material separate from knowledge nodes.
- If confidence is low, leave a candidate in a report instead of forcing a node.
- New node creation is not finished until the cross-reference patching
  pass and lint pass are complete.

## Deliverables

A successful run should leave behind some combination of:

- archived source material in `~/knowledge/sources/...`
- durable nodes in `~/knowledge/knowledge/...`
- patched existing nodes where semantic cross-references were added
- an optional report in `~/knowledge/explorations/reports/...`
- a concise summary of what was created, patched, skipped, and archived
