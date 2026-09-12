---
name: setup-matt-pocock-skills
description: Configure central spec guidance, the incoming-request tracker, triage labels, and domain docs for a repository.
disable-model-invocation: true
---

# Setup Matt Pocock's Skills

Scaffold the configuration that the engineering skills assume:

- **Central specs** — every spec and generated implementation ticket lives under `~/.pi/specs/`
- **Incoming-request tracker** — where raw issues arrive before synthesis
- **Triage labels** — the strings used for the five canonical triage roles
- **Domain docs** — where `CONTEXT.md` and ADRs live, and the consumer rules for reading them

This is a prompt-driven skill, not a deterministic script. Explore, present what you found, confirm with the user, then write.

## Process

### 1. Explore

Look at the current repo to understand its starting state. Read whatever exists; don't assume:

- `git remote -v` and `.git/config` — is this a GitHub repo? Which one?
- `AGENTS.md` and `CLAUDE.md` at the repo root — does either exist? Is there already an `## Agent skills` section in either?
- `CONTEXT.md` and `CONTEXT-MAP.md` at the repo root
- `docs/adr/` and any `src/*/docs/adr/` directories
- `docs/agents/` — does this skill's prior output already exist?
- `.scratch/` — legacy local records that must not be migrated, edited, deleted, or reused for new specs
- Is the `triage` skill installed? (a `triage` skill folder alongside this one, or `triage` in your available skills.) This decides whether Section B runs at all.
- Monorepo signals — a `pnpm-workspace.yaml`, a `workspaces` field in `package.json`, or a populated `packages/*` with its own `src/`. Present only in a genuinely large multi-package repo; their absence means single-context, which is almost every repo.

### 2. Present findings and ask

Summarise what's present and what's missing. Then take the sections in order — one section, one answer, then the next.

Lead each section with the recommended answer so the user can accept it in a word. Give a one-line explainer only when the choice genuinely branches; skip the section entirely when exploration already settled it (Section B when `triage` isn't installed, Section C when there's no monorepo).

**Section A — Incoming-request tracker.**

> Explainer: This choice says where raw bug reports and feature requests arrive. It does not choose the spec store. `/to-spec` always writes a central spec, and `/to-tickets` always writes local central tickets.

If a remote points at GitHub, recommend GitHub. If it points at GitLab, recommend GitLab. Otherwise offer:

- **GitHub** — incoming requests use GitHub Issues and the `gh` CLI
- **GitLab** — incoming requests use GitLab Issues and the `glab` CLI
- **Local markdown** — local work requests become central specs and tickets; new files never use `.scratch`
- **Other** — ask for the incoming-request workflow in one paragraph

Record the choice in `docs/agents/issue-tracker.md`. Remote issues are sources, not mirrors. They do not sync with central tickets and never set spec status. The GitHub and GitLab templates carry a request-surface flag for PRs or MRs, defaulted off. Leave it off unless the user asks to change it.

**Section B — Triage label vocabulary.** Skip this section entirely if the `triage` skill isn't installed (exploration told you) — an uninstalled skill needs no labels.

If it is installed, ask exactly one question:

> Do you want to keep the default triage labels? (recommended: **yes**)

The defaults are the five canonical roles, each label string equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. On **yes**, write them as-is. Only if the user says no — usually because their tracker already uses other names (e.g. `bug:triage` for `needs-triage`) — collect the overrides so `triage` applies existing labels instead of creating duplicates.

**Section C — Domain docs.** Default to **single-context** — one `CONTEXT.md` + `docs/adr/` at the repo root. This fits almost every repo; write it without asking.

Offer **multi-context** — a root `CONTEXT-MAP.md` pointing to per-context `CONTEXT.md` files — only when exploration found monorepo signals. Then confirm which layout they want.

### 3. Confirm and edit

Show the user a draft of:

- The `## Agent skills` block to add to whichever of `CLAUDE.md` or `AGENTS.md` is being edited
- The contents of `docs/agents/issue-tracker.md`, `docs/agents/domain.md`, and `docs/agents/triage-labels.md`, with the last file only when `triage` is installed

Let them edit before writing.

### 4. Write

**Pick the file to edit:**

- If `CLAUDE.md` exists, edit it.
- Else if `AGENTS.md` exists, edit it.
- If neither exists, ask the user which one to create — don't pick for them.

Never create `AGENTS.md` when `CLAUDE.md` already exists (or vice versa) — always edit the one that's already there.

If an `## Agent skills` block already exists in the chosen file, update its contents in-place rather than appending a duplicate. Don't overwrite user edits to the surrounding sections.

The block:

```markdown
## Agent skills

### Central specs

Specs live at `~/.pi/specs/<YYYY-MM-DD>_<feature-slug>/`. Each requires `SPEC.md` and schema-v1 `spec.json` with `title` and `status`. Status is `pending` or `done`; `completedAt` exists only while done. Write `USER_STORIES.md` when needed and create `tickets/`, `research/`, `prototypes/`, and `log/` only when used. `/to-tickets` writes local implementation tickets under `tickets/`. `/spec` is a master-only mount. Ticket progress never sets spec status.

### Incoming-request tracker

[one-line summary of where incoming requests are tracked]. See `docs/agents/issue-tracker.md`.

### Triage labels

[one-line summary of the label vocabulary]. See `docs/agents/triage-labels.md`.

### Domain docs

[one-line summary of layout, "single-context" or "multi-context"]. See `docs/agents/domain.md`.
```

The central-spec block must also state that `/spec` lists all pending specs and done specs completed within 72 hours, and keeps a mounted spec mounted regardless of age. `/spec:clear` unmounts; `/spec:status pending|done` changes lifecycle state. `/spec:log:append` is the operator command and `spec_log_append` is the master-only tool. Each append creates one immutable timestamped Markdown file. Log approvals or amendments, rejected alternatives, material discoveries or scope changes, verifier outcomes, and completion or reopening. Do not log prompts, ordinary tool calls, every test, generated files, ticket boxes, or routine handoffs. Delegate children do not inherit or discover the mount and receive self-contained briefs.

Include the `### Triage labels` sub-block, and write `docs/agents/triage-labels.md`, only when `triage` is installed and Section B ran. When it isn't, both are omitted.

Then write the docs files using the seed templates in this skill folder as a starting point:

- [issue-tracker-github.md](./issue-tracker-github.md) — GitHub incoming-request tracker
- [issue-tracker-gitlab.md](./issue-tracker-gitlab.md) — GitLab incoming-request tracker
- [issue-tracker-local.md](./issue-tracker-local.md) — central local Markdown specs and tickets
- [triage-labels.md](./triage-labels.md) — label mapping (only if `triage` is installed)
- [domain.md](./domain.md) — domain doc consumer rules + layout

For "other" issue trackers, write `docs/agents/issue-tracker.md` from scratch using the user's description.

### 5. Done

Tell the user the setup is complete and which engineering skills will read these files. Remind them that the central spec store does not move when the incoming-request tracker changes. They can edit `docs/agents/*.md` later; rerun setup only to switch the incoming-request tracker or restart its configuration.
