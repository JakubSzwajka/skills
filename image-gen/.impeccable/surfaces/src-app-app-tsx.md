---
version: 1
slug: "src-app-app-tsx"
primary_target: "src/app/App.tsx"
related_targets: []
---

## Scope and mode

Whole-window Image Gen interface prototype. Operate mode.

## Audience and task

One person generates images and browses or reuses past work. Generation and the library have equal weight. Every generation control stays visible before submission.

## Direction contract

THESIS: A photographer's contact sheet with generation always at hand. It refuses the detached prompt modal and sidebar-first utility shell.

OWN-WORLD: Cool proof-paper ground, near-black ink, registration blue, square image fields, hairline dividers, compact workhorse type, and almost no containers.

STORY: See the library, set references and providers, state the prompt, understand quota, then watch results join the same sheet.

FIRST VIEWPORT: Three variants change where the full generation setup lives: right rail, top bench, or inline row. A broad chronological image field stays visible in each. The primary Generate action sits at the end of the setup.

FORM: Contact Sheet, first on the grounded list, seed b71650ff. Signature interaction: submission turns the setup into an in-place developing strip before results settle into the sheet.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Constraints

Static throwaway HTML. Real mutations are stubbed. Keep generation history conventional. Desktop-first macOS utility, but layouts must remain usable at a narrow browser width.
