# Pi extensions

- Prefer Pi's native extension and TUI APIs over terminal-position hacks.
- Use an above-editor widget for small, temporary pickers tied to the current draft.
- Interactive widgets must consume their input, preserve the draft, and always unsubscribe and clear themselves on apply, cancel, or error.
- Use non-overlay `ctx.ui.custom()` for larger focused workflows. Use overlays only when keeping the transcript visible is part of the job.
- Use `setStatus()` only for short, persistent state.
- Always expose command actions as `/command:<subcommand> [args]`, for example `/command:start` or `/command:start ./path`.
- Never use `/command <subcommand>`, such as `/command start`.
- Render with the active theme, respect the supplied width, and sanitize file-supplied display text.
- Keep focused tests beside the extension. Cover registration, keyboard input, cleanup, and editor mutation.
- Do not submit or replace editor text unless the command explicitly promises it.
