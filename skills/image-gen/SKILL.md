---
name: image-gen
description: Generate and browse images through the Image Gen desktop app using the user's consumer subscriptions (OpenAI Codex, Google Antigravity). Use when the user asks to generate an image, create a picture, make artwork, or browse/reference previously generated images. All generation through this skill is tracked in the app's library so the user can preview it later.
---

# Image Gen

A local Tauri desktop app at `~/.agents/image-gen`, installed as
`/Applications/Image Gen.app`. It generates images through the user's
existing `codex` and `agy` subscription CLIs and tracks every batch in
its own library (SQLite + `~/Pictures/Image Gen`).

## Open the app

```bash
open -a "Image Gen"
```

Single-instance: a second open focuses the existing window.

## Generate images (tracked — preferred)

```bash
~/.agents/image-gen/scripts/agent-generate.sh "a sleepy potato astronaut" openai 1
```

- Arg 2: `openai` | `antigravity` | `both` (default `openai`)
- Arg 3: variants per provider, 1–3 (default 1)
- `--no-wait`: submit and return immediately

The script routes through the app's scheduler, so the batch shows up in
the app's Latest/History/Gallery views. It blocks until jobs finish
(up to 20 min) and prints one line per job:

```
openai | succeeded | /Users/<user>/Pictures/Image Gen/2026/08/<job-id>.png
```

Exit code 0 means at least one job succeeded.

## Rules

1. Generation consumes the user's real subscription quota. Do not loop,
   batch-spam, or retry automatically. `both` + 3 variants = 6 images.
2. Prefer this script over `~/.agents/image-gen/generate.sh`; the older
   wrapper works but its output is NOT tracked in the library.
3. Never write to the app's SQLite database. Read-only queries are fine:
   `sqlite3 -readonly "$HOME/Library/Application Support/com.jakubszwajka.image-gen/library.sqlite"`.
4. Never set or read provider API keys or Google Cloud credentials; the
   app uses cached CLI logins and strips credential variables itself.
5. If a job fails with `authentication_required`, tell the user to run
   `codex login` or `agy` login manually. If `provider_unavailable`,
   the CLI path may need setting in the app's Settings.

## Locations

- App source and design doc: `~/.agents/image-gen` (`DESIGN.md`)
- Generated images: `~/Pictures/Image Gen/YYYY/MM/<job-id>.png`
- Library metadata: `~/Library/Application Support/com.jakubszwajka.image-gen/`
- Dev build: `cd ~/.agents/image-gen && ./dev.sh`
