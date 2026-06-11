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

Workflow:
1. Check `docs/tasks/active/` and `docs/tasks/archive/` for overlapping work.
2. If problem, goal, scope, out-of-scope, product language, or owner decisions are missing, explicitly use `grill-me`: ask one question at a time, include your recommended answer, cross-check repo docs/code when useful, and stop once the design is clear enough to draft.
3. Create the task folder and write `prd.md` using `references/prd-format.md`. `scripts/init_prd.sh <slug>` scaffolds the folder + skeletons if you want a starting point.
4. Decompose into executable subtasks using `references/task-format.md`.
5. Validate the artifact: run `python3 scripts/validate_prd.py <task-folder>` (or the `validate_prd.sh` shim) and fix every error before continuing. It checks the `prd.md` sections + Collateral keys and that every subtask carries all 8 fields with a valid status. Don't skip the empty-looking fields: a subtask that omits `blockers:` or `evidence:` is ambiguous to downstream execution/AFK workflows — they can't tell "no blockers" from "not yet assessed", so the subtask isn't safely runnable. The validator catches exactly these omissions.
6. Run the codebase challenge loop using `references/challenge-loop.md`; outcome is GO or NO-GO.
7. Mechanically fix concrete issues; if the challenge exposes product/scope/design/architecture/domain-language holes, go back to `grill-me` before continuing.
8. Present folder path, compact task tree, challenge result, and next step.

Hard rules:
- Downstream execution/AFK workflows must be able to execute `tasks.md` without inventing policy.
- Each subtask must include status, deps, intent, target files/modules, acceptance, verification, evidence, and blockers.
- A subtask is runnable only when status is `open` or `in_progress`, all deps are `done`, and blockers are empty.
- Do not mark work `done` without evidence mapped to acceptance criteria.
- Store operational implementation state only in the repo task artifact, not KB or external PM tools. Use any project-declared tracker only for PM-facing status, links, blockers, and handoff notes.
- Append meaningful discoveries and progress to `log.md` with `lucy` as author.
- Do not delete challenge evidence unless explicitly approved.

Handoff:
- If converged: `PRD is ready for review. Want me to start execution?`
- If decisions remain: list only the blocking questions and stop.
