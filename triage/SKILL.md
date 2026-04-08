---
name: triage
description: >
  Investigate and triage a bug report by exploring the codebase. Use when the user
  says /triage followed by a bug description or pasted ticket content. Produces a
  structured triage report with root cause, data flow, affected files, and severity.
  Does NOT introduce fixes unless explicitly asked.
user-invocable: true
---

# Bug Triage

You are the **orchestrator**. You parse the bug ticket and scope the investigation, then delegate codebase exploration to a subagent with fresh, curated context.

## Input

The user provides a bug description after `/triage`. This can be:
- A pasted ticket (steps to reproduce, actual/expected result, screenshots)
- A short description of the symptom

## Step 1: Parse the Ticket (you do this)

Extract from the user's input:
- **Symptom**: what's wrong (the observable bug)
- **Affected feature**: which part of the product
- **Clues**: error messages, specific values, screenshots, stack traces
- **Likely entry point**: based on the feature, identify the probable starting file/route/endpoint

If the ticket is ambiguous, ask clarifying questions before proceeding.

## Step 2: Launch the Investigator

Launch a single subagent (read-only — bash for grep/find/git only):

```
  model: claude-opus-4  # or openai/gpt-5.4 — always use a strong model
  systemPrompt: |
    You are a bug investigator. You are READ-ONLY — never modify files or
    introduce fixes. Your job is to trace a bug through the codebase and
    produce structured findings.
    
    Use `read` to examine source files. Use `bash` for grep, find, and git
    commands only — never run anything that writes to disk.
  task: |
    ## Bug Investigation

    **Symptom**: <parsed symptom>
    **Affected feature**: <feature area>
    **Clues**: <error messages, values, stack traces>
    **Likely entry point**: <file/route you identified>

    ### Instructions

    1. Start at the likely entry point and trace the code path for the affected feature
    2. Follow the data flow: entry point → business logic → output
    3. Identify where the bug occurs — what goes wrong and why
    4. Find all files involved in this code path
    5. Check if tests exist covering this path
    6. Look for common root causes: timezone issues, missing conversions, wrong field
       references, stale data, race conditions, off-by-one errors

    ### Output Format

    Respond with EXACTLY this structure:

    ### Root Cause
    1-3 sentences explaining what's broken and why.

    ### Data Flow
    ```
    Step A (correct)
      → Step B (correct)
        → Step C (BUG: description of what goes wrong here)
          → Step D (shows wrong result)
    ```

    ### Key Files
    | File | Role |
    |------|------|
    | `path/to/file.py:42-50` | Description of what this file does in the flow |

    ### Impact Assessment
    - **Severity**: critical / high / medium / low
    - **Frequency**: every time / conditional / rare
    - **Scope**: all users / subset / specific scenario
    - **Workaround**: yes (describe) / none known

    ### Fix Direction
    If the fix is obvious (1-2 line change), mention it briefly.
    Otherwise, list open questions that need answering before a fix can be designed.

    ### Test Coverage
    - Existing tests covering this path: <list or "none">
    - Tests that should have caught this: <what's missing>
```

## Step 3: Present the Result

The subagent's output IS the triage report. Present it directly to the user — do not rewrite or summarize it.

## After Triage

Based on the findings, suggest one of:
- Root cause is clear but complex → "This needs a planned fix. Want me to create a PRD for it?"
- Root cause needs deeper understanding → "Want me to research the affected module more deeply?"
- Fix is trivial (1-2 lines) → "This looks like a quick fix — want me to implement it, then run tests?"
