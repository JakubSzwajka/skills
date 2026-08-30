# Research: OpenAI consumer subscriptions and programmatic image generation without an API key

## Summary

**Blunt verdict: yes, but only through Codex’s supported built-in `image_gen` path—not through the public Images API.** A paid ChatGPT plan such as Plus or Pro can authenticate Codex CLI with ChatGPT OAuth, and current OpenAI docs list both Codex scripting and image generation for those plans. The public Image API and Responses API remain separate, API-key-authenticated, usage-priced products.

**Confidence: high** for the Codex and API distinction; **medium** for browser/private-endpoint restrictions because the reviewed first-party material does not state a specific automation rule for `chatgpt.com` or document private endpoints at all. The reviewed docs show no page-level publication/update date; the implementation evidence is pinned to Codex commit `28327355b861ab6cc76b01c7248663eb1be440cf` (commit date not visible in the supplied capture).

## Findings

1. **Official Images API access: a consumer subscription is not an API credential.** OpenAI’s API guide exposes image generation through the Image API and the Responses API. Its official `curl` example sends `Authorization: Bearer $OPENAI_API_KEY`; SDK examples use the API client’s normal API authentication. Codex authentication docs also say API-key use is billed through the Platform account at standard API rates, while ChatGPT sign-in uses subscription access. Therefore Plus/Pro does not by itself provide general calls to `/v1/images/generations` or the Responses API. [Image generation API guide](https://developers.openai.com/api/docs/guides/image-generation) · [Codex authentication](https://learn.chatgpt.com/docs/auth) **Confidence: high.**

2. **Codex CLI is the supported no-API-key exception.** OpenAI documents two Codex login methods: “Sign in with ChatGPT for subscription access” and API-key sign-in for usage-based access. `codex login` opens the ChatGPT browser flow; Codex refreshes its saved ChatGPT tokens. The pricing feature matrix marks both “Codex SDK, `codex exec`, and scriptable workflows” and “Image generation and editing” as available on Plus and Pro. [Codex authentication](https://learn.chatgpt.com/docs/auth) · [Codex pricing and feature availability](https://learn.chatgpt.com/docs/pricing) **Confidence: high.**

3. **The built-in Codex image tool uses subscription limits and needs no `OPENAI_API_KEY`.** OpenAI’s image-generation docs say CLI users can request an image or invoke `$imagegen`; built-in generation uses `gpt-image-2`, counts against general Codex limits, and uses included limits about 3–5× faster than similar non-image turns. They recommend setting `OPENAI_API_KEY` only for larger API batches. The official skill says the preferred built-in mode “Does not require `OPENAI_API_KEY`,” while its fallback Python/API mode does. Image generation is unavailable on Free and is charged at API rates when Codex itself is authenticated by API key. [Codex image generation](https://learn.chatgpt.com/docs/image-generation?surface=cli) · [Codex pricing](https://learn.chatgpt.com/docs/pricing#image-generation-usage-limits) · [Official imagegen skill at pinned commit](https://github.com/openai/codex/blob/28327355b861ab6cc76b01c7248663eb1be440cf/codex-rs/skills/src/assets/samples/imagegen/SKILL.md) **Confidence: high.**

4. **The source confirms this is a Codex-managed path, not ordinary public API entitlement.** At the pinned commit, Codex omits `image_gen` for a cached `PlanType::Free` account and requires OpenAI/Codex-backed authorization plus provider/model capabilities. The backend resolves the active provider’s authentication rather than reading `OPENAI_API_KEY` directly. Its tool sends `gpt-image-2` generation/edit requests, decodes the returned base64, and persists a generated PNG. [Plan gating](https://github.com/openai/codex/blob/28327355b861ab6cc76b01c7248663eb1be440cf/codex-rs/core/src/tools/spec_plan.rs#L709-L742) · [Auth-aware backend](https://github.com/openai/codex/blob/28327355b861ab6cc76b01c7248663eb1be440cf/codex-rs/ext/image-generation/src/backend.rs) · [PNG persistence](https://github.com/openai/codex/blob/28327355b861ab6cc76b01c7248663eb1be440cf/codex-rs/ext/image-generation/src/tool.rs) **Confidence: high.**

5. **Non-interactive use is officially supported, with limits.** OpenAI documents `codex exec` for scripts and says it reuses saved CLI authentication. Its advanced CI section permits ChatGPT-managed auth on trusted runners but calls API keys the default for automation and warns that `~/.codex/auth.json` contains access tokens. Taken together with the Plus/Pro scripting and image-generation feature entries, a local `codex exec` prompt that invokes `$imagegen` is a supported programmatic route under subscription access. It is an agentic CLI workflow, not a stable drop-in replacement for the Images API’s request/response contract or batch controls. [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive) · [Codex image generation](https://learn.chatgpt.com/docs/image-generation?surface=cli) **Confidence: high.**

6. **Browser/UI automation of `chatgpt.com` is not the documented programmatic route.** OpenAI documents asking for images in ChatGPT web, then explicitly directs users seeking “programmatic image generation” to the Image generation API. None of the reviewed first-party captures describes DOM-driving, Playwright/Selenium automation, scraping, or unattended control of the ChatGPT image UI as a supported interface. This supports a verdict of **not documented/supported**, not a claim that every form is expressly forbidden. [Codex/ChatGPT image generation](https://learn.chatgpt.com/docs/image-generation?surface=web) **Confidence: high on support status; low on any broader legal prohibition.**

7. **Private web endpoints or extracted session tokens are unsupported and unsafe to treat as an API.** OpenAI documents browser-returned credentials only for Codex’s own sign-in flow, says cached `auth.json` contains access tokens and must be treated like a password, and says general API calls should continue to use Platform API keys. No reviewed OpenAI document specifies a private ChatGPT image endpoint, promises its stability, or authorizes replaying extracted browser/session tokens against it. [Codex authentication and credential storage](https://learn.chatgpt.com/docs/auth#credential-storage) **Confidence: high that no supported contract is documented; medium on terms consequences because no relevant terms text was present in the verified captures.**

## What can be proved locally without exposing credentials

1. Run `codex login status` and record only the reported authentication method; do **not** print or open `~/.codex/auth.json`.
2. Check only whether `OPENAI_API_KEY` is absent/present, never its value (for example, a boolean shell test).
3. Pin/record the Codex CLI version and compare its source or release to the cited implementation.
4. With the user’s approval to spend plan quota, run a small `codex exec` request that explicitly invokes `$imagegen`; record exit status, redacted logs, usage before/after, and the generated file path.
5. Validate the artifact locally via file type/PNG signature, dimensions, size, and hash. A successful PNG while `OPENAI_API_KEY` is absent and `codex login status` reports ChatGPT auth is strong end-to-end proof of this Codex route.

Source inspection alone proves implementation and documented entitlement, not that a particular local account currently has rollout, workspace permission, region access, or remaining quota. No live generation was run for this report, so no subscription quota was consumed and no credentials were accessed.

## Sources

- **Kept:** [Codex authentication](https://learn.chatgpt.com/docs/auth) — official login, billing separation, token storage, and automation guidance; no page date visible.
- **Kept:** [Codex pricing](https://learn.chatgpt.com/docs/pricing) — official Plus/Pro scripting and image-generation availability, plan limits, and Free exclusion; no page date visible.
- **Kept:** [Codex image generation](https://learn.chatgpt.com/docs/image-generation) — official UI/CLI behavior and built-in-vs-API guidance; no page date visible.
- **Kept:** [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive) — official `codex exec` and saved-auth behavior; no page date visible.
- **Kept:** [OpenAI API image generation guide](https://developers.openai.com/api/docs/guides/image-generation) — official API surfaces and API-key request example; no page date visible.
- **Kept:** [openai/codex pinned source](https://github.com/openai/codex/tree/28327355b861ab6cc76b01c7248663eb1be440cf/codex-rs/ext/image-generation) — direct implementation evidence fixed to an immutable commit; commit date not visible in supplied capture.
- **Dropped:** Codex Manual capture — redundant aggregation of the same official pages; its unrelated dated changelog material was not used.
- **Dropped:** third-party commentary and reverse-engineering material — excluded by the primary-source-only requirement.

## Gaps and residual risks

- OpenAI does not document the internal Codex image endpoint as a public contract, nor promise endpoint/schema stability outside Codex.
- The reviewed sources do not specify deterministic `codex exec` output naming or a direct machine API equivalent to all Images API parameters; the implementation saves PNG artifacts, while the skill describes path handling.
- The supplied first-party captures did not include applicable Terms text about browser automation. Therefore this report does not claim a precise terms violation; it only finds no supported UI-automation contract.
- Runtime access can still depend on rollout, plan state, workspace controls, region, model/provider capabilities, and remaining limits.

## Review findings

- **No blocker:** `/Users/jakubszwajka/.agents/image-gen/openai-subscription-research.md` — decisive API-vs-Codex claims have first-party citations.
- **Medium:** Browser automation and private endpoints — OpenAI provides no supported contract in the reviewed sources; exact terms consequences remain unverified.
- **Low:** No live local generation was performed, so account-specific availability is not attested.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings, confidence, severity, source URLs, immutable Codex source paths, review findings, and residual risks are recorded in /Users/jakubszwajka/.agents/image-gen/openai-subscription-research.md."
    }
  ],
  "changedFiles": [
    "/Users/jakubszwajka/.agents/image-gen/openai-subscription-research.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "Live Codex image generation",
      "result": "not-run",
      "summary": "Not run to avoid consuming quota or accessing credentials."
    }
  ],
  "validationOutput": [
    "Reviewed six verified official OpenAI documentation captures and four pinned openai/codex implementation files.",
    "No credentials, auth-cache contents, session tokens, or API-key values were accessed or exposed."
  ],
  "residualRisks": [
    "No supplied first-party Terms capture resolved the exact legal status of browser UI automation.",
    "No live account-specific image generation was run; rollout, workspace, region, and quota availability remain unproved locally."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added only the requested research report; no project or source files were modified.",
  "reviewFindings": [
    "no blocker: /Users/jakubszwajka/.agents/image-gen/openai-subscription-research.md - decisive API-vs-Codex claims have first-party sources",
    "medium: browser automation/private endpoints - unsupported by reviewed docs, but exact Terms consequences are not documented in supplied captures",
    "low: local account entitlement - not live-tested"
  ],
  "manualNotes": "The report distinguishes public API access, Codex ChatGPT OAuth/subscription access, browser automation, and private endpoints, and gives a credential-safe local proof plan."
}
```
