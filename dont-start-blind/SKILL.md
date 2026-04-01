---
name: dont-start-blind
description: Bootstrap working context before execution-heavy work. Use when the user is resuming a thread, switching into a repo/project, starting implementation, asking to continue work, or using phrases like "work on X", "resume", "continue", "we need to build", "do this", "implement this", or explicit `task:` framing.
---

# Dont Start Blind

Produce a short Lucy-style working brief before charging into execution.

Use the context sources and tools already available. Do not couple yourself to one storage backend or pretend a source must be queried in one specific way. The job is orientation, not plumbing worship.

## When to do a full bootstrap

Do a full bootstrap when the user is clearly entering work mode:
- resuming or continuing a prior thread
- switching into a repo, branch, project, ticket, or PRD
- asking to implement, build, fix, review, or research in a concrete codebase
- giving an explicit `task:` or other execution-scoped instruction

For phrasing and examples, read [references/trigger-patterns.md](references/trigger-patterns.md).

## Bootstrap workflow

1. Infer the likely thread from the user message, current repo/cwd, and any explicit task, branch, ticket, or project names.
2. Check context sources in priority order:
   - **Trajectory first** — active tasks (`pitodo list`), current branch, git state, recent commits. This is the primary signal for resumed work.
   - **Knowledge when anchored** — search the knowledge graph only when the thread ties to a known project or domain. Don't search speculatively.
   - **Experience is ambient** — behavioral context (preferences, patterns, dispositions) is generally already loaded by the system, not fetched by this skill. Don't scan memory or journal files. Exception: when entering a thread where a known behavioral preference directly changes the next move (e.g., a preferred approach to risky refactors), it's fair to surface it — but the default is ambient, not fetched.
   - **Reflective artifacts stay out** — journal, narrative, and other reflective outputs are never retrieved here.
3. Compress the useful context into a short working brief.
4. Look for ambiguity, conflict, or missing pieces.
5. If the context is fuzzy, stop and ask.
6. If the context is coherent enough, say so and proceed.

## What to gather

Gather only what is likely to change the next move. Do not gather relationship context, reflective history, or behavioral dispositions — those are ambient, not orientational.
- likely thread / repo / project
- active work, tasks, or commitments in flight
- recent decisions, pauses, blockers, or accepted tradeoffs
- durable constraints or patterns relevant to the thread
- obvious risks, contradictions, or stale assumptions
- what is still missing before safe execution

Do not dump every remembered fact just because you can. That is hoarding with extra steps.

## Working brief format

Keep it short, operational, and in Lucy tone.

Use a shape like:
- **Thread:** what this most likely is
- **In flight:** active task / branch / momentum
- **Relevant baggage:** prior decisions, constraints, or continuity worth loading
- **Watch out:** risks, conflicts, stale assumptions, or hidden tradeoffs
- **Missing:** what you still need clarified, if anything
- **Next:** ask or proceed

If the context is thin, say that plainly.
If two possible threads are competing, surface the conflict explicitly.

## When to stop and ask

Stop and ask before acting when:
- two plausible contexts conflict
- the repo/project inference is weak
- retrieved context disagrees in a meaningful way
- active task state and user framing do not line up
- a missing branch, ticket, or target changes the likely plan

Ask the smallest clarifying question that unlocks safe work.

## When to proceed

If the working brief is coherent and no major conflict remains, proceed into the task.
Do not linger in ceremony. The brief exists to improve action, not replace it.

## Boundaries

This skill does not:
- create a new memory system
- require a specific retrieval backend
- scan or retrieve experience/memory files (that's the activation layer's job, not orientation)
- replace planning, implementation, review, or research skills
- force a giant summary when a tiny orientation pass is enough

This skill does:
- make prior context actually enter the room before execution
- surface missing or conflicting context early
- reduce blind restarts and fake amnesia
