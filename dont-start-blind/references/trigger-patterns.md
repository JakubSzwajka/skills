# Trigger Patterns for `dont-start-blind`

Use this file when deciding whether the user is asking to start work, resume a thread, or switch context into a repo/project.

## Strong trigger clusters

### 1. Explicit task framing
These almost always mean: orient first, then work.

Examples:
- `task: create the tracer module for ccc`
- `task: research topic: ai agent sandboxes`
- `there is this task: task #...`

### 2. Repo or project anchoring
These usually mean the thread is tied to a repo, branch, or known project and prior context likely matters.

Examples:
- `work on snapcap`
- `i want to work on this monitor`
- `review this repo`
- `yo! this is my blog`
- `you familiar with this repo?`

### 3. Resume / continuation language
These imply continuity matters more than usual.

Examples:
- `continue`
- `resume`
- `pick up and implement those tests`
- `back to message`

### 4. Execution-intent language
These often mean the user wants implementation, planning, or direct action rather than pure discussion.

Examples:
- `we need to ...`
- `let's ...`
- `do this`
- `implement this`
- `build ...`
- `fix ...`
- `review ...`

## Context signals beyond phrase text
Do not rely on wording alone. Also use:

- current `cwd` / repo name
- explicit project names in the user message
- task IDs, PRD references, ticket references, branch names
- whether the conversation sounds like continuation rather than first contact
- whether the request implies risk, dependency, or unfinished prior work

## Weak or ambiguous cases
Do a lighter bootstrap when the request is vague or exploratory.

Examples:
- `yo`
- `quick question`
- `what do you think about X?`
- `how does this work?`

In those cases, only force a full working brief if the thread clearly locks onto a repo, task, or execution path.

## Practical rule
If the user sounds like they are about to spend real effort in a thread, do not start blind.
