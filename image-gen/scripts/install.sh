#!/usr/bin/env bash
# Build the release bundle and install/update it in /Applications.
# A running instance is quit first and reopened after.
set -euo pipefail
cd "$(dirname -- "${BASH_SOURCE[0]}")/.."

npx tauri build

WAS_RUNNING=0
if pgrep -f "Image Gen.app/Contents/MacOS" >/dev/null 2>&1; then
  WAS_RUNNING=1
  pkill -f "Image Gen.app/Contents/MacOS" || true
  sleep 1
fi

rsync -a --delete \
  "src-tauri/target/release/bundle/macos/Image Gen.app/" \
  "/Applications/Image Gen.app/"
touch "/Applications/Image Gen.app"

echo "Installed to /Applications/Image Gen.app"
[ "$WAS_RUNNING" -eq 1 ] && open -a "Image Gen"
