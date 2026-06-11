---
name: update-docs
description: Scan changed or specified code modules and update their README.md files to match the current module contract. Use when the user asks to update readmes, sync docs, document recent code changes, or keep module docs aligned with the codebase. Triggers on commands like "update readmes", "sync docs", "readme update", or after changes to module entrypoints, runtime wiring, env config, or module relationships.
---

# README Update

Update code-module READMEs so they act as short, structured module cards for both humans and documentation scanners.

Use [scripts/audit_readmes.py](scripts/audit_readmes.py) after edits to verify required sections and relative links.

## Workflow

1. **Identify affected READMEs**
2. **Analyze the live module contract**
3. **Rewrite only stale sections**
4. **Validate structure and links**

## Step 1: Identify Affected READMEs

**If the user specifies paths**: use those paths and map them to the owning module README.

**Otherwise, auto-detect from git:**

```bash
git diff --name-only HEAD
git diff --name-only --cached
```

Map changed files to README targets using these rules:

1. If `README.md` changed at repo root, include the root README.
2. For code changes, walk up to the nearest module directory and include its `README.md`.
3. Also include the parent module README when child module links or summaries may need updates.
4. If the changed file is an entrypoint or runtime/config file, always include the module README even if no README exists yet.

Treat these as strong README-update signals:
- `src/**/src/index.*`
- `src/**/src/plugin.*`
- `src/**/src/runtime.*`
- `src/**/src/server.*`
- `src/**/package.json`
- config files or modules reading `process.env`
- files that add/remove child modules or change imports between modules

Do not stop for confirmation unless the affected-module set is ambiguous.

## Step 2: Analyze The Live Module Contract

For each target module:

1. Read the entrypoint and identify the public surface that callers actually import.
2. Read startup or activation wiring to determine **when the module is live**.
3. Read config and env-var usage to determine **operational constraints**.
4. Read the existing README and keep any useful author-written context that is still correct.
5. Identify child and peer modules that belong in `Read Next`.

When checking drift, prioritize these questions:
- What activates this module?
- What does it own?
- What does it delegate?
- What config/env/build artifacts does it require?
- What caller-visible API or behavior changed?
- Did parent/child/peer links change?
- **If architecture is defined** (check AGENTS.md, CLAUDE.md, or linked architecture doc): does this module's actual import graph match the stated boundary rules? Has it gained new cross-module dependencies since the last README update?

Do not rely on exports alone. Runtime wiring, env usage, route registration, and plugin mounting rules are part of the module contract.

## Step 3: Update Or Create READMEs

For the template and section rules, read [references/readme-template.md](references/readme-template.md).

The default target is a **short module card**, not a tutorial.

**When a README exists**:
- Update only stale sections
- Preserve correct manual context
- Remove or compress obsolete setup/tutorial prose if it hides the module contract

**When no README exists**:
- Create one from the template
- Keep it compact and link outward instead of duplicating detail

Required for code-module READMEs unless clearly not applicable:
- frontmatter: `title`, `section`, optional `subsection`, optional `order`
- one-sentence summary
- `Activation`
- `Responsibility Boundary`
- `Operational Constraints`
- `Read Next`

Optional when relevant:
- `Public API`
- `Configuration`
- `Use It Like This`
- `Known Limitations`
- `Status`
- `Dependencies` (include when the project has a defined architecture — lists facades called, callers, events published/consumed)

Update policy by change type:
- Public exports changed: update `Public API`
- Boot/mount/wiring changed: update `Activation`
- Env vars or required build outputs changed: update `Configuration` or `Operational Constraints`
- Ownership moved across modules: update `Responsibility Boundary`
- Module graph changed: update `Read Next`
- Experimental/proof/legacy state changed: update `Status`

Hard rules:
- Keep READMEs short; link to deeper docs instead of embedding long guides
- Document what is true now, not what used to be true
- Prefer explicit activation rules over vague setup prose
- Never document private helpers as public API
- Use relative links for repo-local references

## Step 4: Validate Structure And Links

After editing:

1. Check that all required sections are present for each touched code-module README.
2. Check that all relative markdown links in touched READMEs resolve, not just `Read Next`.
3. Check that parent/child navigation is still coherent.
4. Check that README claims still match entrypoints, runtime wiring, and env/config usage.

Run:

```bash
python3 ~/.agents/skills/engineering/docs/update-docs/scripts/audit_readmes.py --root <repo> [README paths...]
```

If a module changed internally but its public contract did not change, leave the README alone and report that no update was needed.
