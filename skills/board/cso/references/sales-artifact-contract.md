# Sales Artifact Contract

Each product repo should own its local sales truth under `docs/knowledge/sales/`.

## Expected Files

```txt
docs/knowledge/sales/
  positioning.md
  icp.md
  playbook.md
  pipeline.md
  launch-readiness.md
  objections.md
  proof-assets.md
```

## File Responsibilities

- `positioning.md` - category, primary sales frame, one-sentence offer, approved claims, claim boundaries.
- `icp.md` - primary ICP, secondary segments, disqualifiers, buyer/user split, fit questions.
- `playbook.md` - channel order, discovery flow, outreach rules, messages, founder-help boundaries.
- `pipeline.md` - funnel stages, activation definition, scorecard, source labels, weekly review questions.
- `launch-readiness.md` - proof gates, launch blockers, promotion sequence, do-not-launch rules.
- `objections.md` - categorized objections, frequency, evidence, response, owner, follow-up task.
- `proof-assets.md` - examples, demos, screenshots, specimen outputs, case notes, and missing proof.

## Bootstrap Minimum

When a repo has no sales docs, create the smallest useful version:

1. `positioning.md`
2. `icp.md`
3. `pipeline.md`
4. `launch-readiness.md`

Add `playbook.md`, `objections.md`, and `proof-assets.md` when there is outreach, user evidence, or launch work.

## Local Truth Rule

The global CSO may propose defaults, but project-local docs become truth only after user confirmation or evidence. Do not copy another project's ICP, offer, or sales claims into a new repo.

## Source Stack To Inspect

- `AGENTS.md`, `README.md`
- `docs/knowledge/product/vision.md`
- `docs/knowledge/product/users.md`
- `docs/knowledge/product/scope.md`
- `docs/knowledge/product/workflows.md`
- current landing/pricing/legal copy
- active task PRDs and logs
- actual user conversations, analytics, demos, replies, payments, support notes
