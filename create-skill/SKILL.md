---
name: create-skill
description: Guide for creating new Claude Code skills or updating existing ones. Use when the user wants to create a skill, build a skill, make a new skill, update a skill, or asks about skill creation. Leads the user through a Socratic discovery process, then generates a properly structured skill package. Skills are always created at ~/.agents/skills/.
---

# Create Skill

Create high-quality Claude Code skills through guided discovery and structured generation.

All skills are created at `~/.agents/skills/`. For design principles and anatomy, read [references/skill-design-guide.md](references/skill-design-guide.md). For output and workflow patterns, read [references/output-patterns.md](references/output-patterns.md).

## Workflow

1. **Discover** — understand what the skill should do (Socratic questioning)
2. **Plan** — identify reusable resources (scripts, references, assets)
3. **Initialize** — scaffold with `scripts/init_skill.py`
4. **Implement** — write SKILL.md and bundled resources
5. **Package** — validate and bundle with `scripts/package_skill.py`
6. **Iterate** — refine based on real usage

## Step 1: Discover

Use Socratic questioning to understand the skill before building it. Ask 2-3 questions at a time, not a wall of questions. Cover these areas across the conversation:

**Purpose**: "What problem does this skill solve? Can you describe a concrete scenario where you'd use it?"

**Trigger**: "What would you say to Claude that should activate this skill? Give me a few example phrases."

**Scope**: "What should this skill do vs. NOT do? Where does it stop and other tools take over?"

**Variation**: "Are there different modes or branches? For example, does it handle creation differently from updates?"

**Output**: "What does the end result look like? Can you show me an example of good output?"

Conclude this step when you can articulate: what the skill does, when it triggers, what it produces, and what it delegates.

## Step 2: Plan Resources

For each concrete example from Step 1, analyze:
1. What would I do to execute this from scratch?
2. What gets rewritten every time? → candidate for `scripts/`
3. What domain knowledge is needed? → candidate for `references/`
4. What files are used in output? → candidate for `assets/`

Present the proposed structure to the user:
```
skill-name/
├── SKILL.md
├── scripts/       (if any)
├── references/    (if any)
└── assets/        (if any)
```

Get user confirmation before proceeding.

## Step 3: Initialize

Run the init script to scaffold the skill:

```bash
~/.agents/skills/create-skill/scripts/init_skill.py <skill-name> --path ~/.agents/skills
```

This creates the directory with SKILL.md template and example resource dirs.

**Scripts source**: The bundled `init_skill.py`, `package_skill.py`, and `quick_validate.py` were sourced from https://github.com/anthropics/skills/tree/main/skills/skill-creator/scripts — check for updates if packaging fails unexpectedly.

## Step 4: Implement

### Write resources first
Implement scripts, references, and assets identified in Step 2. Test scripts by running them. Delete any example files/dirs not needed.

### Write SKILL.md

**Frontmatter:**
- `name`: the skill name
- `description`: what it does AND when to trigger it — this is the primary activation mechanism. All trigger info goes here, not in the body.

**Body:**
- Use imperative form
- Keep under 500 lines, under 30 lines per section when possible
- Reference bundled resources with relative links and describe when to read them
- Choose a structure pattern: workflow-based, task-based, reference/guidelines, or capabilities-based

**Quality checklist before moving on:**
- [ ] Description includes both WHAT and WHEN
- [ ] Body adds only knowledge Claude doesn't already have
- [ ] Each paragraph justifies its token cost
- [ ] Resources are referenced from SKILL.md with clear "when to read" guidance
- [ ] No duplicate info between SKILL.md and reference files
- [ ] No auxiliary docs (no README.md, CHANGELOG.md, etc.)

## Step 5: Package

Validate and package the skill. Requires `pyyaml` — use a venv if needed:

```bash
cd ~/.agents/skills/create-skill/scripts && python3 package_skill.py ~/.agents/skills/<skill-name>
```

If validation fails, fix errors and re-run. The output is a `.skill` file (zip with .skill extension).

## Step 6: Iterate

After testing the skill on real tasks:
1. Notice what struggles or feels inefficient
2. Identify which part of SKILL.md or resources needs updating
3. Implement changes
4. Re-package
