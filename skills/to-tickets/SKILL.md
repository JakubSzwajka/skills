---
name: to-tickets
description: Break a central spec, plan, or conversation into local tracer-bullet tickets under the spec's tickets directory, each with explicit blocking edges.
disable-model-invocation: true
---

# To tickets

Break the work into tracer-bullet tickets. The canonical output is always local at `~/.pi/specs/<YYYY-MM-DD>_<feature-slug>/tickets/`.

## Process

### 1. Gather context

Use the mounted central spec or an exact central spec path supplied by the user. If no central spec exists, run `/to-spec` first. Read `SPEC.md` and `USER_STORIES.md` when present, then add relevant context from the current conversation. A GitHub or GitLab issue may supply an incoming request, but it is only a source. Do not create a mirror, sync changes back, or let remote state control the spec.

### 2. Explore the codebase when needed

Use the project's domain glossary and respect ADRs. Look for prefactoring that makes the change easier.

### 3. Draft vertical slices

Each ticket should cut a narrow, complete path through every affected layer. It must be demoable or verifiable on its own and fit in one fresh context window. Put prefactoring first.

Give each ticket its blocking edges. A ticket with no blockers can start at once.

Wide mechanical refactors are the exception. Use expand-contract: add the new form, migrate call sites in batches that keep CI green, then remove the old form after every migration. If no batch can stay green alone, use an integration branch and end with an integrate-and-verify ticket.

### 4. Get approval

Show a numbered draft with each title, its blockers, and what it delivers. Ask whether the size and edges are right, then revise until the user approves.

### 5. Write local tickets

Create `tickets/` only now, then write one file per approved ticket as `<NN>-<slug>.md`, numbered from `01` in dependency order. Never publish these tickets to GitHub, GitLab, or another tracker. Do not close or modify an incoming source issue.

Work the frontier: a ticket can start when its listed blockers are complete. Ticket boxes and blockers are implementation aids only. `/spec` ignores them, and they never change the spec's `pending` or `done` state.

<local-ticket-template>

# <NN> — <Ticket title>

**What to build:** The end-to-end behavior this ticket makes work from the user's point of view, not a layer-by-layer implementation list.

**Blocked by:** The numbers and titles that gate this ticket, or "None — can start immediately".

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2

</local-ticket-template>

Acceptance boxes may record ticket progress. Do not add a spec status field to a ticket. The operator changes spec lifecycle only with `/spec:status pending|done`.

Avoid file paths and code snippets that will go stale. A prototype snippet may be included when it captures a decision more clearly than prose. Keep only the decision-rich part and cite its central prototype record.
