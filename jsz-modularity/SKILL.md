---
name: jsz-modularity
description: Review code or PRDs through a capabilities-vs-operations modularity lens. Evaluates whether domain logic (invariant ownership) is properly separated from workflow coordination. Flags violations with severity. Trigger on "modularity review", "review modularity", "check module boundaries", "capabilities vs operations review", "is this modular".
---

# Modularity Review

Analyze code paths or PRD text for separation of **capabilities** (invariant owners) from **operations** (workflow coordinators). Read [references/modularity-lens.md](references/modularity-lens.md) for the full conceptual framework, violation catalog, and severity definitions before every review.

## Input Modes

**Code path**: User provides a directory or file path. Use Explore agent to map the module, then classify each unit.

**PRD text**: User provides a design document or description. Analyze described behaviors and map to capability vs. operation.

## Workflow

1. **Map** — identify all units (classes, modules, functions, files) in scope
2. **Classify** — label each as capability, operation, or mixed
3. **Detect** — apply violation catalog V1–V6 from the reference
4. **Report** — output the findings using the format below

## Output Format

```
## Modularity Review: [module/PRD name]

### Module Map
| Unit | Classification | Notes |
|------|---------------|-------|
| ... | capability / operation / mixed | ... |

### Violations
#### [V#: Violation Name] — SEVERITY
**Location**: file:line or PRD section
**What**: one-sentence description of the violation
**Why it matters**: impact on reuse, testability, or coupling
**Suggested fix**: concrete restructuring move

[repeat for each violation]

### Summary
- Capabilities: N | Operations: N | Mixed: N
- Violations: N HIGH | N MEDIUM | N LOW
- Top restructuring priority: [the single most impactful fix]
```

## Rules

- Flag everything — do not skip violations for pragmatic reasons
- Label severity using the definitions in the reference (HIGH / MEDIUM / LOW)
- Suggested fixes must be concrete: name the extraction, the target module, the new boundary
- When reviewing a PRD, flag violations as preventive guidance before code exists
- Do not suggest restructuring that introduces unnecessary abstraction — the fix should reduce coupling, not add layers
