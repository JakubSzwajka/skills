# Skill Improvement Heuristics

Use this file to decide whether the conversation points to a real skill improvement or just normal back-and-forth.

## What to Look For

Treat these as strong signals:
- The user had to restate the desired output shape.
- The user had to narrow scope that a skill should have asked about.
- The same correction happened more than once.
- A skill should have triggered, but did not.
- A triggered skill produced the wrong level of detail.
- The assistant proposed a new skill when a small improvement to an existing one would have been enough.
- A skill lacked an explicit approval boundary, handoff step, or stopping rule.

## Prefer Existing Skills First

Before suggesting a new skill, ask:
1. Is there already a skill with roughly the right job?
2. Would one or two lines fix the failure?
3. Was the issue really trigger wording, scope, output format, or workflow order?

If yes, recommend updating the existing skill.

## Good Recommendation Shapes

Strong recommendations are:
- specific
- small
- tied to what happened
- easy to implement

Examples:
- `create-skill` → require confirming the desired output format before scaffolding.
- `review` → explicitly separate correctness issues from style nits in the final report.
- `test` → remind to answer the user's concrete question, not dump raw test noise.

## When a New Skill Is Actually Worth It

Suggest a new skill only if all are true:
- the job recurs
- it has a recognizable trigger
- it does not fit cleanly inside an existing skill
- the benefit is larger than the maintenance cost

## What Not to Recommend

Avoid suggestions that are:
- too vague to implement
- just a one-off preference from this session
- actually a model limitation rather than a skill gap
- broad workflow philosophy instead of an actionable skill change

## Output Discipline

The analysis can be deep, but the response should be brief.

Default to 3-5 bullets. Each bullet should stand on its own without extra explanation.
