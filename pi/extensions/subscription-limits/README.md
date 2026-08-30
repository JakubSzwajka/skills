# Subscription limits

Global Pi command for provider-reported subscription and credit limits.

```text
/limits
```

It shows:

- ChatGPT Codex quota windows, model-specific windows, and reset times
- Claude session, weekly, and model-scoped limits such as Fable or Opus
- OpenRouter key spend limits and account credits

The command uses Pi's resolved credentials, so OAuth refresh stays with Pi. It does not read `auth.json`, print tokens, poll in the background, or store provider responses. Requests run only when `/limits` is opened and time out after 12 seconds.

Codex and Claude consumer usage endpoints are private provider APIs. Their fields can change without notice. The parser tolerates missing windows and shows provider errors without blocking normal Pi work.

The existing `/usage` command remains separate. It reports local Pi session tokens and costs, while `/limits` reports provider-side quota.
