---
name: skill-improve
description: Reflect on the current conversation to identify how existing Claude Code skills should be improved, clarified, or extended. Use when the user says things like `/skill-improve`, asks what skills should change based on the session, or wants to turn repeated friction into small updates to existing skills before inventing new ones.
---

# Skill Improve

## Overview

Analyze the current conversation for repeated friction, missing guidance, awkward outputs, unclear boundaries, and moments where an existing skill should have done better.

Prefer improving an existing skill over proposing a new one. Produce a short recommendation list, not a wall of text. Do not edit any skill unless the user approves.

## Workflow

1. Review the current conversation, especially:
   - user corrections
   - repeated clarifications
   - places where the output shape was wrong
   - moments where a skill should have triggered earlier
   - spots where a skill existed but lacked a key line or rule
2. Read [references/api_reference.md](references/api_reference.md) before drafting recommendations.
3. Group findings by likely target:
   - existing skill needs a small improvement
   - existing skill needs a stronger trigger or boundary
   - no existing skill fits, so a new skill may be warranted
4. Prefer the smallest useful change. If one sentence in an existing skill would solve it, recommend that instead of proposing a new system.
5. Return a concise list only. Keep the final answer tight and actionable.

## Recommendation Rules

For each recommendation:
- Name the existing skill when possible.
- State the change in one line using `skill → change`.
- Mention a new skill only when the gap clearly does not fit an existing one.
- Base every suggestion on evidence from the conversation, not generic “could be better” fluff.
- Favor changes like:
  - add a missing question
  - add a stronger trigger phrase
  - add a stop boundary
  - add a required output format reminder
  - add a rule for a repeated failure mode

## Output Format

Use this exact shape unless the user asks for something else:

```md
Skill improvement ideas

- `skill-name` → specific small change.
- `skill-name` → specific small change.
- New skill opportunity → specific gap that existing skills do not cover.
```

Keep it short:
- usually 3-5 bullets
- one line per bullet
- no long explanations unless the user asks

## Approval Boundary

This skill stops at recommendations.

If the user approves a recommendation, then update the relevant skill files in a separate step. Until then, do not edit or package anything automatically.
