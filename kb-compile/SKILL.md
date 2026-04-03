---
name: kb-compile
description: Process material from ~/knowledge/inbox, extract durable concepts, create knowledge nodes, optionally write extraction reports, and archive the processed source into ~/knowledge/sources. Use when Kuba asks to parse inbox material, process a course/article/repo dump, or extract knowledge from newly dropped source files.
---

# KB Compile

Use this skill when Kuba drops material into `~/knowledge/inbox/` and wants Lucy to turn it into durable knowledge.

## Simple model

- `inbox/` = unprocessed material
- `sources/` = raw originals and archived processed source material
- `knowledge/` = durable distilled nodes
- `explorations/` = optional reports

If something is still in `inbox/`, treat it as not processed yet.

## Workflow

1. Inspect the target path in `~/knowledge/inbox/`.
2. Classify the material: course, article, paper, repo notes, transcript bundle, mixed folder.
3. Read the source material and extract candidate concepts.
4. Use parallel extraction with `spawn` when the material has many lessons/files.
5. Consolidate duplicate candidates.
6. Search existing knowledge before creating anything.
7. Create only durable, reusable nodes in `~/knowledge/knowledge/`.
8. Optionally write an extraction report under `~/knowledge/explorations/reports/`.
9. Archive the processed source into `~/knowledge/sources/`.
10. Tell Kuba what happened.

## Course guidance

For courses:
- raw PDFs and original assets live in `~/knowledge/sources/courses_raw/`
- inbox may contain the text mirror Lucy should process
- after processing, archive the text material into `~/knowledge/sources/courses/`
- do not create lesson-per-node sludge
- prefer course hub nodes plus durable concept nodes
- keep precise `Source Trail` references

## Non-negotiable rules

- Do not turn every lesson, README, or transcript into a node.
- Do not create knowledge nodes without checking existing nodes first.
- Prefer one strong concept node over many weak source-shaped nodes.
- Keep source material separate from knowledge nodes.
- If confidence is low, leave a candidate in a report instead of forcing a node.

## Deliverables

A successful run should leave behind some combination of:
- archived source material in `~/knowledge/sources/...`
- durable nodes in `~/knowledge/knowledge/...`
- an optional report in `~/knowledge/explorations/reports/...`
- a concise summary of what was created, skipped, and archived
