# Skill Design Guide

Source: https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md

## Core Principles

### Concise is Key
The context window is a shared resource. Only add context Claude doesn't already have. Challenge each piece: "Does this paragraph justify its token cost?" Prefer concise examples over verbose explanations.

### Degrees of Freedom
Match specificity to task fragility:
- **High freedom** (text instructions): multiple approaches valid, context-dependent
- **Medium freedom** (pseudocode/parameterized scripts): preferred pattern exists, some variation ok
- **Low freedom** (specific scripts): fragile operations, consistency critical

### Skill Anatomy

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter: name + description (required)
│   └── Markdown instructions
└── Bundled Resources (optional)
    ├── scripts/       - Executable code (deterministic, reusable)
    ├── references/    - Docs loaded into context as needed
    └── assets/        - Files used in output (templates, images, fonts)
```

### Progressive Disclosure
1. **Metadata** (name + description) — always in context (~100 words)
2. **SKILL.md body** — loaded when skill triggers (<5k words, <500 lines)
3. **Bundled resources** — loaded as needed (unlimited)

## Frontmatter Rules
- `name`: skill name
- `description`: primary trigger mechanism. Include WHAT it does AND WHEN to use it. All trigger info goes here, NOT in the body.
- No other fields needed.

## Body Rules
- Keep under 500 lines
- Use imperative/infinitive form
- Split content into reference files when approaching limit
- Reference split-out files clearly so the reader knows they exist

## What NOT to Include
No README.md, INSTALLATION_GUIDE.md, CHANGELOG.md, or other auxiliary docs. Only files needed for the AI agent to do the job.

## Resource Guidelines

### scripts/
- Include when same code gets rewritten repeatedly or deterministic reliability needed
- Token efficient, may be executed without loading into context

### references/
- For docs Claude should reference while working
- Keeps SKILL.md lean; loaded only when needed
- For files >10k words, include grep patterns in SKILL.md
- Info lives in EITHER SKILL.md or references, not both

### assets/
- Files used in output, not loaded into context
- Templates, images, boilerplate, fonts

## Progressive Disclosure Patterns

### Pattern 1: High-level guide with references
SKILL.md has quick start + links to detailed reference files.

### Pattern 2: Domain-specific organization
Organize by domain/variant — Claude loads only the relevant file.

### Pattern 3: Conditional details
Basic content in SKILL.md, link to advanced content for specific features.

Keep references one level deep. For files >100 lines, include a table of contents.
