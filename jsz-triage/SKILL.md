---
name: jsz-triage
description: >
  Investigate and triage a bug report by exploring the codebase. Use when the user
  says /triage followed by a bug description or pasted ticket content. Produces a
  structured triage report with root cause, data flow, affected files, and severity.
  Does NOT introduce fixes unless explicitly asked.
user-invocable: true
---

# Bug Triage

Investigate a bug report and produce a structured triage report. **Research only — never introduce code changes.**

## Input

The user provides a bug description after `/triage`. This can be:
- A pasted ticket (steps to reproduce, actual/expected result, screenshots)
- A short description of the symptom

## Process

1. **Parse the ticket** — extract the symptom, affected feature, and any clues (screenshots, error messages, specific values).

2. **Delegate research to an Explore agent** — always use the Agent tool with `subagent_type: Explore` and thoroughness "very thorough". The agent prompt should:
   - Identify the code path for the affected feature (entry point → business logic → output)
   - Trace the data flow end-to-end
   - Look for the likely root cause (timezone issues, missing conversions, wrong field references, stale data, race conditions, etc.)
   - Find all files involved in the bug's code path
   - Check if there are tests covering this path

3. **Synthesize the triage report** from the agent's findings using the output format below.

## Output Format

Present the triage as a structured report:

### Root Cause
1-3 sentences explaining what's broken and why.

### Data Flow
Show the chain from input to buggy output. Use a code block with arrows:
```
Step A (correct)
  → Step B (correct)
    → Step C (BUG: description of what goes wrong here)
      → Step D (shows wrong result)
```

### Key Files
Table with file path, line numbers, and role in the bug.

| File | Role |
|------|------|
| `path/to/file.py:42-50` | Description of what this file does in the flow |

### Impact Assessment
- **Severity**: How bad is this? (critical / high / medium / low)
- **Frequency**: How often does it happen? (every time / conditional / rare)
- **Scope**: What's affected? (all users / subset / specific scenario)
- **Workaround**: Is there one?

### Fix Direction
If the fix is obvious (1-2 line change, clear what needs to happen), mention it briefly. Otherwise, list open questions that need answering before a fix can be designed. **Do not implement anything.**

## Constraints

- Never edit files or introduce fixes
- Always delegate codebase exploration to an Explore agent
- If the ticket is ambiguous, ask clarifying questions before researching
- Keep the report concise — no raw logs or agent output dumps
