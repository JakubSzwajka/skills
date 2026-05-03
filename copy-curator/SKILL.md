---
name: copy-curator
description: Review and improve AI-generated product copy in local i18n JSON files when the user asks to audit wording, make translations sound natural, review English and Polish copy, group suggestions by page, or apply approved copy edits. Use for localization QA, EN/PL tone cleanup, awkward translation review, and detecting hardcoded user-visible strings outside the i18n layer.
---

# Copy Curator

Review local i18n copy, propose higher-quality wording, wait for approval, then apply only approved changes. Prioritize natural product language over literal translation, especially for Polish.

## When to use this skill

Use this skill when the user wants to:
- review English and Polish i18n copy
- improve awkward, AI-sounding, or overly literal wording
- group copy feedback by page or feature
- approve suggestions before any file edits happen
- detect hardcoded user-visible strings that should live in i18n

## Inputs to inspect

Start with the relevant i18n JSON files. If the user does not specify files, locate the main English and Polish locale files and inspect nearby UI files to infer context.

For brand-guideline compliance audits, do not stop at locale files. Read the repo-local brand/copy guideline first when present, usually `docs/brand-copy-guidelines.md`, then search active product surfaces for stale or forbidden terms from that guide. Include SEO, structured data, legal/privacy/terms/contact copy, email templates/generated-edition chrome, README files, and docs that present current product positioning.

Read [references/review-rubric.md](references/review-rubric.md) before evaluating wording. Read [references/output-format.md](references/output-format.md) before presenting suggestions.

## Review workflow

1. Identify the locale files in scope.
2. Inspect related routes, pages, or components to understand where the strings appear.
3. Infer page or feature grouping from route files, feature folders, and key namespaces.
4. **Wire-check.** For any non-obvious namespace you plan to review, grep the source for key references. Flag unreferenced keys as DEAD — propose deletion, not rewrites.
5. **Terminology pass.** Build a glossary of recurring product nouns across the locale files. List every key where a variant appears. Flag drift in the review header BEFORE line-by-line suggestions, so terminology alignment happens up front.
6. **Ask the direction.** For each page/feature bucket, ask the user once whether they want tightening (shorter) or explanation (more context) before drafting. Do not default to tightening.
7. Review both English and Polish together.
8. **Sequence check.** For numbered/ordered string groups (`steps.{1,2,3}`, wizards, checklists), review the group as a unit for length/voice/cadence parity, not individually.
9. Detect hardcoded user-visible strings in source files and report them separately.
10. Present suggestions first. Do not edit files yet.
11. Wait for explicit approval.
12. **Claim-scope grep after apply.** After applying any factual-claim fix (schedule, pricing, audience, access model), grep all locales for the old claim phrasing. Flag residual occurrences as a follow-up before closing the task.
13. Apply only the approved suggestions.

## How to evaluate copy

Review strings as product copy, not as sentence translation exercises.

Use these rules:
- preserve meaning, but do not preserve wording mechanically
- feel free to reshape both EN and PL if the result is clearer or more natural
- prefer concise UI language over explanatory marketing filler, but do NOT default to tightening every string — see "Tightening vs explanation" in the rubric
- keep terminology stable unless the user explicitly approves a terminology change
- never rename i18n keys
- avoid churn on strings that are already good enough
- allow PL to diverge structurally from EN (sentence count, idioms, word order) — in fact, require structural divergence for hero/tagline strings, see rubric
- flag any PL string where `AI` is the grammatical subject of an active verb — propose a "we"-subject rewrite

## PL proposal caveat

PL proposals come from a non-native model. **State this caveat in every PL review output.** Treat proposals as draft material the user must proofread (commas, case endings, gendered agreement, idiom choice). Do not claim PL fluency the skill does not have. When offering PL rewrites for high-visibility strings (hero, landing, legal), offer 2–3 variants and let the user pick or mix.

## How to group findings

Group suggestions by page or feature, not only by file.

Use best-effort grouping in this order:
1. route/page context
2. feature or component area
3. i18n namespace or key prefix
4. `Shared/Common`

If grouping is uncertain, say how you inferred it.

## Required review output

Produce a review that includes:
- short summary of files reviewed and grouping logic
- suggestions grouped by page/feature
- for each changed key: current EN, proposed EN, current PL, proposed PL, and a short reason
- separate terminology notes if relevant
- separate hardcoded UI strings section
- a clear approval prompt

Follow the exact structure in [references/output-format.md](references/output-format.md), unless the user asks for a different audit format.

## Brand-guideline compliance audits

When the user asks to review copy against brand/copy guidelines, run this as a compliance audit rather than only a wording-quality pass.

Workflow additions:
1. Read the repo-local brand/copy guideline file first, usually `docs/brand-copy-guidelines.md`.
2. Audit active product surfaces, including:
   - i18n locale files
   - route/component copy
   - SEO and structured-data copy
   - legal/privacy/terms/contact copy
   - email templates and generated-edition chrome
   - README/docs that present current product positioning
3. Separate active user-facing/product guidance from historical archives, research notes, deprecated task docs, fixtures, tests, technical route names, CSS classes, and internal enum names.
4. Search for the guideline's forbidden or stale terms across the active source/docs scope. Treat remaining matches as findings only when they are active user-facing copy or current product guidance.
5. Use the severity definitions requested by the user. If the user does not provide severities, default to:
   - P0: stale access model, trial/billing factual errors, overclaims, AI-first hero/positioning
   - P1: terminology drift, unclear billing, generic AI-newsletter positioning
   - P2: missing trust cues, weak onboarding examples, daily-by-default drift, generic filler copy
6. For each finding include:
   - file path
   - exact string/component/key
   - problem
   - severity
   - recommended replacement/action
   - whether it is safe to change immediately
7. Do not apply edits unless explicitly approved.

For brand audits, the requested compliance-audit table can replace the normal EN/PL proposal format. Still include the PL proposal caveat whenever you propose Polish wording.

## Approval rules

Do not apply edits until the user explicitly approves them.

Accepted approval patterns include:
- `apply all`
- `apply only <page names or key list>`
- `apply all except <page names or key list>` (list skipped items explicitly in the apply summary)
- `regenerate <page/key> with more direct/friendly/shorter/longer tone`
- `tighten <bucket>` / `expand <bucket>` — redirect the default direction for a specific page
- `skip terminology-related suggestions`

If approval is partial, apply only the approved subset and leave the rest unchanged.

## Apply workflow

When approved:
1. Edit only the approved keys in the locale files.
2. Preserve JSON structure, formatting style, and key names.
3. Keep EN/PL aligned in meaning, not necessarily in wording.
4. Summarize changes by file.
5. Do not fix hardcoded UI strings unless the user explicitly asks for that second step.

## Scope boundaries

This skill should:
- review existing localized copy
- suggest better English and Polish wording
- detect hardcoded user-visible strings
- apply approved locale-file edits

This skill should not:
- rename keys
- silently change product terminology
- rewrite code architecture around localization unless explicitly asked
- claim linguistic certainty without checking surrounding UI context

## Example user requests

Examples that should trigger this skill:
- `review the polish copy in these locale files`
- `audit AI-generated i18n wording and suggest better EN/PL copy`
- `group copy fixes by page and wait for approval before editing`
- `find awkward translations and hardcoded UI strings`
- `apply the approved copy suggestions from the review`