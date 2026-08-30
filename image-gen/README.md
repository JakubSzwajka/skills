# Subscription-backed image generation

One Bash wrapper calls either OpenAI Codex or Google Antigravity using consumer subscription login. It removes API-key and Google Cloud credential variables from the provider process.

## Usage

```bash
cd image-gen

./generate.sh openai "a sleepy potato wearing tiny reading glasses"
./generate.sh antigravity "a sleepy potato wearing tiny reading glasses"
```

Pass a destination as the third argument:

```bash
./generate.sh openai "a red circle" ./output/openai-circle.png
./generate.sh antigravity "a blue square" ./output/google-square.png
```

The old two-argument form still defaults to OpenAI:

```bash
./generate.sh "a red circle" ./output/red-circle.png
```

## Provider paths

### OpenAI

```text
generate.sh -> codex exec -> ChatGPT OAuth -> built-in image_gen -> PNG
```

The proof artifact is [`openai-proof.png`](./openai-proof.png).

- Codex CLI: `0.147.0`
- Authentication: ChatGPT login
- API-key variables during execution: unset
- Output: 1254 × 1254 RGBA PNG, 374,277 bytes
- SHA-256: `ddd98b2e365217687b8eb90b18362ec186bcbc5ff0a3a123d25993af244c265f`

Set `CODEX_IMAGE_MODEL` if the subscription model catalog changes:

```bash
CODEX_IMAGE_MODEL=gpt-5.5 ./generate.sh openai "a blue square"
```

### Google Antigravity

```text
generate.sh -> agy -p -> Google-account OAuth -> built-in generate_image / Nano Banana 2 -> PNG
```

The wrapper forbids SVG, HTML, Canvas, code-generated graphics, external APIs, MCP fallbacks, and Vertex AI. It removes Gemini API and Google Cloud credential variables before launching `agy`.

The first live attempt reached Antigravity's official `generate_image` tool but Google's backend returned HTTP 500 `INTERNAL`. This proves the correct tool was selected, but no Google proof image exists yet. Retry after the service recovers:

```bash
./generate.sh antigravity "a silly potato astronaut" ./antigravity-proof.png
```

## Desktop application

The Tauri desktop application is specified in [`DESIGN.md`](./DESIGN.md).

```bash
./dev.sh            # development app (Vite + Tauri)
npm test            # frontend logic tests
npm run build       # typecheck + frontend bundle
cd src-tauri && cargo test   # Rust tests (fake providers, no quota)
npx tauri build     # release bundle (Image Gen.app)
```

Tests never call real providers. Real generation uses the installed
`codex` and `agy` CLIs with their cached subscription logins; set their
absolute paths in Settings if they are not auto-discovered.

Install or update: `./scripts/install.sh` (builds, replaces
`/Applications/Image Gen.app`, and relaunches if it was running).

### Tracked generation for agents

```bash
./scripts/agent-generate.sh "a sleepy potato astronaut" both 2
```

This routes through the app's scheduler (launching the app if needed),
so the batch is recorded in the library and browsable in the app. The
older `generate.sh` still works but bypasses tracking.

## Limits

Consumer subscriptions do not grant access to the providers' public image APIs. Those APIs use separate API credentials and billing. These wrappers drive official agent CLI workflows, so they are slower and less deterministic than direct image APIs.

Research:

- [`openai-subscription-research.md`](./openai-subscription-research.md)
- [`google-antigravity-subscription-research.md`](./google-antigravity-subscription-research.md)
