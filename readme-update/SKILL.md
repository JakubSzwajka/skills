---
name: readme-update
description: Scan the codebase for modules affected by recent changes and ensure their README.md files are up to date. Use when the user asks to update readmes, update docs, sync documentation, or after code changes that may have affected module contracts. Triggers on commands like "update readmes", "sync docs", "readme update". Designed to be composed with other skills (e.g. run readme-update then smart-commit).
---

# README Update

Scan changed or specified modules, then create or update their README.md files to reflect the current public API, responsibility boundary, and navigation links.

## Workflow

1. **Identify affected modules**
2. **Analyze each module**
3. **Update or create READMEs**
4. **Verify navigation graph**

## Step 1: Identify Affected Modules

**If the user specifies paths** → use those directly.

**Otherwise, auto-detect from git:**

```bash
git diff --name-only HEAD
git diff --name-only --cached
```

From the changed files, walk up to find the nearest module directory — a directory that exports public API (has `index.ts`, `index.js`, `mod.ts`, `__init__.py`, or a barrel file re-exporting symbols). Also include the parent module if the changed module is a child, since the parent's "Read Next" links may need updating.

Deduplicate the list and present it to the user for confirmation before proceeding.

## Step 2: Analyze Each Module

For each module directory:

1. Read the entry point (index file / barrel file) to identify **public exports**
2. Read existing README.md if present
3. Identify child directories that are themselves modules (have their own entry point)
4. Identify peer/related modules referenced by imports

Determine the module's **level**:
- **Root**: directly under src/ or src/lib/ — focus on organization and layering
- **Mid-tier**: services/, tools/, or has both children and a parent module — focus on orchestration
- **Leaf**: no child modules — focus on API surface

## Step 3: Update or Create READMEs

For the template structure and sizing rules, read [references/readme-template.md](references/readme-template.md).

**When a README exists**: update only the sections that are stale (e.g. Public API changed, new child modules appeared). Preserve any manually-written context the author added.

**When no README exists**: create one from the template, sized to the module's level.

Key rules:
- Under 30 lines when possible
- Public API lists only what callers import, not internal helpers
- Responsibility Boundary must state what the module owns vs. delegates
- Read Next links use relative paths
- Never duplicate child module details — link to the child's README

## Step 4: Verify Navigation Graph

After all READMEs are updated:

1. Check that every Read Next link points to a file that exists
2. Check that parent modules link to child modules and vice versa
3. Report any broken or missing links
