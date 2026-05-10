# Output Templates

## Extraction report template

```md
# <Source Name> — Extraction Report

## Scope
- Processed path: `...`
- Inbox transition: `pending/... -> processing/... -> done/...` (if applicable)
- Source type: course/article/repo/...
- Archived to: `...`

## Summary
Short synthesis of what the source covers.

## Candidate Knowledge Nodes
- `<candidate-name>` — why durable, likely relationships: [[...]], [[...]]
- ...

## Existing Nodes Reused or Updated
- `...`

## Skipped / Not Promoted
- `...` — why

## Follow-up
- next passes, missing lessons, open questions
```

## Knowledge node template

```md
## <Concept Name>

One-paragraph summary with at least one natural [[wikilink]].

### Core Idea
- ...

### When It Applies
- ...

### Tradeoffs / Failure Modes
- ...

### Relationships
- Related to [[...]]
- Contrasts with [[...]]

### Source Trail
- [[source-node]] — precise lesson/chapter/article
- Raw: `...`
- Text: `...`
```

## Short final response template

```md
Processed: `...`
Inbox: `pending/... -> done/...`
Archived: `...`
Report: `...`
Knowledge: created/updated `...`
Skipped: `...`
Next: `...`
```
