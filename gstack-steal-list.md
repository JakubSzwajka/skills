# gstack ideas to compare against our skills setup

Date: 2026-05-05

Purpose: quick comparison note after inspecting `garrytan/gstack`. This is not an implementation plan yet. It is a shortlist of ideas worth comparing against the skills we already have and actually use.

## TL;DR

The strongest things to steal are not gstack's giant preamble machinery. They are:

1. sharper role-branded workflows,
2. an end-to-end reviewed planning pipeline,
3. cross-model second opinions,
4. explicit context save/restore,
5. small readiness dashboards before handoff.

Our existing repo-local `docs/tasks/{active,archive}` trajectory model is already stronger than gstack's implicit conversation continuity. Keep that.

## Candidate steals

### 1. Role-branded skills with harder identities

**What gstack does**

Uses memorable specialists: CEO/founder, eng manager, senior designer, QA lead, CSO, release engineer.

**What we have**

Our skills are more functional/internal:

- `prd-create`
- `pipeline-ui`
- `review`
- `triage`
- `research-deep`
- `test`
- `update-docs`

**Possible steal**

Keep our mechanics, but sharpen role framing and defaults:

- founder/product challenger
- engineering reviewer
- design challenger
- QA/verifier
- release/readiness checker
- security reviewer

Do not turn it into theatre. Role identity should improve questions, stop conditions, and output quality.

### 2. `/autoplan` equivalent

**What gstack does**

Chains multiple planning reviews into one reviewed plan: product/CEO, design, engineering, DX.

**What we have**

`prd-create` creates durable repo task artifacts, but it does not currently run a full adversarial review gauntlet by default.

**Possible steal**

Create an `autoplan`-style workflow around our task artifact format:

```txt
idea / request
  -> product challenge
  -> design challenge if UI
  -> engineering challenge
  -> task decomposition
  -> docs/tasks/active/<task>/{prd.md,tasks.md,log.md}
```

Output should be a reviewed PRD + executable task graph, not just a chat plan.

### 3. Cross-model second opinion

**What gstack does**

`/codex` runs OpenAI Codex as independent reviewer/consultant/adversarial challenger, then compares overlap with Claude review findings.

**What we have**

Our `review` skill delegates to a fresh subagent, but usually same model family unless manually changed.

**Possible steal**

Add a `codex-second-opinion` or `cross-model-review` skill:

- review current diff,
- challenge a plan,
- ask Codex/Gemini for adversarial edge cases,
- synthesize overlap vs unique findings,
- keep read-only unless explicitly asked otherwise.

This is high leverage because model diversity catches different bugs.

### 4. Context save / context restore

**What gstack does**

Uses checkpoint commits and `/context-restore` to reconstruct session state after crashes/context switches.

**What we have**

`dont-start-blind` reads task artifacts and git state. `prd-create`/pipeline flows maintain `prd.md`, `tasks.md`, `log.md`.

**Possible steal**

Add small explicit skills:

- `context-save`: write current branch, task folder, decisions, blockers, next step, tests/review state.
- `context-restore`: read the saved context + task artifacts + git state and produce a tight working brief.

Prefer repo-local task artifacts over WIP commits as the canonical state. Optional commits can remain separate.

### 5. Handoff packet / readiness dashboard

**What gstack does**

Some skills produce review readiness summaries and completion reports.

**What we have**

We often summarize manually. AFK/status tools exist, but handoff shape is not uniformly enforced across skills.

**Possible steal**

Standardize final handoff blocks:

```txt
Result
Files changed
Evidence / tests
Decisions
Blockers
Next owner / next step
Readiness: plan | implementation | tests | review | docs
```

This should be short and consistent, especially for pipeline/AFK work.

### 6. Better spawned-session mode

**What gstack does**

Detects spawned sessions, skips noisy prompts, auto-chooses defaults, focuses on task completion and reporting.

**What we have**

Subagents are used in `review`, `triage`, `research-deep`, and `dont-start-blind`, but spawned/background behavior is mostly prompt-by-prompt.

**Possible steal**

Define a reusable spawned-agent contract:

- no user questions unless truly blocked,
- read-only unless assigned to edit,
- concise final report,
- explicit status: complete / blocked / needs review,
- include evidence and next step.

### 7. Local skill run telemetry

**What gstack does**

Logs skill usage, timeline, duration, outcomes, learnings.

**What we have**

We have repo task logs and some AFK status, but not a simple local skill-run history.

**Possible steal**

Local-only JSONL, no analytics bullshit:

```txt
~/.agents/skill-runs.jsonl
```

Fields:

- skill
- repo
- branch
- task folder
- started/ended
- outcome
- blocker category

Use it to improve skills and see what is actually used.

### 8. Learnings prompt at skill end

**What gstack does**

Skill sessions can log project learnings for future sessions.

**What we have**

`repo-learnings` exists and AGENTS.md updates are possible, but it is manually invoked.

**Possible steal**

At the end of major skills, ask internally:

- did we learn a repo rule that belongs in `AGENTS.md`?
- did we learn a user/workflow preference that belongs in experience?
- did we learn durable technical knowledge that belongs in KB?

Keep conservative. Do not write memory spam.

### 9. Browser/human handoff pattern

**What gstack does**

`$B handoff` lets a human take over browser auth/CAPTCHA/MFA, then `$B resume` continues.

**What we have**

No dedicated browser handoff flow in the skills setup.

**Possible steal**

Later: a browser skill/tool pattern for:

```txt
agent stuck on auth -> human takes over -> agent resumes with same browser state
```

Not urgent unless browser automation becomes a bigger part of our normal workflow.

### 10. Design shotgun branch for UI work

**What gstack does**

Generates multiple design directions, shows comparison board, collects feedback, then hands chosen direction to implementation.

**What we have**

`pipeline-ui` and `design-challenger` are useful, but not a true multi-direction option generator.

**Possible steal**

Extend `pipeline-ui` with an optional exploration mode:

```txt
brief -> 3 directions -> critique/pick -> implement -> verify
```

Useful when taste/direction is uncertain. Skip when the UI change is obvious.

## Suggested implementation order

1. `autoplan` around our `docs/tasks` artifact format.
2. `cross-model-review` / `codex-second-opinion`.
3. `context-save` + `context-restore`.
4. standardized handoff/readiness block across major skills.
5. local skill-run telemetry.
6. optional design-shotgun mode inside `pipeline-ui`.

## Guardrails

- Do not import gstack's giant preamble monster.
- Do not replace repo-local task artifacts with loose global memory.
- Do not add role names unless they change behavior/output.
- Keep review-only skills read-only.
- Keep telemetry local and inspectable.
- Prefer small composable skills over one giant magical workflow.
