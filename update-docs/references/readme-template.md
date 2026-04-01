# README Template Reference

## Goal

Code-module READMEs should be short, stable module cards. They are for both humans and documentation scanners.

## Standard Template

```markdown
---
title: <Display Title>
section: <Top-Level Section>
subsection: <Optional Subsection>
order: <Optional Integer>
---

# <Module Name>

<One sentence: what this module does.>

## Activation

<How this module becomes active at runtime or build time.>

## Public API

- `exportedSymbol` - brief caller-facing description

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `EXAMPLE_VAR` | `value` | What it controls |

## Use It Like This

```ts
import { thing } from "<module>";
```

## Responsibility Boundary

<What this module owns vs. what it delegates.>

## Operational Constraints

- <Runtime, build, or storage assumption>
- <Activation limitation or failure mode>

## Known Limitations

- <Short limitation if it materially affects callers>

## Status

<Stable, proof, experimental, legacy, best-effort, etc.>

## Read Next

- [Related Module](../related/README.md)
```

## Section Guidance

### Always include

- Summary sentence
- `Activation`
- `Responsibility Boundary`
- `Operational Constraints`
- `Read Next`

### Include when relevant

- `Public API` when callers import symbols from the module
- `Configuration` when env vars, config files, or build outputs matter
- `Use It Like This` when a tiny example helps clarify imports or usage
- `Known Limitations` when behavior is intentionally incomplete or surprising
- `Status` when maturity matters

### Usually omit

- Long tutorials
- Step-by-step deployment docs
- Deep child-module explanations
- Private implementation details
- Data-model diagrams unless they are genuinely central and stable

## Sizing Rules

### Root README

- Focus on repo structure, top-level runtime/config contract, and navigation
- Keep it compact and accurate

### Core/Mid-tier module README

- Focus on activation, ownership, orchestration, and key constraints
- Usually 20-40 lines plus frontmatter

### Leaf module README

- Focus on activation, public surface, and limits
- Usually 12-30 lines plus frontmatter

## Drift Checks

Before finalizing a README, compare it against:

1. Entrypoint exports
2. Runtime/boot wiring
3. Env-var usage
4. Parent/child module relationships
5. Existing `Read Next` links

If the README says something that the code no longer does, rewrite it even if the section already exists.
