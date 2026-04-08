---
name: research-deep
description: >
  Two-phase adversarial research skill. Phase 1: parallel subagents explore a concept from
  every angle (state of art, failures, adjacent fields, technical deep-dive, gaps). Phase 2:
  parallel subagents challenge, contradict, and stress-test Phase 1 findings, then synthesize
  into a final opinionated proposal with full narrative. Outputs to ./docs/research/<topic>/.
  Triggers on: "/research-deep", "research deep", "adversarial research", "research X from
  every angle", "deep dive research on X".
---

# Deep Adversarial Research

Two-phase research: explore wide, then stress-test everything you found.

## Input

`$ARGUMENTS` contains the research topic or concept. Examples:
- "local-first sync engines"
- "AI code review tools — what exists, what sucks, what's next"
- "event sourcing in production — real patterns not blog posts"

## Setup

Create the output directory:
```
./docs/research/<topic-slug>/
```

Use a kebab-case slug derived from the topic (e.g., `local-first-sync`).

## Phase 1: Explore

Launch **5 parallel subagents**. Each subagent gets a distinct research lens and writes its findings to a separate file.

Every subagent should use all available tools — `Read`, `Bash`, web search, knowledge graph, local docs, codebase exploration. Go wide. Go deep. Leave no stone unturned.

### Subagent 1: State of the Art
- **File**: `01-state-of-art.md`
- **Mission**: What exists today? Who's leading? What's considered the gold standard and why? What are the dominant architectures, frameworks, and implementations? Include real project names, repos, companies. Concrete, not hand-wavy.

### Subagent 2: Failure Archaeology
- **File**: `02-failures.md`
- **Mission**: What's been tried and failed? What projects died and why? What are the common pitfalls, anti-patterns, and graveyard lessons? Look for post-mortems, abandoned repos, critical blog posts, and "why I stopped using X" stories. The failures teach more than the successes.

### Subagent 3: Adjacent Innovation
- **File**: `03-adjacent.md`
- **Mission**: What ideas from neighboring domains could cross-pollinate? What patterns from different industries, different tech stacks, or different problem spaces solve similar underlying challenges? Think laterally. The best ideas are often stolen from somewhere unexpected.

### Subagent 4: Technical Deep-Dive
- **File**: `04-technical.md`
- **Mission**: Architecture patterns, implementation details, performance characteristics, scaling properties, tradeoff matrices. How do the best implementations actually work under the hood? What are the hard engineering problems and how do people solve them? Be specific — algorithms, data structures, protocols, not vibes.

### Subagent 5: Gaps & Contrarian Takes
- **File**: `05-gaps.md`
- **Mission**: What's missing from everything that exists? What assumptions does everyone make that might be wrong? What has nobody tried yet? What would a contrarian build? This is the "what if everyone is wrong about X" agent. Be bold.

### Subagent System Prompt (use for all 5)

```
You are a research agent. Your job is to deeply investigate a specific angle of a topic and produce a thorough, opinionated research document.

Rules:
- Use every tool available: web search, file reading, bash, knowledge search
- Be concrete: name real projects, link real repos, cite real examples
- Be opinionated: don't just list things, evaluate them
- Structure your output as markdown with clear sections
- Write 500-1500 words — thorough but not padded
- End with a "Key Takeaways" section: 3-5 bullet points of the most important insights
```

### Subagent Task Format

Each subagent task should be:
```
Research topic: <full topic from $ARGUMENTS>

Your angle: <lens name>
Your mission: <mission description from above>

Write your findings as markdown. Be thorough, concrete, and opinionated.
```

### Phase 1 Synthesis

After all 5 subagents complete, read their output files and write two documents:

**`06-round1-synthesis.md`** — A narrative synthesis that weaves together all five angles:
- What patterns cut across the best implementations?
- Where do the different angles agree or conflict?
- What's the shape of the opportunity space?

**`07-round1-proposal.md`** — An opinionated, creative proposal:
- Not a safe composite. Not a "best of" list.
- A concrete vision for how to build/approach this thing
- Takes the best ideas further than anyone has
- Names specific architectural choices, tradeoffs accepted, and bets being made
- Includes a section on "What we're deliberately NOT doing and why"

## Phase 2: Challenge

Spawn **4 parallel subagents**. Each reads the Round 1 proposal and all Round 1 findings, then attacks from a different angle. Use the same tools-everything approach.

### Challenger 1: Contradiction Hunter
- **File**: `08-contradictions.md`
- **Mission**: Find evidence that directly contradicts our Round 1 assumptions or conclusions. Search for counter-examples, failed implementations of our proposed approach, or research that invalidates our reasoning. The goal is to break the proposal.

### Challenger 2: Superior Alternatives
- **File**: `09-alternatives.md`
- **Mission**: Find implementations or approaches that outperform what we proposed. Search specifically for things we missed that are better than our favorites. Compare directly against Round 1 findings — what's better, what's worse, and why?

### Challenger 3: Blind Spot Scanner
- **File**: `10-blindspots.md`
- **Mission**: Identify problems we didn't even know existed. Edge cases, scaling cliffs, security concerns, operational nightmares, user experience failures, ecosystem risks. What will bite us that we haven't thought about?

### Challenger 4: Devil's Advocate
- **File**: `11-devils-advocate.md`
- **Mission**: Argue the strongest possible case AGAINST our proposal. If someone wanted to convince a team NOT to pursue this approach, what would they say? What's the best alternative path and why might it win? Be genuinely adversarial, not a strawman.

### Challenger System Prompt (use for all 4)

```
You are an adversarial research agent. You've been given a proposal and initial research findings. Your job is to challenge, stress-test, and try to break the proposal from your assigned angle.

Rules:
- Use every tool available: web search, file reading, bash, knowledge search
- Read ALL the Round 1 files carefully before starting your challenge
- Be specific: point to exact claims in the proposal and counter them with evidence
- Don't be a strawman — make the strongest possible counter-arguments
- Structure your output as markdown with clear sections
- Write 500-1500 words
- End with a "Verdict" section: does the proposal survive your challenge? What must change?
```

### Challenger Task Format

Each challenger task should include the full content of `07-round1-proposal.md` and references to all Round 1 finding files:
```
## Research Topic: <topic>

## Round 1 Proposal:
<contents of 07-round1-proposal.md>

## Round 1 Findings:
Read these files for full context:
- ./docs/research/<slug>/01-state-of-art.md
- ./docs/research/<slug>/02-failures.md
- ./docs/research/<slug>/03-adjacent.md
- ./docs/research/<slug>/04-technical.md
- ./docs/research/<slug>/05-gaps.md
- ./docs/research/<slug>/06-round1-synthesis.md

Your angle: <challenger lens>
Your mission: <mission description>

Challenge the proposal. Be rigorous and adversarial.
```

## Phase 2 Synthesis: The Final Narrative

After all challengers complete, read everything — all 11 documents — and write the final outputs:

**`12-challenge-synthesis.md`** — Narrative of what survived and what didn't:
- For each major claim in the Round 1 proposal, tell the story: what was proposed, how it was challenged, whether it survived, and what changed
- Be honest about what broke under scrutiny
- Highlight where challengers found genuinely better alternatives
- Note where the proposal held strong despite attacks

**`13-final-proposal.md`** — The refined, battle-tested proposal:
- Update ONLY where the challenges genuinely improved things
- For each change, explain what changed and why (inline, not in a separate section)
- Mark what survived unchanged with confidence
- Keep the opinionated, creative spirit — don't let the challenges water it down into committee-think
- Include a "Confidence Map" section at the end rating each major bet as 🟢 (high confidence, survived challenges), 🟡 (medium, modified by challenges), or 🔴 (low, still uncertain despite research)

**`README.md`** — A one-page index of all files in the research folder with one-line descriptions, reading order, and a 3-sentence executive summary of the final proposal.

## Output Summary

When complete, print a summary:
```
## Research Complete: <topic>

📁 ./docs/research/<slug>/

### Round 1 — Exploration
- 01-state-of-art.md
- 02-failures.md
- 03-adjacent.md
- 04-technical.md
- 05-gaps.md
- 06-round1-synthesis.md
- 07-round1-proposal.md

### Round 2 — Challenge
- 08-contradictions.md
- 09-alternatives.md
- 10-blindspots.md
- 11-devils-advocate.md
- 12-challenge-synthesis.md
- 13-final-proposal.md

📖 README.md — start here

<3-5 sentence summary of the final proposal and key bets>
```
