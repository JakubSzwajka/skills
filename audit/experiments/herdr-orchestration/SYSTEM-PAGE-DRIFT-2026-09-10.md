# system.html drift audit

## Verdict

**Drift is material.** The task-log panel is mostly current, but How it fits overstates Task continuity, Orchestration still depicts forbidden nesting, Missing mislabels child behavior as a design decision, and the footer names the retired pi-subagents source.

## Drift table

| system.html claim | Status | Corrected claim | Source evidence |
|---|---|---|---|
| "One task carries the work through every handoff"; Task links Coordinator, children, run artifacts, and Lucy (`system.html:731,736,791-812`). | **Wrong/misleading** | Task attachment is session-local. `delegate start` accepts a brief and handoff path, but no task ID; child task context is not propagated or backlink-created. | `pi/extensions/delegate/delegate.ts:129-158,167-184`; `pi/extensions/delegate/types.ts:10-27`; `pi/extensions/task-log/index.ts:472-508` |
| Coordinator permits bounded nesting; Agent1.1 can delegate (`system.html:930,954-964`). | **Wrong** | Delegation depth is one. A child gets `PI_DELEGATE_ROLE=child`; the delegate extension does not register there, and the injected return contract says not to delegate. | `pi/extensions/delegate/README.md:45-48`; `pi/extensions/delegate/index.ts:17-18`; `pi/extensions/delegate/delegate.ts:167-170,461-462` |
| Coordinator gives path-owned lanes and takes evidence back (`system.html:928-982`). | **Mostly correct, wording loose** | The parent session uses the `delegate` tool. Briefs can state owned paths, and workers return handoffs through the assigned file/intercom; ownership is policy, not a runtime path restriction. | `ORCHESTRATION.md:40-58`; `pi/extensions/delegate/index.ts:119-144`; `pi/extensions/delegate/README.md:20-24` |
| Lucy observes live run artifacts and parent controls (`system.html:760-761,807-810,967-980`). | **Correct with caveat** | Lucy sees sessions and delegate lane registries, including pane, status, handoff, ring/read state. It does not show attached Task identity. | `LUCY_CLI.md:7-10,37-40`; `pi/extensions/delegate/delegate.ts:103-124` |
| Task attachment injects compact context, enables `task_log`/`task_read`, and uses `.git/pi/task-log/tasks` shared across worktrees (`system.html:816-874`). | **Correct for parent sessions** | `/task`/`task_manage` attach a task; attached context is fingerprinted and deduplicated; canonical storage is under Git common dir. Delegate children are a caveat: their child marker differs from task-log's `PI_SUBAGENT_CHILD` guard. | `pi/extensions/task-log/index.ts:44-62,426-461`; `pi/extensions/task-log/repository.ts:120-138`; `pi/extensions/task-log/index.ts:242,330-359` |
| Reference has no type; no current ticket (`system.html:1010-1022`). | **Confirmed** | References remain untyped strings, with no current-ticket field. | `pi/extensions/task-log/service.ts:213-239`; `pi/extensions/task-log/index.ts:150-168,340-349` |
| No automatic task backlink; Coordinator records evidence by hand (`system.html:1057-1066`). | **Confirmed, but explain mechanism** | Delegate lane records contain no task field; the parent must read the handoff and separately log/reference it. | `pi/extensions/delegate/types.ts:10-27`; `pi/extensions/delegate/delegate.ts:144-158,245-257`; `pi/extensions/task-log/service.ts:18-22,220-224` |
| "Child task detachment by design; brief carries everything" (`system.html:1042-1045,1066`). | **Stale/misleading** | Children receive a work brief, but no task attachment is propagated. Detachment is not the documented delegate design; depth-one suppression is. | `pi/extensions/delegate/README.md:20-24,45-48`; `pi/extensions/task-log/index.ts:44-45,500-509`; `pi/extensions/delegate/delegate.ts:167-170` |
| Footer says it was built from "pi-subagents docs" and "Lucy's README" (`system.html:1072`). | **Stale** | Name `pi/extensions/delegate/README.md`, `ORCHESTRATION.md`, and `LUCY_CLI.md`; `ORCHESTRATION.md` explicitly says no pi-subagents. | `ORCHESTRATION.md:1-7`; `LUCY_CLI.md:1-10`; `pi/extensions/delegate/README.md:1-5` |

## Minimal page changes

1. Recast How it fits around parent session → `delegate` lane → handoff/intercom, and remove the implied Task-to-child/run-artifact link.
2. Remove Agent1.1 and "child can delegate"; state depth-one delegation.
3. Keep the four real gaps, but replace the child "by design" box with missing task propagation (and note the marker mismatch).
4. Update the footer source names. Add a caveat in Task if it still claims all sessions behave alike.

## Checked and confirmed

- Task lifecycle includes active, waiting, paused, done (`pi/extensions/task-log/index.ts:242-243`); references are editable (`pi/extensions/task-log/index.ts:150-168`).
- Compact task context is regenerated and deduplicated (`pi/extensions/task-log/index.ts:426-461`).
- Delegate uses Herdr panes, assigned handoffs, intercom rings, and actions start/list/read/wait/stop (`pi/extensions/delegate/README.md:3-17`).
- Lucy delegation is not the execution path; `delegate` owns it (`LUCY_CLI.md:7-10`; `ORCHESTRATION.md:1-7`).
- All named owned paths existed. No files were edited except this handoff.
