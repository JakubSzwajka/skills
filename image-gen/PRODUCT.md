# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is one person using Image Gen as a private desktop utility. They generate images and browse or reuse past results in the same session. Generation and the image library deserve equal weight.

## Product Purpose

Image Gen creates and organizes images through the user's existing OpenAI Codex and Google Antigravity consumer subscriptions. Success means getting from an idea or past image to a useful result with little setup, while keeping every attempt available for later reuse.

## Positioning

Image Gen routes generation through installed provider CLIs and existing account logins, then records the work in a local image library. It does not ask for API keys or add separate API billing.

## Operating Context

The app runs as a single-instance macOS desktop utility built with Tauri, React, TypeScript, and Rust. A generation batch contains one prompt, selected providers, one to three variants per provider, and up to eight references. References can come from clipboard images or past generations.

## Capabilities and Constraints

- Generate with OpenAI Codex, Google Antigravity, or both.
- Show all generation controls before submission: references, prompt, providers, and variant count.
- Track each generation job independently through queued, running, succeeded, failed, cancelled, and interrupted states.
- Cancel active jobs and retry terminal attempts without overwriting history.
- Browse results as batches or a gallery, preview images, copy them, reveal them in Finder, and reuse them as references.
- Store metadata in SQLite and image files on disk.
- Never request, store, or inspect provider credentials.
- Protect subscription quota with provider and global concurrency limits.
- The current redesign may challenge the prompt-to-result flow, but it should keep history understandable and conventional.

## Brand Commitments

The product name is Image Gen. The voice is direct and practical. It is a personal tool, not a public service or marketing product.

## Evidence on Hand

- Working application code under `src/` and `src-tauri/`.
- Product and architecture decisions in `DESIGN.md`.
- A generated image in `output/image-20260830-104451.png`.
- Provider research and proof artifacts in the repository.
- No customer claims, usage benchmarks, or public brand assets exist and future work must not invent them.

## Product Principles

1. Generation and reuse are peers.
2. Keep the full generation setup visible and understandable.
3. Make quota use clear before submission.
4. Preserve every attempt and expose recovery actions.
5. Keep provider authentication outside the app.
