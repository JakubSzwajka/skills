---
name: research
description: Investigate a question against high-trust primary sources and save a cited Markdown artifact under the selected central spec's research directory.
---

# Research

Research for a feature belongs under `~/.pi/specs/<YYYY-MM-DD>_<feature-slug>/research/`.

Before delegation, confirm the mounted or explicitly selected central spec. If none exists, run `/to-spec` first. Choose and verify one exact new Markdown output path under its `research/` directory. Create the directory only for that first artifact.

Read the relevant spec material yourself. Start one read-only worker with the `scout` profile and a self-contained brief:

```
delegate({ action: "start", profile: "scout", brief: "<outcome, exact owned research output path, needed context, citation rules, non-goals, stop conditions, acceptance>", cwd: "<repo>" })
```

Delegate children do not inherit or discover the master's spec mount. Give the worker the question and all needed context. Give it the one exact output path it owns, but do not tell it to inspect the whole central spec.

The worker must:

1. Trace each claim to a primary source such as official documentation, source code, a specification, or a first-party API.
2. Write one cited Markdown artifact at the assigned path.
3. Report material discoveries or scope changes as durable-event candidates in its handoff.

When it rings, read the handoff, verify the research file and citations, then stop the lane. Do not log routine source reads, tool calls, or the mere creation of the file. The master may use `spec_log_append` only when the result contains a durable decision, material discovery, or scope change.
