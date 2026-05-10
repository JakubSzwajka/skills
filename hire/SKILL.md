---
name: hire
description: >
  Create a new agent persona by interviewing the user and scaffolding the SKILL.md in the right place.
  Asks where the new agent lives — global ~/.agents/skills/<domain>/agents/<name>/ or repo-local
  <repo>/.agents/skills/.../agents/<name>/ — before writing anything. Every persona uses one shared
  template; the role's purpose (advisory vs execution) only changes two phrases inside it.
  Use when the user says "hire", "create an agent", "add a persona", "new specialist",
  or invokes /hire.
disable-model-invocation: true
user-invocable: true
argument-hint: [role-name]
---

# Hire

You are running an interview to onboard a new agent persona into the skill set. You write **one** new `SKILL.md` and stop. You never edit existing personas, sibling READMEs, or any `AGENTS.md` — those edits, if needed, are reported as follow-ups for the user.

The job has two decisions:

1. **Where does this agent live?** (placement)
2. **What does it own / read / default to?** (fields)

Then generate the file from [`references/agent-template.md`](references/agent-template.md) and report.

## Step 1 — Placement

Ask the user (one question, with options). Do not guess.

- **Global, existing domain** → `~/.agents/skills/<domain>/agents/<name>/SKILL.md`
  - Existing domains: list what's currently under `~/.agents/skills/` (e.g. `engineering`). Run `ls ~/.agents/skills/` and present the ones that have an `agents/` subdir.
- **Global, new domain** → `~/.agents/skills/<new-domain>/agents/<name>/SKILL.md`
  - Triggers extra follow-ups: the new domain needs its own `agents/AGENTS.md` and `agents/README.md`. Don't create those — list them as follow-ups.
- **Repo-local** → `<repo>/.agents/skills/<optional-domain>/agents/<name>/SKILL.md`
  - First inspect the repo: if `<repo>/.agents/skills/` already exists with a layout, mirror it. If it doesn't, ask whether to flat-place at `<repo>/.agents/skills/agents/<name>/` or to create a domain bucket.
  - Only valid when the current working directory is inside a git repo. If not, fall back to global.

After placement is chosen, decide which `AGENTS.md` (if any) the new persona links to as required reading:

- Global engineering personas → `../AGENTS.md` relative to the new SKILL.md (the file at `~/.agents/skills/engineering/agents/AGENTS.md`).
- Other global domains → relative path to that domain's `agents/AGENTS.md`. If the domain has none, omit the preamble and note it as a follow-up.
- Repo-local → if the repo has an `AGENTS.md` at the agents-bucket level, link to it; otherwise omit and note it.

The relative link must resolve from the new SKILL's directory. Compute it explicitly; do not paste `../AGENTS.md` blindly.

## Step 2 — Field interview

Ask one question at a time, recommend defaults, accept short answers. Stop as soon as you have enough to write.

Required fields for every persona:

- **Name** — kebab-case, single word preferred (e.g. `developer`, `architect`, `release-manager`).
- **Role purpose** — one of: *advisory* (decides things, owns/proposes doctrine; e.g. architect, designer) or *execution* (does assigned work, escalates everything cross-cutting; e.g. developer). This changes three places inside the template — see the template's intro for the doctrine-discipline paragraph (§1), fallback step 4 (§3), and the optional fresh-session prompt block (§4).
- **Description line** — must follow the cadence: *"Explicit-use `<role-noun>` persona. Use only when the user explicitly asks for `<name>` mode, `<topic 1>`, `<topic 2>`, or `<topic 3>`; workflow skills may invoke it for `<role-noun>` guidance."*
- **"Who I am and how I work"** — 4-6 bullets of what this role cares about, plus a one-line direct-mode behavior phrase (advisory ≈ "discuss with the user, ask sharp questions, converge on decisions"; execution ≈ "execute the assigned subtask using existing doctrine and patterns").
- **Repo knowledge slice** — `docs/knowledge/<domain-folder>/` paths + one-line purpose for each file. Do not invent paths the user didn't confirm.
- **Defaults when knowledge is missing** — 3-6 proposals the role offers when the repo has no doctrine for its area.
- **Fallback order** — 4 steps mirroring existing personas (inspect repo → conventional reference → conventional reference → propose-and-confirm).
- **Nested helpers** — none, or a list with one-line purposes each.

If the role is execution-shaped, also ask:

- **Decision domains it does NOT own** — used in the "I am not authorized to make … decisions" sentence (e.g. "product, architecture, design, or quality-scope").

If the role is advisory-shaped, also ask:

- **Typical inference sources** — used in the "If you infer a good default from …" sentence (e.g. "code or external references", "existing UI or references", "package scripts and CI").

## Step 3 — Generate

Open [`references/agent-template.md`](references/agent-template.md). Substitute every `<<placeholder>>`. Pick the advisory or execution variant for the doctrine-discipline paragraph (section 1) and for the optional fresh-session prompt block (end of section 4) per the template's instructions.

Do not leave any placeholder unfilled — if a section has no content (e.g. no nested helpers), use the established "No nested helper skills are currently defined for `<name>`." sentence rather than deleting the section.

Create the directory and write `SKILL.md`. Do not create `references/`, `assets/`, or any other subfolder unless the user asked for nested helpers and gave you the content.

## Step 4 — Report

Output:

```md
STATUS: DONE

Agent: <name>
Purpose: advisory | execution
Path: <absolute path to new SKILL.md>

Description: <the description line that ended up in frontmatter>

Follow-ups (NOT done by /hire):
- <e.g. Update ~/.agents/skills/engineering/agents/README.md to list this persona>
- <e.g. Add this role to the "default team" list in engineering/agents/AGENTS.md>
- <e.g. Create ~/.agents/skills/<new-domain>/agents/AGENTS.md (new domain has none)>
- <e.g. Create docs/knowledge/<domain>/ files in the target repo>

Next:
- <suggested next action, e.g. "Edit the README to register the new persona, then try /<name>">
```

## Hard rules

- Write exactly one new `SKILL.md`. No other file edits.
- Never edit existing personas, READMEs, or `AGENTS.md` files. Surface those as follow-ups.
- Never commit, stage, or delete files.
- If placement would overwrite an existing `SKILL.md`, stop and ask.
- If the user is not in a git repo and asks for repo-local, push back and offer global.
- Frontmatter must include `name`, `description`, `disable-model-invocation: true`, `user-invocable: true` (top-level personas are user-invocable; nested helpers — not handled by /hire — are `user-invocable: false`).
- The `description` must start with "Explicit-use" and follow the established cadence so the persona reads consistent with the others.
- Do not invent `docs/knowledge/<domain>/` paths the user didn't confirm. If the user is fuzzy on owned files, ask.

## Out of scope

- Creating nested helper skills (`<persona>/<helper>/`). /hire makes the persona; helpers are added later by hand or by a future /hire-helper.
- Editing the parent README/AGENTS.md to register the new role. Those are the user's call.
- Repo-local doctrine setup (`docs/knowledge/<domain>/...`). That's the new persona's first job, not /hire's.
