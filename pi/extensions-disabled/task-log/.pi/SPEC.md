# Improve the task-log Pi extension

**Target:** the `task-log` Pi extension
**Status:** ready-for-agent

## Problem Statement

The `task-log` Pi extension preserves useful implementation history across sessions, but the agent cannot create, discover, attach, or finish tasks on its own. The user must run `/task` first. Fresh subagents still receive `task_log` guidance even though they do not inherit the attachment, causing many failed logging attempts.

Attaching a task sends up to 24,000 characters of raw log history into model context. Long logs lose their oldest entries, repeated attachment duplicates context, and resumed sessions keep the old injected snapshot even when another session has changed the shared file. The task files found in real projects have also grown into large project journals, while their two-state lifecycle leaves finished, paused, and human-blocked work marked active.

Task storage is tied to the exact working directory and absolute file paths. Repository subdirectories and Git worktrees can therefore see different task sets. Several worktrees contain divergent files with the same task ID, which breaks the promise of a shared task.

## Solution

Make task continuation the default behavior of the extension.

For substantial work, the agent should continue the attached active task. If no task is attached, it should discover and attach the best active task for the repository, normally the most recently active task that matches the current branch or worktree. It should create a task only when no active task covers the request or the user explicitly starts separate work. `/task` remains the manual switcher and override.

Expose task management to the agent, propagate attachments to subagents, and resolve tasks from one canonical repository store. Replace raw-log injection with a fresh, compact handoff containing the current state, next action, blockers, branch, latest commit, validation state, and references. Keep full history available through bounded, paginated, and searchable reads.

Expand the lifecycle so auto-continuation selects only work that is ready for an agent. Preserve the append-only audit log, but add structured handoff checkpoints and tighter entry-size guidance.

## User Stories

1. As a user starting a new Pi session, I want the latest relevant active task selected automatically, so that I can continue work without first running `/task`.
2. As a user continuing an attached task, I want the agent to keep using it by default, so that one initiative does not fragment into duplicate tasks.
3. As a user starting genuinely separate work, I want the agent to create and attach a new task, so that the new initiative has durable continuity from its first turn.
4. As a user, I want `/task` to remain available as a manual override, so that I can switch, detach, create, or finish work explicitly.
5. As an agent, I want management actions for listing, continuing, creating, attaching, detaching, and changing task status, so that I can use the task system proactively.
6. As an agent, I want “continue” to prefer the current attachment and otherwise choose the best repository task, so that the common path needs one operation.
7. As a subagent, I want to inherit the parent task identity, so that my decisions and findings reach the same shared log.
8. As a subagent without an inherited task, I want task logging disabled or safely resolved, so that I do not spend context on calls that must fail.
9. As a user working across Git worktrees, I want one canonical task record per task ID, so that branches cannot silently create divergent copies.
10. As a user starting Pi from a repository subdirectory, I want the repository task set discovered correctly, so that task visibility does not depend on the exact current directory.
11. As a user resuming a session, I want the agent to receive the current task state from disk, so that changes made by another session are not missed.
12. As a model, I want a compact handoff instead of a large raw log, so that the task consumes little context while preserving the facts needed to continue.
13. As a model, I want the latest handoff and entries written after it, so that corrections and recent changes remain understandable without replaying the whole investigation.
14. As a user, I want full history available through bounded reads, so that old evidence remains recoverable without overflowing model context.
15. As a user, I want task reads filtered by entry type, session, text, and position, so that the agent can retrieve the relevant history instead of loading everything.
16. As a user, I want active, waiting, paused, and done states, so that auto-continuation does not select work waiting on a human or intentionally set aside.
17. As a user, I want the extension to warn when active work has no usable handoff, so that the next session does not have to reconstruct state.
18. As a user, I want references to specs, tickets, plans, pull requests, and evidence stored as first-class task data, so that the log can point to detail instead of copying it.
19. As a user, I want repeated attachment to inject only new or changed state, so that refreshing a task does not duplicate its full history in context.
20. As a user, I want task entry parsing to reject ambiguous log headers and malformed lifecycle data, so that free-form text cannot corrupt later reads.
21. As a user, I want concurrent sessions to append safely, so that one writer cannot erase or misreport another writer’s entry.
22. As a maintainer, I want focused lifecycle, storage, context-budget, and worktree tests, so that continuation behavior remains trustworthy as Pi evolves.
23. As a skill author, I want skills such as `to-spec`, `to-tickets`, and `implement` to reuse the attached task by default, so that each workflow contributes to one continuous record.
24. As a user, I want a skill’s durable output added as a task reference with a concise handoff, so that the task log does not duplicate the specification or ticket body.

## Implementation Decisions

- This specification applies only to the `task-log` Pi extension. It does not change the separate `todo` tool or `/todos` overlay.
- Resume-first is the default. Continue the attached active task, otherwise choose the best active repository task, and create only when no task covers the request or the user explicitly starts separate work.
- Add an agent-facing management tool with list, continue, create, attach, detach, and status actions. Keep `/task` as the interactive UI over the same domain operations.
- Make `continue` atomic. It returns the existing attachment or resolves and attaches one task before returning its compact handoff.
- Rank continuation candidates by repository identity, explicit branch or worktree association, and recent activity. A manual user selection always wins.
- Use one canonical task store for a repository and all its worktrees. Persist repository identity and task ID in session attachment data; treat absolute paths as recoverable location hints rather than identity.
- Propagate the parent task identity into child-agent runs. Child task tools must either use that identity or remain inactive when no task is available.
- Dynamically activate logging and reading tools only while a task is attached. Keep only the small management tool available before attachment.
- Do not persist a complete task log as a conversation message. Inject a provider-only compact task handoff near the current user request and regenerate it from disk when needed.
- Set a small context budget for automatic handoffs. The handoff contains the task objective, status, references, latest structured handoff, and only entries written after that handoff that fit the budget.
- Add a `handoff` log type with current state, next action, blockers, branch or worktree, latest commit, validation state, and references. The file remains append only.
- Use `active`, `waiting`, `paused`, and `done` lifecycle states. Only `active` tasks qualify for automatic continuation.
- Keep ordinary log entries concise. Longer reviews, diagnostics, screenshots, and plans should live in referenced artifacts; the task entry records the conclusion and location.
- Bound `task_read` by both entry count and character budget. Validate limits as positive integers and provide cursor-based pagination plus type, session, and text filters.
- Reattaching or resuming a task refreshes changed state. When the previous injection is still current, do not inject another copy.
- Make references editable through both the management tool and `/task` UI.
- Reject entry text that can masquerade as an entry header, or replace the ambiguous Markdown parser with an encoding that preserves arbitrary text safely.
- Serialize status rewrites with log appends or use an atomic metadata store so concurrent sessions cannot lose data.
- Existing task files remain readable. Migration to canonical storage must detect duplicate task IDs, preserve every divergent file, and require an explicit merge choice rather than silently picking one.
- Skills reuse the attached task. They add their output as a reference and log a concise handoff; they do not open a new task unless the work is separate.

## Implementation Phases

Each phase must preserve existing readable task files and pass its focused public-contract tests before the next phase starts. Tests belong to the phase that introduces the behavior, rather than to a final testing phase.

### Phase 1: Domain operations and lifecycle

Build the shared task domain layer that both agent tools and `/task` will use.

- Define `active`, `waiting`, `paused`, and `done` states. Only `active` tasks qualify for automatic continuation.
- Add domain operations for listing, creating, attaching, detaching, changing status, and managing references.
- Add the structured `handoff` entry shape and validation rules without changing context injection yet.
- Keep existing task files readable and reject malformed lifecycle data or ambiguous entry text.
- Test lifecycle transitions, reference editing, compatibility reads, and parser safety through the registered extension.

**Exit:** the extension has one tested domain API for task lifecycle and metadata, while current manual attachment behavior still works.

### Phase 2: Canonical repository storage

Make task identity independent of the current directory or worktree.

- Resolve repository roots from both the root and nested working directories.
- Introduce canonical repository storage shared by all worktrees.
- Persist repository identity and task ID in session attachments. Treat paths only as recovery hints.
- Serialize appends and status changes so concurrent sessions cannot lose entries or report false success.
- Detect divergent files with the same task ID, preserve every source file, and require an explicit merge choice.
- Test nested directories, multiple worktrees, concurrent writes, moved tasks, and duplicate-ID conflicts.

**Exit:** every checkout and worktree resolves the same task record, and migration cannot silently discard data.

### Phase 3: Resume-first task management

Expose proactive task management and make continuation the default.

- Register the agent-facing management tool with list, continue, create, attach, detach, status, and reference actions.
- Make `continue` atomic. It returns the current valid attachment or selects and attaches one active repository task.
- Rank candidates by repository identity, explicit branch or worktree association, and recent activity.
- Preserve manual user selection and explicit separate-work requests as overrides.
- Rebuild `/task` as the interactive UI over the same domain operations.
- Test one, many, and no active candidates, manual overrides, branch matching, and explicit new work.

**Exit:** a new session can continue the right task without requiring `/task`, and the user can still override every automatic choice.

### Phase 4: Compact, fresh context and bounded history

Replace raw-log injection while keeping full history available on demand.

- Generate a provider-only compact handoff from current disk state near the current user request.
- Include the objective, status, references, latest structured handoff, and newer entries that fit the configured character budget.
- Refresh changed state on resume or reattachment and skip duplicate injection when nothing changed.
- Add count and character limits, cursor pagination, and type, session, and text filters to `task_read`.
- Validate zero, negative, fractional, and excessive limits. Oversized descriptions or entries must not break the context budget.
- Test external session updates, repeated attachment, large histories, pagination, filters, and budget enforcement.

**Exit:** automatic context is fresh, small, and non-duplicating, while agents can retrieve older evidence through bounded reads.

### Phase 5: Subagent and skill integration

Carry task continuity through delegated and skill-driven work.

- Propagate repository and task identity into child-agent runs.
- Activate logging and reading tools only when a task is attached. Children without inherited task identity keep those tools inactive.
- Cover parent and child parallel appends against the same canonical task.
- Update `to-spec`, `to-tickets`, `implement`, and similar skills to reuse the attached task by default.
- Record durable skill outputs as references plus concise handoffs instead of copying their full contents into the log.
- Preserve the existing picker tests for input handling, cleanup, draft preservation, sanitization, and nested dialogs.

**Exit:** parent agents, subagents, and skills contribute safely to one continuous task record without failed no-attachment calls or duplicated artifacts.

## Testing Decisions

- The primary test seam is the registered Pi extension exercised through a fake extension host and temporary repository. Tests should invoke lifecycle events, management tools, logging tools, and context generation through their public contracts rather than mutating internal state.
- Cover a new session with one active task, several active tasks, no active tasks, a manually selected task, and an explicit request for separate work.
- Cover resume and reload after another session appends to the task. The next model context must contain the new handoff without duplicating the old raw log.
- Cover parent and child sessions using the same task identity, including parallel appends and a child with no inherited task.
- Cover a repository root, a nested working directory, and multiple Git worktrees. Every location must resolve the same canonical task.
- Cover duplicate task IDs with divergent files. Migration must report the conflict and leave all source files unchanged.
- Measure automatic context output. Fixtures with very large descriptions, one oversized entry, and hundreds of entries must stay within the configured character budget while keeping the newest handoff.
- Cover read pagination and filters. Zero, negative, fractional, and excessive limits must fail validation or clamp according to the documented contract; none may accidentally return the full log.
- Cover repeated attachment and unchanged resume. The extension must not emit duplicate task context.
- Cover lifecycle selection. Waiting, paused, and done tasks must not auto-resume.
- Cover entry text containing fake headings, control characters, multiline Markdown, and terminal escapes.
- Cover concurrent append and status changes without lost entries or false success messages.
- Preserve the existing picker tests for keyboard handling, cleanup, editor preservation, sanitization, and nested dialogs.

## Out of Scope

- Replacing GitHub, Jira, Linear, or other project issue trackers.
- Changing the independent `todo` tool and `/todos` overlay.
- Turning task logs into full specifications, plans, review reports, or knowledge bases.
- Automatically deciding that unrelated user work belongs to an existing task when the user explicitly says it is separate.
- Synchronizing tasks between different repositories.
- Publishing task contents to a remote service.

## Further Notes

The findings below came from the installed extension and real local artifacts. Session totals include copied fork histories, so they are directional rather than a clean usage benchmark.

- Eleven physical task files represented eight task IDs. Two IDs had divergent copies across worktrees.
- All discovered tasks were still marked active, including tasks whose logs said that no agent work remained or only human action remained.
- The eleven files contained 220 entries and about 445 KB of text.
- Median entry size was 1,828 characters, average size was 1,954, and the largest entry was 7,258 characters. Eighty-nine entries exceeded 2,000 characters.
- Thirty-two attachment messages injected about 382,000 characters. The median injection was about 10,900 characters and the maximum was about 24,500.
- A 79 KB task injected only eight of thirty-one entries. A 71 KB task injected seven of thirty-one. Whole-entry truncation can remove foundational decisions.
- Of 374 persisted `task_log` results, 153 were failures and 151 reported that no task was attached. About 96,000 characters of attempted log bodies were present in failed calls.
- Of 22 persisted `task_read` results, 21 failed because no task was attached.
- The current read action has no character cap. A limit of zero accidentally selects the whole log because of JavaScript slice semantics.
- The attachment stores an absolute path and task ID, but restoration only trusts the path. Moving a task or worktree therefore loses the attachment even when the ID still exists.
- The current references field was empty in every discovered task and cannot be managed through the available tool or picker.
