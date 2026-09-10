---
name: research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a scout worker.
---

Before delegation, find and verify the repo's notes directory and choose the exact new
Markdown path. Start one read-only worker for the whole question with the `delegate`
tool and the `scout` profile, so you keep working while it reads:

```
delegate({ action: "start", profile: "scout", brief: "<outcome, owned Markdown path, inputs, non-goals, stop conditions, acceptance>", cwd: "<repo>" })
```

Put the chosen output path and required source citations in the brief. When the worker
rings, call `delegate({ action: "read", lane: "<lane>" })`, verify the research file,
then call `delegate({ action: "stop", lane: "<lane>" })`.

## Task continuity

After the scout writes the research file, if `task_log` is active, add its path with the `task_manage` reference action. Then append a concise structured `handoff` with the conclusion, next action, blockers, branch or worktree, latest commit, validation state, and references. Do not copy the artifact body into the task log. If `task_log` is inactive, skip these calls and continue the skill normally.

Its job:

1. Investigate the question against **primary sources** — official docs, source code, specs, first-party APIs — not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it where the repo already keeps such notes; match the existing convention, and if there is none, put it somewhere sensible and say where.
