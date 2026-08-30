# Research: Google Antigravity subscription image generation without an API key

## Verdict

**Yes. Current Google Antigravity provides an official subscription-backed path that should be testable without an API key:**

1. Sign in to the official Antigravity CLI (`agy`) with a personal Google account.
2. Antigravity stores the account session in the operating system keyring.
3. Run `agy -p` in documented headless mode. It reuses those cached credentials.
4. Ask the Antigravity agent to use its built-in generative image tool and save the resulting PNG in the workspace.

Google's current Antigravity model documentation says its built-in generative image tool uses **Nano Banana 2**. Its plans documentation says Google AI Pro and Ultra subscriptions increase Antigravity quota. This is separate from the Gemini Developer API and Vertex AI, which use API or Google Cloud credentials and separate API billing.

The route is documented, but the local proof has not run yet. The official `agy` CLI is not installed on this machine.

## Evidence

### 1. Antigravity has a built-in image-generation tool

The current Antigravity Models page lists Nano Banana 2 under its non-customizable additional models:

> Nano Banana 2: Used by the generative image tool when the Agent wants to produce a UI mockup, needs images to populate a web page or application, generate system or architecture diagrams, or other generative image tasks.

Google also states that Antigravity agents can choose an image-generation model for UI mockups, architecture diagrams, and site assets. The older launch post named Nano Banana Pro and its fallback; the current model page names Nano Banana 2.

Sources:

- [Antigravity Models](https://antigravity.google/docs/models)
- [Nano Banana Pro in Google Antigravity](https://antigravity.google/blog/nano-banana-pro)

### 2. Personal Google-account auth does not require an API key

The current CLI Installation & Auth guide documents two separate modes:

- Default account authentication: `agy` reads a saved token profile from the native keyring. If none exists, it opens the default browser for account sign-in.
- Gemini API mode: the operator must explicitly set `modelProvider` to `gemini` and provide `GEMINI_API_KEY`.

The guide says removing `modelProvider` returns the CLI to default account-based authentication. This provides a clear way to prove that the run is not using API-key mode.

Source: [Antigravity CLI Installation & Auth](https://antigravity.google/docs/cli/install)

### 3. Consumer OAuth is scriptable after interactive login

Antigravity documents `agy -p` as headless mode for scripts and CI. The command sends one prompt and exits. The docs state:

> Headless mode uses your cached credentials. Authenticate once with an interactive `agy` session first.

Headless mode supports text, JSON, and streaming JSON output. Streaming output includes tool names and tool results, so it can provide non-secret evidence that the image-generation path ran.

Workspace file reads and writes are allowed by default in headless mode. Tools that need an unavailable interactive approval are soft-denied unless a narrow permission rule exists. The proof should avoid `--dangerously-skip-permissions` unless the built-in image tool cannot run otherwise.

Source: [Antigravity CLI Headless Mode](https://antigravity.google/docs/cli/headless)

### 4. Google AI subscription tiers fund Antigravity quota

Antigravity's current Plans page says:

- All plans get product features, including the CLI.
- Google AI Pro gets higher quota and weekly limits.
- Google AI Ultra gets the highest quota, five-hour refreshes, and highest weekly limits.
- Pro and Ultra users may buy AI-credit overages after baseline quota is exhausted.

The public pricing page also lists Antigravity access under Individual, Google AI Pro, and Google AI Ultra plans.

The exact billing label still matters for documenting the user's entitlement, but paid status is not required merely to access the built-in image tool. It changes available quota.

Sources:

- [Antigravity Plans](https://antigravity.google/docs/plans)
- [Antigravity Pricing](https://antigravity.google/pricing)
- [Antigravity AI Credits](https://antigravity.google/docs/cli/credits)

### 5. The public Gemini image API remains a separate product

The Gemini Developer API also exposes Nano Banana image models, but its current documentation requires an API key. Every Gemini API key belongs to a Google Cloud project for quota and billing. Paid API tiers require a linked billing account and API credits or postpaid billing.

A Google AI Pro or Ultra subscription does not turn consumer OAuth into Gemini API credentials. The planned proof must use Antigravity's built-in tool, not `google-genai`, REST, AI Studio keys, Vertex AI, or a media-generation MCP server.

Sources:

- [Gemini API image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [Using Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key)
- [Gemini API billing](https://ai.google.dev/gemini-api/docs/billing)

### 6. Only the official Antigravity client is acceptable

Google's FAQ and Additional Terms say using third-party software to access Antigravity with its OAuth session violates the service terms and can lead to suspension. Google directs third-party coding agents to Vertex or AI Studio API keys instead.

Therefore the proof must use the official `agy` binary. It must not extract keyring tokens, replay private endpoints, automate the consumer web app, or pass Antigravity OAuth to another client.

Sources:

- [Antigravity FAQ](https://antigravity.google/docs/faq)
- [Antigravity Additional Terms](https://antigravity.google/terms)

## Local state

Observed before installation:

- `gemini`: installed, version `0.46.0`
- `agy` / `antigravity`: not installed
- `gcloud`: not installed
- `GEMINI_API_KEY`: unset
- `GOOGLE_API_KEY`: unset
- `GOOGLE_APPLICATION_CREDENTIALS`: unset
- Google Cloud project/location and Vertex-selection variables: unset

Gemini CLI is not the target. Its installed version does not document a built-in image tool. Homebrew now marks that formula as superseded by the official Antigravity CLI.

Current official Antigravity CLI package found through Homebrew:

- Version: `1.1.22`
- Product: [Antigravity CLI](https://antigravity.google/product/antigravity-cli)
- Download host: Google's `antigravity-public` Cloud Storage bucket
- Apple Silicon archive SHA-256: `ac0e961957f4a6cd67f9170b82edae15e92f107fe333e56d71aa01613ea547bd`
- Installed command: `agy`

## Smallest safe proof

1. Get approval to install the official Homebrew cask: `brew install --cask antigravity-cli`.
2. Run `agy` interactively and let the operator finish Google's browser login. Do not display or inspect tokens.
3. Confirm the CLI account mode without printing the account email. Keep `modelProvider` absent so API-key mode is not active.
4. Run one headless prompt from `image-gen/` with these credential variables removed from the process: `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, Cloud project/location variables, and Vertex-selection variables.
5. Ask the agent to generate one silly image using its built-in generative image tool and save it as `image-gen/antigravity-proof.png`.
6. Prefer `--output-format stream-json` so the log identifies the tool path. Redact account details and any authorization URLs.
7. Validate exit status, PNG type, dimensions, byte size, and SHA-256.
8. Add a small wrapper only after the direct command works.

## Residual risks

- Antigravity decides when to call its image tool. An explicit prompt should request the built-in generative image tool, but the first run may still need prompt tuning.
- The docs name the image tool's model but do not publish a stable tool identifier or a fixed saved-file contract.
- Headless permission policy may soft-deny a required tool. Use the narrowest documented permission change if that occurs.
- Image use consumes Antigravity quota. Pro and Ultra quotas can change with capacity.
- Antigravity records interaction data under its Additional Terms unless the account's data-use setting changes.
- The account's exact paid label has not been recorded. Ask only for the product label, not account identifiers.
