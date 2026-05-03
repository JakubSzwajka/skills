---
name: pipeline-ui
description: "Run a UI/design shipping pipeline from brief or existing screen to implemented, reviewed, verified app UI. Use when the user asks to build, redesign, improve, ship, continue, or polish a page/component/flow; wants an AI-native UI workflow; says pipeline-ui, UI pipeline, design pipeline, ship this UI, build this screen, or turn this design/PRD into working UI."
---

# Pipeline UI

Run a design-specific shipping loop: orient, frame constraints, critique, implement, self-review, copy-check, verify, and hand off. Optimize for working UI in the repo, not static mockups or vibes in a trench coat.

## Core principle

Treat design as executable product work. Prefer a real route/component/prototype in the app over a detached mockup. Keep taste gates and engineering gates in the same loop.

## Default workflow

1. **Orient**
   - Run normal project orientation before edits: inspect git state, task artifacts, relevant routes/components, design docs, theme tokens, and existing UI patterns.
   - Read `CLAUDE.md`, `AGENTS.md`, `design.md`, `copy.md`, theme config, component docs, or local README files when present.
   - If the repo has active `docs/tasks/active/` work, align to it and update task state/logs when appropriate.

2. **Frame the UI contract**
   - Identify audience, primary action, business/product goal, device context, constraints, existing patterns, accessibility expectations, and definition of good.
   - If any of audience/action/goal is missing and blocks good decisions, ask 1-3 sharp questions.
   - If momentum matters more than precision, state an explicit working hypothesis and proceed.
   - Use [references/ui-brief-contract.md](references/ui-brief-contract.md) when the task is vague, high-stakes, or likely to sprawl.

3. **Challenge before building**
   - Apply `design-challenger` logic before implementation: hierarchy, CTA clarity, target-audience fit, trust, flow friction, density, mobile behavior, and generic-AI-slop risk.
   - For text-heavy/product-marketing UI, include copy critique before layout hardens.
   - Surface only high-leverage issues; do not bury the user in a design-school autopsy unless requested.

4. **Implement in the real app**
   - Build or edit the actual route/component using existing project patterns.
   - Reuse the design system before inventing new primitives.
   - Keep changes small, reversible, and scoped to the requested UI.
   - Do not edit production code if the user only asked for critique; produce a disposable `/tmp` HTML sketch instead when useful.

5. **Self-review the result**
   - Review the implemented UI against the UI contract and project design language.
   - Check: primary action, visual hierarchy, responsive behavior, accessibility basics, copy clarity, empty/loading/error states, and consistency with existing components.
   - If an issue is obvious and local, fix it immediately. If it is a product decision, ask or flag it.

6. **Copy and localization pass**
   - If user-visible strings or i18n files changed, use `copy-curator` behavior: inspect context, preserve key names, detect terminology drift, and wait for approval before broad copy rewrites.
   - Do not sneak copy strategy changes into implementation. Flag them separately when they affect positioning or claims.

7. **Verify**
   - Run the cheapest relevant checks: typecheck, lint, unit tests, route build, storybook, or Playwright/screenshot tests if available.
   - If the app supports local preview, provide the route or command.
   - If checks fail outside the touched scope, distinguish existing noise from new breakage.

8. **Hand off**
   - Summarize files changed, route/component touched, verification run, design tradeoffs, and remaining decisions.
   - If task artifacts exist, update `tasks.md`/`log.md` with meaningful progress.

## Modes

### Critique-only
Use when the user asks to review, tear apart, pressure-test, or challenge UI without implementation.

- Do not edit production files.
- Produce concise critique using design-challenger structure.
- Create a disposable `/tmp/*.html` review sketch only if visual explanation helps.

### Prototype mode
Use when the user wants direction but the app implementation target is unclear.

- Produce a self-contained `/tmp/*.html` artifact or repo-local prototype only after confirming this is not production UI.
- Keep it disposable and directional.
- Use it to clarify structure, hierarchy, and interaction, not pixel-perfect specs.

### Implementation mode
Use when the user asks to build, redesign, ship, implement, polish, or continue UI work.

- Work in the real app.
- Follow existing component/style patterns.
- Run checks.
- Return a shippable handoff.

### Design-system seeding mode
Use when the repo lacks agent-readable design guidance and the task would benefit from it.

- Draft a concise `design.md` or update existing design guidance only with user approval if adding a new tracked file.
- Capture reusable taste decisions: visual principles, components, typography/color rules, copy tone, anti-patterns.
- Keep it practical enough for agents to follow.

## Taste gates

Before calling UI done, answer these privately and surface failures:

- Is the primary action obvious in three seconds?
- Is the screen designed for the actual audience, not the team’s taste?
- Does the layout guide decisions, or just decorate content?
- Does the copy reduce doubt, or just describe features?
- Does it obey the existing design language?
- Does it work on the likely device sizes?
- Are loading, empty, and error states acceptable?
- Does it avoid generic Tailwind/SaaS/AI slop?

## Delegation map

Use existing skills instead of duplicating them:

- `dont-start-blind` for repo/task/code orientation.
- `grill-me` when product/design decisions are unresolved and need one-question-at-a-time interrogation.
- `design-challenger` for harsh UX/UI critique.
- `copy-curator` for i18n/product copy review and approved edits.
- `test` for focused verification.
- `review` for pre-push code review when requested.

## Output shape

Default final response:

```md
Done.

Changed:
- `path/to/file`: what changed
- `path/to/file`: what changed

Verified:
- `command` ✅ / failed because ...

Design notes:
- Key tradeoff or remaining decision
- Preview route/URL if available
```

For critique-only:

```md
### Brutal verdict
- 2-3 blunt bullets.

### Top problems
1. ...
2. ...
3. ...

### What to change first
1. ...
2. ...
3. ...
```

## Boundaries

Do not:
- treat mockups as the final artifact when implementation is requested
- invent a new design system when one exists
- generate broad copy rewrites without approval
- make unrelated refactors while touching UI
- commit without explicit approval
- delete files without explicit approval
- pretend visual certainty without seeing the actual UI or enough surrounding code
