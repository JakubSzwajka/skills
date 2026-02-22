# Output & Workflow Patterns for Skills

## Sequential Workflows

Break complex tasks into clear steps with an overview:

```markdown
Processing a PDF involves these steps:
1. Analyze the form (run analyze_form.py)
2. Create field mapping (edit fields.json)
3. Fill the form (run fill_form.py)
```

## Conditional Workflows

Guide through decision points:

```markdown
1. Determine the modification type:
   **Creating new content?** → Follow "Creation workflow"
   **Editing existing content?** → Follow "Editing workflow"
```

## Template Pattern

**Strict** (API responses, data formats): "ALWAYS use this exact template structure"
**Flexible** (adaptable outputs): "Here is a sensible default, adjust as needed"

## Examples Pattern

For output quality that depends on seeing examples, provide input/output pairs:

```markdown
**Example 1:**
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication
```

Examples help Claude understand desired style better than descriptions alone.
