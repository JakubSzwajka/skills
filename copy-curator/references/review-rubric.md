# Copy Review Rubric

Use this rubric when reviewing AI-generated product copy in i18n files.

## Priorities

1. Preserve intent
2. Make the text sound native in its target language
3. Keep tone consistent across the same page or feature
4. Reduce fluff, vagueness, and generic AI phrasing
5. Do not change product terminology unless the user approves it
6. Do not rename keys

## What to flag

### English

Flag English strings that are:
- padded, generic, or obviously AI-written
- too long for UI surfaces
- vague about the user action or outcome
- inconsistent with nearby strings on the same page
- mechanically mirrored across keys where variation would help

Prefer English that is:
- direct
- concrete
- short enough for UI
- aligned with the feature context

### Polish

Flag Polish strings that are:
- literal translations from English
- syntactically correct but unnatural in product/UI language
- too formal, stiff, or bureaucratic
- phrased in a way a native speaker would not choose first
- inconsistent in register, person, or terminology
- use `AI` as the grammatical subject of an active verb (reads as buzzword marketing — propose a "we"-subject rewrite by default)
- use words from the **stale-vocabulary watchlist** below

Prefer Polish that is:
- idiomatic
- concise
- clear on the first read
- adapted to the UI context rather than translated word-for-word

#### PL stale-vocabulary watchlist

These words are what a dictionary translator reaches for but a native reader rarely says in a product context. If a proposal contains any of them, try one more variant without:

- `ujęcie` (as "angle/take") — usually `kąt` or a full rewrite
- `rytm` (as "your schedule") — often better: explicit schedule reference or drop entirely
- `typ firm` / `typ źródeł` — B2B hangover; rewrite around concrete interests
- `formuła` (as "shape/format") — usually drop
- `zasób` (generic "resource") — usually drop
- `briefing` as a verb — stay a noun

#### PL caveat

Copy proposals come from a non-native model. Treat them as draft material. Scan your own proposals for grammar before presenting — commas, case endings, gendered agreement, article-style drift. **State this caveat in every PL review output** so the user knows to proofread, not trust.

#### Structural divergence rule

For hero, tagline, landing, and marketing strings, PL proposals MUST include at least one variant that does NOT mirror EN sentence structure. Literal parallelism is the dominant failure mode. Offer the user 2–3 options and let them pick.

## Common AI-copy smells

Watch for:
- filler like "seamless", "effortlessly", "easily manage", "unlock"
- over-explaining obvious actions
- long headings and CTA labels
- repetitive sentence structure across many keys
- abstract nouns where a verb would be clearer
- English sentence rhythm copied into Polish

## Terminology guardrails

Do not silently replace:
- product names
- feature names
- domain-specific nouns already used across the app
- legal or compliance wording that may be deliberate

If a term feels wrong, suggest it as a terminology note instead of changing it automatically.

## Terminology consistency scan

Before drafting suggestions, build a glossary of recurring product nouns across the locale files — things like `draft` / `szkic`, `edition` / `wydanie`, `brief`, `topic`, `research`, `preview`. For each one, list every key where a variant appears.

Flag drift explicitly in the review summary header, BEFORE line-by-line suggestions, so terminology alignment decisions happen up front. Example drift to catch: one key says `Ostatni szkic` while every other key in the same app uses `wydanie` — that's a bug, not a style call.

## Claim-scope grep

After fixing any factual claim — schedule ("every morning"), pricing, audience scope, access model — grep for that claim phrase across ALL locale files and flag every residual occurrence. If you just removed "every morning" from the hero, check SEO, meta tags, landing bullets, empty states, notification copy. Do not leave the same factual claim partially fixed.

## Wire-check before proposing

Before proposing rewrites for any non-obvious namespace, grep the source (not just the locale file) for references to the keys: `t('namespace.key')`, dynamic lookups, template interpolations. Unreferenced keys are DEAD — flag them for deletion in the review, do not propose copy rewrites for them.

This has bitten the skill before: writing elaborate rewrites for `newsletterEdit.topics.examples.*` when nothing in `src/` ever read those keys.

## Sequence review

Strings that belong to a numbered or ordered sequence — `steps.{1,2,3}`, onboarding flows, wizard stages, readiness checklists — must be reviewed as a unit, not individually. Check that:
- length/cadence matches across siblings (all one-word titles, or all short phrases, or all sentences — not mixed)
- voice is consistent (all imperative, or all descriptive — not mixed)
- they read as a rhythm when skimmed top-to-bottom

Individually-fine strings can still fail this check.

## Tightening vs explanation

Tightening (shorter) is the default bias of most copy review and is WRONG as often as it's right. Some strings need more explanation, not less — especially always-visible helpers and empty-state bodies where the user needs context to act.

For each page/feature bucket in the review, ask the user **once** whether they want tightening or explanation before drafting. Do not assume.

## Parity rules

EN and PL should match meaning, not syntax.

Accept asymmetry when it improves naturalness, brevity, or clarity. The Polish version does not need to mirror English structure. The English version also may need its own rewrite rather than serving as the source of truth.

## Severity labels

Use these tags where useful:
- `awkward` — reads unnaturally
- `literal translation` — too close to English source structure
- `too long` — too verbose for UI
- `unclear` — intent or outcome is fuzzy
- `tone mismatch` — inconsistent with surrounding UI
- `terminology risk` — likely touches approved product wording

## Decision rule

Suggest a rewrite only if it clearly improves at least one of:
- naturalness
- clarity
- brevity
- consistency

Do not churn strings that are already fine.