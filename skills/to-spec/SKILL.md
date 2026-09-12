---
name: to-spec
description: Turn the current conversation into a central spec without another interview. Invoking the skill authorizes creation under ~/.pi/specs/.
disable-model-invocation: true
---

# To spec

Synthesize the current conversation and codebase understanding into a central spec. Do not interview the user or ask them to confirm the testing seam. Invoking `/to-spec` is approval to create the spec files.

## Process

1. Explore the repository if needed. Use its domain glossary and respect ADRs in the area.
2. Choose the highest practical seam for behavioral tests. Prefer an existing seam. Record assumptions or unresolved limits in `Further notes` instead of opening another approval round.
3. Create `~/.pi/specs/<YYYY-MM-DD>_<feature-slug>/`, where the slug uses lowercase letters, numbers, and hyphens.
4. Write `spec.json` and `SPEC.md`. If the spec has user stories, write them to `USER_STORIES.md` rather than embedding them in `SPEC.md`.
5. Start the spec as pending. Do not create `tickets/`, `research/`, `prototypes/`, or `log/` until something will be written there.
6. Report the exact central folder. Do not create or update an issue tracker item.

`spec.json` must use this shape:

```json
{
  "schemaVersion": 1,
  "title": "<spec title>",
  "status": "pending"
}
```

`completedAt` must be absent while pending. `/spec:status done` adds it, and `/spec:status pending` removes it.

<spec-template>

# <Spec title>

## Problem statement

The problem from the user's point of view.

## Solution

The solution from the user's point of view.

## Implementation decisions

Record the agreed modules, interfaces, technical choices, schema changes, API contracts, and interactions. Do not include file paths or code snippets that will go stale.

A prototype snippet may be included when it captures a decision more clearly than prose, such as a state machine, reducer, schema, or type shape. Keep only the decision-rich part and name the prototype record it came from.

## Testing decisions

Describe external behavior to test, the modules covered, the chosen seam, and similar tests already in the codebase.

## Out of scope

State what this spec does not include.

## Further notes

Record assumptions, risks, and unresolved limits that affect the work.

</spec-template>

<user-stories-template>

# User stories

1. As a <actor>, I want <feature>, so that <benefit>.

Add enough numbered stories to cover the agreed behavior and important edge cases. Do not pad the list with duplicate wording.

</user-stories-template>
