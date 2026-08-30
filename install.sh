#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENTS_MD="$SCRIPT_DIR/AGENTS.md"
PI_CONFIG_DIR="$SCRIPT_DIR/pi"

fail() {
  echo "$*" >&2
  exit 1
}

link_file() {
  local source="$1"
  local target="$2"

  [ -e "$source" ] || fail "Missing source: $source"
  mkdir -p "$(dirname "$target")"

  if [ -L "$target" ]; then
    [ "$(readlink "$target")" = "$source" ] && return
    fail "Refusing to replace symlink: $target"
  fi

  [ -e "$target" ] && fail "Refusing to replace existing path: $target"
  ln -s "$source" "$target"
}

validate_json() {
  local file="$1"

  if command -v python3 >/dev/null 2>&1; then
    python3 -m json.tool "$file" >/dev/null
    return
  fi

  if command -v node >/dev/null 2>&1; then
    node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$file"
    return
  fi

  fail "Need python3 or node to validate JSON"
}

[ -f "$AGENTS_MD" ] || fail "Missing agent instructions: $AGENTS_MD"
for file in settings.json keybindings.json devports.json; do
  [ -f "$PI_CONFIG_DIR/$file" ] || fail "Missing Pi config: $PI_CONFIG_DIR/$file"
done

mkdir -p "$HOME/.claude" "$HOME/.codex" "$HOME/.pi/agent"

# Shared instructions and skills.
link_file "$AGENTS_MD" "$HOME/.claude/CLAUDE.md"
link_file "$AGENTS_MD" "$HOME/.codex/AGENTS.md"
link_file "$AGENTS_MD" "$HOME/.pi/APPEND_SYSTEM.md"
link_file "$SCRIPT_DIR/skills" "$HOME/.claude/skills"

# Portable Pi configuration. Pi loads extensions, prompts, and themes from
# paths declared in the linked settings.json file.
for file in settings.json keybindings.json devports.json; do
  link_file "$PI_CONFIG_DIR/$file" "$HOME/.pi/agent/$file"
  validate_json "$HOME/.pi/agent/$file"
done

mkdir -p "$SCRIPT_DIR/bin"

# Add ~/.agents/bin to PATH if not already present.
SHELL_RC="$HOME/.zshrc"
if ! grep -q '\.agents/bin' "$SHELL_RC" 2>/dev/null; then
  printf '\nexport PATH="$HOME/.agents/bin:$PATH"\n' >> "$SHELL_RC"
  echo "Added ~/.agents/bin to .zshrc"
fi

echo "Installed shared agent config."
