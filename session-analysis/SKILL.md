---
name: session-analysis
description: >
  Analyze Claude Code session history to answer user questions about patterns, decisions,
  knowledge gaps, progress, or any custom research angle. Use when the user wants to
  analyze their coding sessions, discover cross-session patterns, audit decisions, or
  generate insights from conversation history. Triggers on: "analyze sessions",
  "session analysis", "session insights", "what patterns", "audit my sessions".
user-invocable: true
disable-model-invocation: true
argument-hint: ["question to analyze"]
---

# Session Analysis Skill

Analyze Claude Code session history through a custom analytical lens provided by the user.

## Invocation

```
/_session-analysis What architectural decisions were made and are they consistent?
/_session-analysis --scope=user --days=30 What knowledge gaps keep recurring?
/_session-analysis --scope=project --days=14 --max-sessions=30 What was actually shipped vs just discussed?
```

## Arguments

- First positional argument (or everything after flags): the **analysis question**
- `--scope=project|user` — project-level (default) or cross-project analysis
- `--days=N` — how far back to look (default: 7)
- `--max-sessions=N` — cap on sessions to analyze (default: 20)
- `--min-messages=N` — skip sessions with fewer messages (default: 4)

## Pipeline

### Step 1: Extract session data

Run the extraction script to get filtered session content:

```bash
node ~/.agents/skills/_session-analysis/scripts/extract-sessions.js \
  --scope=<scope> --days=<days> --max-sessions=<max> --min-messages=<min> \
  --project-path=<cwd>
```

Parse the JSON output. Report to the user:
- Scope, timeframe, number of sessions found/included
- Brief list of session summaries with dates

If zero sessions found, inform the user and suggest adjusting filters.

### Step 2: Parallel facet extraction (Sonnet agents)

For each session, spawn an Agent (run in background) with this prompt template:

```
You are extracting structured facets from a Claude Code session for cross-session analysis.

ANALYSIS QUESTION: <the user's question>

SESSION METADATA:
- Project: <projectPath>
- Date: <created> to <modified>
- Branch: <gitBranch>
- Messages: <messageCount>
- Summary: <summary>

SESSION CONVERSATION:
<messages formatted as "**user:** text" / "**assistant:** text">

---

Extract structured facets relevant to the analysis question. Output ONLY this JSON structure:

{
  "session_id": "<sessionId>",
  "date": "<created date>",
  "project": "<projectPath>",
  "relevance": "high|medium|low|none",
  "key_topics": ["topic1", "topic2"],
  "relevant_observations": [
    "Observation directly relevant to the analysis question"
  ],
  "decisions_made": ["Decision or choice that was made"],
  "actions_taken": ["Concrete action or change"],
  "notable_quotes": ["Brief verbatim quote if particularly relevant"],
  "friction_points": ["Any difficulties or blockers encountered"],
  "metadata": {
    "files_discussed": ["file paths mentioned"],
    "tools_used_heavily": ["tool names"],
    "branch": "<gitBranch>"
  }
}

Rules:
- If the session has NO relevance to the analysis question, set relevance to "none" and leave arrays empty
- Keep observations concise (1 sentence each)
- Extract raw material, not conclusions — do not synthesize
- Max 5 items per array
- Output valid JSON only, nothing else
```

IMPORTANT:
- Use `subagent_type: "general-purpose"` for each agent
- Launch ALL agents in parallel (single message with multiple Agent tool calls)
- Batch into groups of 5 if more than 10 sessions to avoid overwhelming
- Each agent prompt must include the full session conversation content

### Step 3: Collect and filter facets

Once all agents complete:
- Parse each agent's JSON output
- Discard sessions with `relevance: "none"`
- Sort remaining by relevance (high > medium > low) then by date (newest first)

### Step 4: Synthesis (Opus — this happens in YOUR context)

With all facets collected, perform the synthesis yourself. You ARE Opus. This is where cross-session reasoning happens.

Analyze ALL facets together and produce a structured report addressing the user's question:

```markdown
# Session Analysis Report

**Question:** <the user's question>
**Scope:** <scope> | **Period:** <days> days | **Sessions analyzed:** N

## Key Findings

<3-5 major findings that answer the question, with evidence from specific sessions>

## Cross-Session Patterns

<Patterns that emerge only when looking across multiple sessions — recurring themes,
contradictions, evolution over time, escalating issues>

## Timeline

<Chronological view of how things evolved, if relevant to the question>

## Notable Details

<Specific observations, quotes, or data points worth highlighting>

## Recommendations

<Actionable suggestions based on the analysis, if applicable>
```

Rules for synthesis:
- Ground every finding in specific session evidence
- Identify contradictions and evolution, not just commonalities
- Be direct and opinionated — this is analysis, not summarization
- If the data doesn't support strong conclusions, say so honestly
- Keep the report concise — quality over quantity

### Step 5: Present to user

Output the report directly in conversation as markdown.
Do NOT save to a file unless the user explicitly asks.

## Error Handling

- If extraction script fails: check that `~/.claude/projects/` exists and has session data
- If too few sessions match: suggest relaxing filters (more days, lower min-messages)
- If agents fail to return valid JSON: extract what you can, note the gap
- If no sessions are relevant to the question: report that finding honestly

## Constraints

- NEVER modify any session files
- NEVER expose raw session content to the user (only extracted facets and synthesis)
- Skip sessions that appear to be sub-agent or sidechain sessions
- Respect the max-sessions cap strictly — better to analyze fewer sessions deeply than many superficially
