---
name: prd-create
description: >
  Capture a feature idea or change as a repo-local PRD task folder under docs/tasks/active/,
  then challenge it against the codebase. Use when the user wants to write a PRD,
  capture a feature idea, plan a change, break work into tasks, or says things like
  "create a prd", "plan this", "break this down", "decompose into tasks", "create tasks for",
  "prd to tasks".
---

# PRD Create

Create a repo-local execution artifact for a feature/change. This skill owns the `docs/tasks` format.

Canonical artifact:

```txt
docs/tasks/active/<YYYY-MM-DD-slug>/
  prd.md    # spec / product contract
  tasks.md  # executable task graph
  log.md    # continuity notebook
```

Ready checklist before handoff:
- Overlap checked.
- 10-step `grill-me` alignment completed; deeper branches closed or listed as blockers.
- `prd.md` follows `references/prd-format.md`.
- `tasks.md` follows `references/task-format.md`.
- Final validation ladder is present.
- Required checkpoint/final review gates are present.
- `validate_prd.py` passes.
- Challenge loop is `GO`, or remaining blockers are listed.

Workflow:
1. Check `docs/tasks/active/` and `docs/tasks/archive/` for overlapping work.
2. Always run a mandatory `grill-me` alignment session before finalizing the PRD artifact, even when the user's initial request appears complete. Apparent alignment is not enough.
   - Minimum: 10 focused alignment steps/questions.
   - Ask one question at a time, include your recommended answer and a short reason, and cross-check repo docs/code when useful.
   - Cover, at minimum: problem, primary user/workflow, goal/success, included scope, out-of-scope, product/domain language, acceptance criteria, edge cases, existing-system constraints, and stop conditions.
   - If any answer opens a deeper branch, follow that branch before treating the PRD as aligned. Ten steps is a floor, not a cap.
   - Do not finalize the PRD while material product, design, architecture, quality, or domain-language decisions remain unresolved.
3. Create the task folder and write `prd.md` using `references/prd-format.md`. `scripts/init_prd.sh <slug>` scaffolds the folder + skeletons if you want a starting point. Record the alignment decisions in `prd.md` and/or `log.md` as appropriate.
4. Decompose the implementation into executable subtasks using `references/task-format.md`.
5. Add explicit late validation subtasks using the repo's real scripts, docs, Compose files, and CI conventions. Cover static/local health, automated tests, and runtime/manual verification or justified equivalents. Use `engineering:local-docker-gateway` for Docker Compose web stacks when feasible.
6. Add review gates using `references/task-format.md`: count only meaningful implementation subtasks, excluding validation, review, release, and bookkeeping tasks. For now, add one checkpoint review after the first 4 implementation subtasks when there are more than 4, and always add a final review after final validation.
7. Validate the artifact: run `python3 scripts/validate_prd.py <task-folder>` (or the `validate_prd.sh` shim) and fix every error before continuing.
8. Run the codebase challenge loop using `references/challenge-loop.md`; outcome is GO or NO-GO.
9. Mechanically fix concrete issues; if the challenge exposes product/scope/design/architecture/domain-language holes, go back to `grill-me` before continuing.
10. Present folder path, compact task tree, challenge result, and next step.

Hard rules:
- A user request to create/write a PRD means create the PRD artifact; do not skip PRD creation because the work seems small.
- Mandatory `grill-me` alignment, final validation, and review gates are part of PRD creation, not optional polish.
- Downstream execution/AFK workflows must be able to execute `tasks.md` without inventing policy: every subtask has all 8 fields, runnability is explicit, and `done` requires evidence mapped to acceptance.
- Store operational implementation state only in the repo task artifact, not KB or external PM tools. Use any project-declared tracker only for PM-facing status, links, blockers, and handoff notes.
- Append meaningful discoveries and progress to `log.md` with `lucy` as author.
- Do not delete challenge evidence unless explicitly approved.

Handoff:
- If converged: `PRD is ready for review. Want me to start execution?`
- If decisions remain: list only the blocking questions and stop.
