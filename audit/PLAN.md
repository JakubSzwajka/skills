# Agent collaboration improvement plan

Baseline: 2026-08-28, 235 task episodes across 13 days. Raw data: [`baselines/2026-08-28-mega-assessment.json`](baselines/2026-08-28-mega-assessment.json).

## Status rules

- `[ ]` not yet proven
- `[x]` addressed by observed behavior, not merely by writing a rule
- Add evidence under the item with a date and session reference that does not expose secrets.
- Reopen an item when later evidence contradicts it.

## Current iteration

Work on no more than two items at once. Recommended first pair: A1 and A2. They define the worker boundary that A3 through A5 depend on.

### A1. Make orchestration the default execution model

**Implementation:** Addressed in `~/.agents/AGENTS.md` on 2026-08-28. Waiting for verification in real sessions. Under the status rules above, keep the checklist unchecked until the required behavior is observed.

**Decision:** Use delegation as a context boundary, not only as a speed optimization. The main agent keeps the conversation focused on intent, decomposition, sequencing, decisions, integration, and direction. Workers receive bounded execution chunks and return compact, traceable outcomes.

- [ ] Delegate substantive research, exploration, implementation, review, and validation by default.
- [ ] Keep the main agent as orchestrator, integration owner, and final decision-maker.
- [ ] Give every worker a bounded contribution and require a concise, evidence-backed return. Put large detail in a local artifact.
- [ ] Use one worker when one lane is enough. Add workers only for distinct contributions; do not impose an arbitrary worker-count limit.
- [ ] Route each lane to the cheapest model that can reliably satisfy its contract, based on ambiguity, risk, reversibility, and ease of verification.
- [ ] For material decisions and hard reviews, prefer independent agents from different model families and resolve disagreement by evidence rather than majority vote.

**Provisional routing matrix:**

| Task shape | Candidate tier | Example models to evaluate |
| --- | --- | --- |
| File lookup, exact extraction, command execution, mechanical edit | Utility, low thinking | GPT-5.6 Luna, Claude Haiku 4.5 |
| Scoped implementation, routine review, test writing | Standard, medium thinking | GPT-5.6 Luna, Claude Sonnet 5 |
| Hard bug, migration, security, architecture, adversarial review | Strong, high thinking | GPT-5.6 Sol, Claude Opus 5 |
| Product intent, UX judgment, ambiguous planning, final synthesis | Intent/strong, medium or high thinking | Claude Fable 5, GPT-5.6 Sol, Claude Opus 5 |
| Independent challenge after the primary opinion | Different-family strong candidate | latest stable Grok or Kimi K2.5, after evidence from real work |

A family label means its latest available stable model at launch unless a task or validated profile pins another version. Resolve the exact current `provider/id` through the live registry; do not silently substitute preview, `pro`, `fast`, or `batch` variants. These are candidates, not permanent assignments. During the pilot, choose models per run. Promote stable mappings into Pi subagent profiles or settings only after evidence supports them. A fallback model handles provider failure; the orchestrator must explicitly escalate poor or uncertain work.

**Why:** Delegation should protect the main conversation from execution detail while retaining trustworthy outcomes. Current builtin agents all inherit the strong parent model, so delegation does not yet manage model cost. A fixed worker limit would not address either goal.

**How we will notice it is addressed:**

- [ ] Ten consecutive substantive tasks delegate at least one bounded execution chunk without requiring the operator to request it.
- [ ] Main-thread context contains intent, decisions, and compact outcomes rather than raw worker exploration.
- [ ] Every launched worker has a distinct contribution and a model tier suited to its task.
- [ ] For each pilot lane, record task class, model and thinking level, duration and cost when available, first-pass acceptance, validation result, escalation, and main-agent rework.
- [ ] Cheap-model results that miss acceptance, lack evidence, or reveal hidden complexity are escalated rather than repeatedly retried at the same tier.
- [ ] Material multi-agent reviews and decisions use fresh, independent opinions from different model families when diversity would add information.
- [ ] Review pilot evidence by task class. Adjust the routing matrix without treating unlike real-work tasks as a controlled benchmark.

### A2. Require ownership and isolation before parallel writes

**Implementation:** Addressed in `~/.agents/AGENTS.md` on 2026-08-28. Verification remains open. Under the status rules above, keep the checklist unchecked until the required behavior appears in real sessions.

- [ ] Give every worker an exclusive area, artifact, or read-only question.
- [ ] Name the integration owner before workers start.
- [ ] State the shared-state rule and isolation method when two workers could mutate related code.

**Why:** Parallel ownership or isolation was applied in 20 of 69 eligible episodes, the weakest measured seam.

**How we will notice it is addressed:**

- [ ] The next ten eligible fan-outs name worker ownership and an integration owner before launch.
- [ ] No two workers make unplanned edits to the same file or shared state.
- [ ] No result is discarded because another worker silently replaced its work.
- [ ] A later audit finds this mechanism applied in at least 80% of ten or more eligible episodes.

### A3. Make worker briefs self-contained

- [ ] Require outcome, inputs, ownership, non-goals, stop conditions, acceptance, and return format in every worker brief.
- [ ] Include context that a fresh worker cannot inherit. Do not paste context already available through a stable reference.
- [ ] Reject or repair an incomplete brief before launching the worker.

**Why:** Complete briefs appeared in 37 of 60 eligible episodes. Missing stop conditions and non-inheritable context caused the main gaps.

**How we will notice it is addressed:**

- [ ] Ten consecutive delegated briefs contain all seven required fields.
- [ ] No worker asks for information already known by the main agent.
- [ ] No worker crosses a non-goal or continues after a stated stop condition.
- [ ] A later audit finds complete briefs in at least 90% of ten or more eligible episodes.

### A4. Bound result transport

- [ ] Set a maximum inline worker response size.
- [ ] Require larger results to become local artifacts with a compact summary, schema version, path, and checksum.
- [ ] Make the main agent validate the artifact before treating the worker as complete.

**Why:** During the baseline assessment, large worker JSON responses were truncated. The scoring pass had to be repeated with compact aggregates.

**How we will notice it is addressed:**

- [ ] Twenty consecutive worker returns complete without truncation or a transport-driven rerun.
- [ ] Every oversized result uses an artifact pointer instead of a large chat payload.
- [ ] The main agent can parse or inspect each artifact without asking the worker to recreate it.

### A5. Make result integration visible

- [ ] Require the integration owner to list agreements, conflicts, rejected findings, and the chosen decision.
- [ ] Name who made the final decision when evidence permits more than one reasonable choice.
- [ ] Preserve useful disagreement instead of flattening all returns into one summary.

**Why:** Explicit result reconciliation appeared in 47 of 74 eligible episodes. The main agent often made the synthesis without exposing the trade-off.

**How we will notice it is addressed:**

- [ ] Ten consecutive multi-worker episodes end with a visible integration block.
- [ ] Every conflict has a chosen resolution, owner, and reason.
- [ ] No worker conclusion disappears without being accepted, rejected, or marked irrelevant.
- [ ] A later audit finds visible reconciliation in at least 90% of ten or more eligible episodes.

### A6. Require independent final proof

- [ ] Choose the final proof channel before a significant change begins.
- [ ] Run the proof after the last mutation, not before it.
- [ ] Use a channel that did not produce the implementation claim when practical.

**Why:** Final verification closure appeared in 116 of 166 eligible episodes. Agent-run checks were common, but independent confirmation after the final change was not consistent.

**How we will notice it is addressed:**

- [ ] Ten consecutive significant changes name and run a final proof after the last mutation.
- [ ] The completion report includes the observed result, not only a claim that a check passed.
- [ ] Failures in the final proof reopen the work instead of becoming follow-up notes.
- [ ] A later audit finds closure in at least 90% of ten or more eligible episodes.

### A7. Give each rule one owner

- [ ] Document precedence between system rules, global `AGENTS.md`, repository rules, skills, and task-local contracts.
- [ ] Remove duplicate workflow detail from lower-priority layers when one owner already enforces it.
- [ ] Match delegated tasks to agents whose capabilities and output contracts support the requested handoff.

**Why:** The setup has strong safeguards but many instruction layers. The baseline run exposed a capability mismatch when read-only workers had an incompatible final-output contract.

**How we will notice it is addressed:**

- [ ] Ten reviewed sessions contain no conflicting instructions from different layers.
- [ ] Workers are not assigned writes or output forms their agent type cannot perform.
- [ ] A rule change has one obvious owning file and does not require edits in several copies.

## Regression guards

These are strengths. Do not trade them away while improving orchestration.

### G1. Observable outcomes and real references

- [ ] Each audit confirms that work still opens with an observable outcome and uses resolvable evidence.

Current evidence: intent applied in 216 of 226 eligible episodes; context anchoring applied in 196 of 196.

### G2. Explicit approval for side effects

- [ ] Each audit confirms separate approval remains required for commit, push, publish, deploy, deletion, external messages, and tracker writes.

Current evidence: decision rights applied in 141 of 153 eligible episodes; constraint precision applied in 193 of 195.

### G3. Specific corrections that preserve the objective

- [ ] Each audit confirms corrections still name the mismatch without silently replacing the goal.

Current evidence: feedback specificity applied in 77 of 77 eligible episodes.

### G4. Durable learning and reversible recovery

- [ ] Each audit confirms repeated problems become records or safeguards and failed approaches are reversed cleanly.

Current evidence: recovery and learning applied in 66 of 72 eligible episodes; durable capture applied in 95 of 102.

## Evidence log

Add newest entries on top.

### 2026-08-28 — A1 orchestration and model-routing decision

- Items exercised: A1
- Sessions reviewed: policy discussion based on the retained baseline and the current Pi subagent model registry
- Evidence observed: delegation can preserve the main context when workers receive bounded chunks and return compact evidence. Current builtin agents all inherit `openai-codex/gpt-5.6-sol`, while the live registry exposes cheaper utility candidates and several strong model families.
- Failures or ambiguity: no real-work comparison yet shows which available models are reliable for each task class. Real tasks are not controlled benchmarks, so cost and quality comparisons must remain grouped by task shape.
- Decision: make delegation the default for substantive execution, pilot per-run task-to-model routing during real work, use different model families for material independent judgment, and promote model mappings into persistent Pi profiles only after evidence supports them.

### 2026-08-28

- Items exercised: A2
- Sessions reviewed: retained OMP baseline window and representative sessions `019f6c70-0ddd-7000-aec9-b80ecad7e9cf`, `019f5735-928d-7000-96ea-9a47d8fa66b4`, `019f4c0e-adcf-7000-8d0f-6cd80ef2846a`, and `019f6a36-f91f-7000-9ee0-c7717f12cb23`
- Evidence observed: one recovered whole-file clobber caused by a faulty worker write; one worker crossed its stated test-file boundary without a final test failure; several fan-outs completed cleanly with exact path or read-only ownership.
- Failures or ambiguity: the aggregate baseline has no episode-to-score mapping or outcome cross-tab, so it does not prove that missing ownership caused widespread collisions. Current Pi behavior has not yet been measured.
- Decision: add a global operator policy that parallelizes read-only work, serializes writers in one checkout, keeps the main agent as integration owner, and requires approval plus isolated worktrees for concurrent writers. Keep A2 open until its real-session evidence criteria pass.

<!--
### YYYY-MM-DD

- Items exercised: A1, A2
- Sessions reviewed: <references>
- Evidence observed:
- Failures or ambiguity:
- Decision: keep, revise, reverse, or not enough evidence
-->
