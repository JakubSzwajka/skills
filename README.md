# .agents

Shared agent configuration for Pi / Claude / Codex.

## Source of truth

- `AGENTS.md` — neutral global core instructions and the symlink target for tools.
- `skills/` — canonical skill repo. Everything reusable lives here: workflows, specialist personas, review/test/planning helpers.

## Rules

- Keep the global core neutral. No ambient Lucy/personality/specialist mode.
- Personas are skills with `disable-model-invocation: true` when supported.
- Workflow skills may be auto-invoked by the agent when their descriptions match.
- Prompt/slash aliases are optional UX sugar only; never duplicate persona/workflow logic there.

## Current wiring

- `~/.pi/APPEND_SYSTEM.md -> ~/.agents/AGENTS.md`
- `~/.claude/CLAUDE.md -> ~/.agents/AGENTS.md`
- `~/.codex/AGENTS.md -> ~/.agents/AGENTS.md`
- `~/.claude/skills -> ~/.agents/skills`

Codex reads user skills directly from `~/.agents/skills`; do not replace
`~/.codex/skills`, which Codex owns for system and installed skills.

Knowledge, experience, and vault content live in `~/knowledge/`.


## Notes and usefull links

https://impeccable.style/docs/


```mermaid
stateDiagram-v2
    direction LR
    [*] --> draft: operator/system creates ✅
    draft --> draft: operator edits ✅
    draft --> sent: operator sends ✅
    sent --> accepted: CUSTOMER accepts ✅
    sent --> declined: CUSTOMER declines ✅

    sent --> cancelled: operator withdraw ❌ MISSING
    sent --> expired: expiry job / on-read ❌ MISSING
    draft --> cancelled: discard draft ❌ MISSING

    accepted --> [*]
    declined --> [*]

    classDef live fill:#dcfce7,stroke:#16a34a,color:#14532d
    classDef dead fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
    class draft,sent,accepted,declined live
    class expired,cancelled dead
```

```mermaid
flowchart LR
    subgraph Q["QUOTE machine"]
      qs["sent"]
      qa["accepted"]
      qd["declined"]
    end
    subgraph C["CASE machine"]
      cq["quoted"]
      ca["accepted"]
      cd["declined"]
      cc["closed"]
    end
    qs -->|customer accepts| qa
    qs -->|customer declines| qd
    qa -. "✅ syncs case" .-> ca
    qd -. "✅ syncs case" .-> cd
    cd -. "❌ nothing flows back" .-> qs
    cc -. "❌ nothing flows back" .-> qs
```