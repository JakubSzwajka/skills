# README Template Reference

## Standard Template

```markdown
# <Module Name>

<One sentence: what this module does.>

## Public API

- `exportedFunction()` - brief description
- `AnotherExport` - brief description

## Use It Like This

<Single code snippet showing import + call, or a short narrative.>

## Responsibility Boundary

<What this module owns vs. what it delegates. 1-2 sentences.>

## Read Next

- [Child Module](./child/README.md)
- [Related Module](../related/README.md)
```

## Sizing by Level

### Root level (src/lib/, src/)
- Focus: Organization, layering rules
- Read Next: Yes, heavy
- Code example: No
- Length: ~20-30 lines

### Mid-tier (services/, tools/)
- Focus: Orchestration contracts
- Read Next: Yes, children + peers
- Code example: Brief
- Length: ~15-30 lines

### Leaf (auth/, openapi/, filesystem/)
- Focus: API surface only
- Read Next: Rarely
- Code example: Sometimes
- Length: ~10-18 lines

## Rules

1. Under 30 lines when possible
2. Public API lists exports — what callers actually import, not internal helpers
3. Responsibility Boundary — the critical sentence that prevents scope creep
4. Read Next links are relative — they create the navigation graph
5. Never duplicate — don't explain a child module's internals, link to its README
6. No private functions, no tutorials, no caller descriptions
