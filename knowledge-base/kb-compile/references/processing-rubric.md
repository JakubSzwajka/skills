# Processing Rubric

Use this rubric to decide where extracted material belongs.

## 1. Queue and source triage

Ask:
- Is this coming from `inbox/pending/`, `inbox/processing/`, or directly from a source path?
- What is this material?
- Is it already preserved in `sources/`?
- What is the smallest useful processing unit?
- Does it need normalization or only indexing?

If it comes from `inbox/pending/`, move it to `inbox/processing/` before deeper work and finish by moving it to `done/` or `rejected/`.

Preferred units:
- course -> lesson
- article bundle -> article
- repo docs -> file or subarea
- long transcript -> chunk or section

## 2. Candidate scoring

Score each extracted idea informally across five dimensions:

- **Durability** — likely still useful later?
- **Reusability** — applies outside this one source?
- **Specificity** — is it a real concept, not a vague theme?
- **Connectivity** — can it link naturally to existing nodes?
- **Distinctness** — is it meaningfully different from existing nodes?

Promote only when most answers are clearly yes.

## 3. Output destination rules

### `sources/`
Use when preserving originals or normalized mirrors.

### `explorations/`
Use when output is:
- session-shaped
- comparative
- speculative
- too broad or muddy for a node
- useful as a report but not durable enough as graph knowledge

### `knowledge/`
Use when output is:
- concept-shaped
- concise
- durable
- reusable
- naturally linkable

## 4. Duplicate handling

Before creating a node:
- search the graph
- compare definitions, not just names
- merge when the candidate is covered already
- update only if the source adds clearer wording, better relationships, or broader source support

## 5. Red flags

Do not promote when the candidate is mostly:
- a lesson summary
- a table-of-contents heading
- a motivational slogan
- a one-off question answer
- an operational README topic with no durable general insight

**Important exception:** Concrete architectural patterns with specific
mechanisms (decision frameworks, named strategies, implementation
patterns with clear trade-offs) are NOT lesson summaries, even when
they come from a single lesson. Score them on the rubric normally.
A pattern like "4 approaches to plugin data persistence" or "JSONB
metadata extensibility replacing EAV" is a durable reusable concept,
not a lesson recap.

## 6. Course extraction pattern

For courses, look for:
- recurring concepts across lessons
- explicit distinctions and tradeoffs
- patterns that generalize beyond the course
- stable framing nodes for the course itself

Avoid:
- one node per lesson
- one node per keyword list item
- copy-pasted transcript phrasing
