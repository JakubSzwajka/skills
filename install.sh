#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENTS_MD="$SCRIPT_DIR/AGENTS.md"

if [ ! -f "$AGENTS_MD" ]; then
  echo "Missing agent instructions: $AGENTS_MD" >&2
  exit 1
fi

mkdir -p "$HOME/.claude" "$HOME/.codex" "$HOME/.pi"

# Keep tool-facing instruction files pointed at the shared root instructions.
ln -sf "$AGENTS_MD" "$HOME/.claude/CLAUDE.md"
ln -sf "$AGENTS_MD" "$HOME/.codex/AGENTS.md"
ln -sf "$AGENTS_MD" "$HOME/.pi/APPEND_SYSTEM.md"

# Claude consumes the shared skill repo through ~/.claude/skills.
ln -sfn "$SCRIPT_DIR/skills" "$HOME/.claude/skills"

# Codex reads user skills directly from ~/.agents/skills. Do not replace
# ~/.codex/skills; Codex owns that directory for system/installed skills.

mkdir -p "$SCRIPT_DIR/bin"

# Add ~/.agents/bin to PATH if not already present.
SHELL_RC="$HOME/.zshrc"
if ! grep -q '\.agents/bin' "$SHELL_RC" 2>/dev/null; then
  printf '\nexport PATH="$HOME/.agents/bin:$PATH"\n' >> "$SHELL_RC"
  echo "Added ~/.agents/bin to PATH in .zshrc"
fi

echo "Installed shared agent config."
