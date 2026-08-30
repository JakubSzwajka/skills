#!/usr/bin/env bash
# Start the Tauri development application.
set -euo pipefail
cd "$(dirname "$0")"
exec npx tauri dev "$@"
