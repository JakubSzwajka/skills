---
name: code-review
description: Review changes since a fixed point along two axes: repository standards and the explicit central spec or requirements. Runs both reviews in parallel read-only lanes and reports them side by side.
---

Two-axis review of the diff between `HEAD` and a fixed point the user supplies:

- **Standards** — does the code conform to this repo's documented coding standards?
- **Spec** — does the code faithfully implement the supplied central spec or requirement brief?

Both axes run as parallel read-only reviewer lanes so they do not pollute each other's context. This skill aggregates their findings. It never edits, stages, commits, or changes spec or ticket status.

## Process

### 1. Pin the fixed point

Whatever the user said is the fixed point — a commit SHA, branch name, tag, `main`, `HEAD~5`, etc. If they didn't specify one, ask for it.

Capture the diff command once: `git diff <fixed-point>...HEAD` (three-dot, so the comparison is against the merge-base). Also note the list of commits via `git log <fixed-point>..HEAD --oneline`.

Before going further, confirm the fixed point resolves (`git rev-parse <fixed-point>`) and the diff is non-empty. A bad ref or empty diff should fail here, not inside two parallel reviewer lanes.

### 2. Identify the spec source

Use intent sources in this order:

1. The mounted central spec at `~/.pi/specs/<YYYY-MM-DD>_<feature-slug>/SPEC.md`, when the master session has one.
2. An exact central spec path or requirement brief supplied by the user.
3. A specific ticket under that spec's `tickets/`, when the change implements one slice.
4. An incoming GitHub or GitLab issue referenced by a commit, as supplemental request context only.
5. If none exists, ask the user for the requirements. If they confirm there is no spec, skip the Spec lane and report "no spec available".

Do not search `docs/`, repository `specs/`, or `.scratch/` for an inferred match. Existing `.scratch` records are legacy and are not active spec sources. Read the chosen material in the master session and extract the relevant intent and requirements. Ticket boxes and blockers may clarify scope, but they do not prove spec completion.

### 3. Identify the standards sources

Anything in the repo that documents how code should be written, such as `CODING_STANDARDS.md` or `CONTRIBUTING.md`.

On top of whatever the repo documents, the Standards axis always carries the **smell baseline** below — a fixed set of Fowler code smells (_Refactoring_, ch.3) that applies even when a repo documents nothing. Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation — and, like any standard here, skip anything tooling already enforces.

Each smell reads *what it is* → *how to fix*; match it against the diff:

- **Mysterious Name** — a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code** — the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy** — a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps** — the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession** — a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches** — the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery** — one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change** — one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality** — abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains** — long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man** — a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest** — a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

### 4. Start both reviewer lanes in parallel

Every child brief must be self-contained. Delegate children do not inherit or discover the master's spec mount, so do not tell either lane to inspect the whole central spec.

**Standards reviewer brief** — include:

- The full diff command and commit list.
- The list of standards-source files you found in step 3, plus the smell baseline from step 3 pasted in full. The reviewer has no other access to it.
- The brief: "Report — per file/hunk where relevant — (a) every place the diff violates a documented standard: cite the standard (file + the rule); and (b) any baseline smell you spot: name it and quote the hunk. Distinguish hard violations from judgement calls — documented-standard breaches can be hard, but baseline smells are always judgement calls, and a documented repo standard overrides the baseline. Skip anything tooling enforces. Under 400 words."

**Spec reviewer brief** — include:

- The diff command and commit list.
- The relevant requirement text extracted from `SPEC.md`, `USER_STORIES.md`, or one central ticket. Include any supplemental incoming-request context needed to interpret it.
- The brief: "Report: (a) requirements that are missing or partial; (b) behavior in the diff that was not asked for; (c) requirements that look implemented but whose implementation is wrong. Quote the supplied requirement for each finding. Judge intent and behavior, not ticket progress or spec status. Under 400 words."

If the spec is missing, skip the Spec reviewer and note this in the final report.

### 5. Aggregate

Present the two reports under `## Standards` and `## Spec` headings, verbatim or lightly cleaned. Do **not** merge or rerank findings — the two axes are deliberately separate (see _Why two axes_).

End with a one-line summary: total findings per axis, and the worst issue _within each axis_ (if any). Don't pick a single winner across axes — that's the reranking the separation exists to prevent.

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions → **Spec pass, Standards fail.**

Reporting them separately stops one axis from masking the other.
