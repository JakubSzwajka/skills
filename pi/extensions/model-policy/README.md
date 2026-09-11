# Model policy

This pi extension limits the model catalogue by working directory. It filters agent sessions by default while leaving the operator's TUI session unchanged.

The extension is auto-loaded from `~/.agents/pi/extensions`. It needs no packages and must not be added to `settings.json` again.

## Configure it

Copy `model-policy.example.json` to `~/.pi/agent/model-policy.json`, then replace the example directories and model patterns with real values.

```json
{
  "default": { "allow": ["*"] },
  "rules": [
    {
      "when": "~/work/acme",
      "allow": ["anthropic/*"],
      "prefer": ["anthropic/claude-opus-5", "anthropic/claude-sonnet-5"],
      "enforce": "agents"
    },
    { "when": "~/personal", "deny": ["amazon-bedrock/*"], "enforce": "all" }
  ]
}
```

A missing policy file disables filtering without a warning. A malformed file disables filtering and prints one warning. It never blocks startup.

Rules work as follows:

1. `when` matches that directory and its descendants. Matching uses path segments, so `/work/acme` does not match `/work/acme-other`.
2. `when` accepts `*` for one path segment and `**` for any number of path segments.
3. The rule with the longest literal path prefix wins. If two prefixes have the same length, the later rule wins.
4. `allow` defaults to `["*"]`. Any matching `deny` pattern is then subtracted.
5. `prefer` is optional. When pi must replace a disallowed active model, it tries these patterns in written order before scanning the catalogue in its existing order.
6. A preferred model must also pass `allow` and `deny`, exist in the catalogue, and be accepted by `pi.setModel()`. The extension skips failed entries. It warns when a preference contradicts its rule.
7. Model patterns in `allow`, `deny`, and `prefer` test both `provider/modelId` and the bare `modelId`. `*` matches any text.
8. `enforce` defaults to `"agents"`. Use `"all"` when the operator TUI should also be filtered.

A session counts as an agent when `PI_DELEGATE_ROLE=child` or pi runs in print, JSON, or RPC mode. A TUI session without the child role counts as the operator. This means `pi -p` in a restricted directory is filtered even when you launch it by hand.

When filtering removes the active model, the extension tries the matched rule's `prefer` list first. If no preferred model works, it selects the first authenticated allowed model in pi's available-model order. Omitting `prefer` keeps the original catalogue-order behavior. Child sessions also get a persistent `model-policy:switch` entry and a visible message before the agent starts.

## Commands

- `/models:status` shows the cwd, matched rule, note, enforcement level, effective preference order, session class, counts, and surviving providers.
- `/models:unlock` asks for confirmation and restores the catalogue captured at session start. It works only in an operator TUI and lasts only for that session.
- `/models:lock` applies the current rule again.

The policy file is an ordinary file, and anything with filesystem access can change it. The only real boundary is that a worker reads the policy at its own startup in its own process.

## Test

```sh
cd /Users/jakubszwajka/.agents/pi/extensions/model-policy
node --test "test/**/*.test.ts"
```

The exported helpers are `loadPolicy`, `matchRule`, `isModelAllowed`, `classifySession`, and `applyPolicy`. `applyPolicy` accepts a policy object and returns the captured originals plus a `restore()` method for tests and live harnesses.
