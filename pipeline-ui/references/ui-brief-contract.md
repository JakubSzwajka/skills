# UI Brief Contract

Use this when a UI task is vague, high-stakes, or likely to sprawl. Keep it compact; the goal is better decisions, not ceremony cosplay.

## Required fields

```md
Audience:
Primary action:
Product/business goal:
Device/context:
Existing route/component:
Design system constraints:
Copy/voice constraints:
Accessibility constraints:
States needed:
- default
- loading
- empty
- error
- success
Things to avoid:
Definition of good:
```

## Fast inference pattern

When the user has not provided enough detail but momentum matters, proceed with explicit assumptions:

```md
Working hypothesis:
- Audience: ...
- Primary action: ...
- Goal: ...
- Constraints: ...

I’ll build/review against this unless you correct me.
```

## Question budget

Ask only questions that change the design direction. Usually ask no more than three at once:

1. Who exactly is this for?
2. What is the one action this screen must drive?
3. What constraint would make a pretty solution wrong?

If answers can be inferred from code, routes, docs, analytics labels, copy, or existing UI, inspect those instead of asking.

## Design contract examples

### SaaS dashboard

```md
Audience: Ops lead at a small team
Primary action: Spot what needs attention and drill into the worst item
Goal: Reduce time-to-triage
Device/context: Desktop, daily morning check
Constraints: Must work without relying on color alone; use existing table/card components
Things to avoid: Decorative metrics, vague health labels, hidden filters
Definition of good: User can identify the top problem in under 10 seconds
```

### Landing page hero

```md
Audience: Technical founder evaluating an AI tool
Primary action: Start trial or view working demo
Goal: Establish credibility fast
Device/context: Desktop and mobile, cold traffic
Constraints: Concrete proof before abstract claims; no generic AI gradient slop
Things to avoid: “Transform your workflow” copy, fake dashboard imagery, weak CTA
Definition of good: User understands what it does, who it is for, and why to trust it in 5 seconds
```
