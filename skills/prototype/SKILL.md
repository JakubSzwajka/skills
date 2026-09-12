---
name: prototype
description: Build a throwaway prototype to answer one design question and keep its artifact and verdict under the selected central spec.
---

# Prototype

A prototype is throwaway code that answers one question. Its record belongs under `~/.pi/specs/<YYYY-MM-DD>_<feature-slug>/prototypes/`. If no central spec exists, run `/to-spec` first. Create `prototypes/` only when the first prototype is written.

## Pick the branch

- For "Does this logic or state model feel right?", follow [LOGIC.md](LOGIC.md). Build one shareable HTML file with free-play controls and guided walkthroughs for hard cases.
- For "What should this look like?", follow [UI.md](UI.md). Build distinct UI variants on one route, selected with a URL parameter and a floating switcher.

If the question is ambiguous and the user is unavailable, pick the branch that matches the surrounding work and state the assumption in the prototype record.

## Storage rule

1. Store a standalone artifact and its verdict under the selected spec's `prototypes/` directory whenever it can run there.
2. If runnable code must follow a repository's module, route, build, or dependency conventions, keep the code in that repository. Write a central Markdown record under `prototypes/` with the question, exact repository path, run command, result, and verdict.
3. A delegate child may own that one exact central artifact or record path. Give it a self-contained brief. Do not ask it to inspect the whole central spec.
4. Do not publish the prototype or verdict to an issue tracker.

## Rules

1. Mark prototype code as throwaway. Keep repository-hosted code near the module or page it tests and use the project's routing conventions.
2. Make it start with one command. A standalone logic demo should open as one HTML file.
3. Keep state in memory unless persistence is the question. Use an unmistakable scratch database or file when persistence is required.
4. Skip production polish, broad abstractions, and tests that do not help answer the question.
5. Show the relevant state after each logic action or UI variant change.
6. Record one clear verdict. Fold validated decisions into the real implementation, but keep the prototype record as the primary source for what was tested and learned.

The master may append a material verdict or rejected alternative to the spec log. Do not log every prototype interaction, generated file, or run.
