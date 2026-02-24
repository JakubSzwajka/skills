---
name: smart-prd
description: Create and manage lightweight Product Requirement Documents (PRDs) for capturing change ideas. Use when the user wants to write a PRD, describe a change they want to make later, capture a feature idea, or says things like "let's make a PRD for this", "I want to document this change", "create a prd". Also use when the user wants to break a PRD into user stories or update PRD status.
---

# PRD Skill

## Philosophy

PRDs are **quick-capture documents for change ideas**. You're mid-flow, you spot something that needs doing, you sketch it — problem, solution shape, key cases — and move on. Later you come back, break it into user stories, and implement.

A PRD is NOT an ADR. ADRs record *decisions* (why X over Y). PRDs describe *changes to build* (what and why). A PRD might reference ADRs when the change requires architectural decisions.

Key constraints:
- The master `README.md` must stay under **250 lines** (hard cap: 300)
- Each PRD is a **directory** — stories get added as sibling files later
- Status tracks the lifecycle: `draft → proposed → accepted → in-progress → done`
- Keep it sketchable in 5 minutes — this is idea capture, not a spec

## Creating a PRD

### Phase 1: Quick Interview (2-4 questions)

Don't over-interview. Ask just enough to fill the template:

1. **What's the problem?** — What's broken, missing, or suboptimal?
2. **What's the rough solution?** — High-level shape, not implementation details.
3. **What are the key cases?** — Main scenarios to handle. 3-6 bullets.
4. **What's out of scope?** — Prevent future scope creep.

If the user already described all this, skip straight to drafting.

### Phase 2: Draft

1. **Choose a slug.** Derive from the problem description. Use kebab-case (`email-notifications`, `booking-refunds`).

2. **Create the PRD directory and README.md.** Preferred: run the init script from the target repo root:

```bash
bash ~/.agents/skills/smart-prd/scripts/init_prd.sh <slug>
```

This creates `docs/prds/<slug>/README.md` from the template. Use `--dir` to override the PRD directory location.

If you can't run the script, create the directory manually and copy from `assets/templates/prd-readme.md`.

3. **Fill in the template.** Use the confirmed answers from Phase 1. Every section should have real content or be removed. Keep the README under 250 lines.

4. **Set status to `draft`.** The author can promote it later.

### Phase 3: GitHub Issue (Optional)

After creating the PRD file, check if the repo has GitHub issues enabled:

```bash
gh issue list --limit 1 2>/dev/null
```

If it works, create an issue:

```bash
gh issue create --title "PRD: <title>" --body "$(cat docs/prds/<slug>/README.md)"
```

Then update the PRD's `gh-issue` frontmatter field with the issue URL. This bidirectional link lets agents find the discussion context.

If `gh` fails or the repo doesn't support issues, skip this step silently.

## Breaking into User Stories

When the user returns to a PRD to deep-dive, help them break it into story files in the same directory:

```
docs/prds/email-notifications/
  README.md              ← master PRD
  01-send-on-confirm.md  ← user story
  02-retry-failures.md   ← user story
  03-unsubscribe.md      ← user story
```

Each story file should contain:
- **Title** — short imperative description
- **User story** — "As a [role], I want [X], so that [Y]"
- **Acceptance criteria** — checkboxes an agent can verify
- **Notes** — implementation hints, edge cases, related ADRs

Keep each story file under 80 lines. Update the master README's status to `accepted` once stories are defined.

## Updating Status

Update the `status` field in the README.md frontmatter:

| Status | Meaning |
|---|---|
| `draft` | Idea captured, not yet reviewed |
| `proposed` | Ready for review/discussion |
| `accepted` | Approved, ready to break into stories or implement |
| `in-progress` | Implementation underway |
| `done` | All stories implemented and verified |

## Consulting PRDs

Before implementing features, check `docs/prds/` for existing PRDs:

1. Scan directory names for relevance
2. Read the README.md of matching PRDs
3. Check status — only `accepted` or `in-progress` PRDs are active
4. Follow the stories if they exist; ask the user if they don't

## Resources

### scripts/
- `scripts/init_prd.sh` — create a new PRD directory with README.md from the template. Run from target repo root.

### assets/
- `assets/templates/prd-readme.md` — master PRD template with frontmatter, sections, and placeholders.
