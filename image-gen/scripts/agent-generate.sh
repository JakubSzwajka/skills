#!/usr/bin/env bash
# Tracked image generation through the Image Gen app.
#
# Every batch created here goes through the app's quota-protecting
# scheduler and lands in the library, so it is browsable in the app
# later. This script never talks to a provider directly.
#
# Usage:
#   agent-generate.sh "prompt" [openai|antigravity|both] [variants 1-3] [--no-wait]
#
# Prints one line per job when done:  provider | status | path-or-error
# Exit code 0 when at least one job succeeded.
set -euo pipefail

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 2
}

[ $# -ge 1 ] || fail 'usage: agent-generate.sh "prompt" [openai|antigravity|both] [variants] [--no-wait]'

PROMPT=$1
PROVIDERS=${2:-openai}
VARIANTS=${3:-1}
WAIT=1
for arg in "$@"; do
  [ "$arg" = "--no-wait" ] && WAIT=0
done

case $PROVIDERS in
  openai | antigravity) ;;
  both) PROVIDERS="openai,antigravity" ;;
  --no-wait) PROVIDERS="openai" ;;
  *) fail "providers must be openai, antigravity, or both" ;;
esac
case $VARIANTS in
  1 | 2 | 3) ;;
  --no-wait) VARIANTS=1 ;;
  *) fail "variants must be 1, 2, or 3" ;;
esac

APP_BIN="/Applications/Image Gen.app/Contents/MacOS/image-gen"
DEV_BIN="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/src-tauri/target/release/bundle/macos/Image Gen.app/Contents/MacOS/image-gen"
[ -x "$APP_BIN" ] || APP_BIN="$DEV_BIN"
[ -x "$APP_BIN" ] || fail "Image Gen is not installed; build it or copy it to /Applications"

DB="$HOME/Library/Application Support/com.jakubszwajka.image-gen/library.sqlite"
START_MS=$(( $(date +%s) * 1000 ))

# Launching the binary directly delivers the request either way: a running
# instance receives it over the single-instance channel; otherwise this
# process becomes the app (window and all) and processes it at bootstrap.
"$APP_BIN" --prompt "$PROMPT" --providers "$PROVIDERS" --variants "$VARIANTS" \
  >/dev/null 2>&1 &
disown

q() {
  /usr/bin/sqlite3 -readonly "$DB" "$1" 2>/dev/null || true
}

# Find the batch this trigger created (newest batch since START_MS).
BATCH=""
for _ in $(seq 1 120); do
  BATCH=$(q "SELECT id FROM generation_batches
             WHERE created_at >= $START_MS
             ORDER BY created_at DESC, id DESC LIMIT 1")
  [ -n "$BATCH" ] && break
  sleep 0.5
done
[ -n "$BATCH" ] || fail "the app did not register the batch (is generation configured in Settings?)"

if [ "$WAIT" -eq 0 ]; then
  printf 'batch %s submitted\n' "$BATCH"
  exit 0
fi

# Wait for every job to reach a terminal state (max 20 minutes).
for _ in $(seq 1 1200); do
  ACTIVE=$(q "SELECT COUNT(*) FROM generation_jobs
              WHERE batch_id = '$BATCH' AND status IN ('queued','running')")
  [ "${ACTIVE:-1}" = "0" ] && break
  sleep 1
done

q "SELECT j.provider || ' | ' || j.status || ' | ' ||
          COALESCE(a.path, COALESCE(j.error_code,'pending') || ': ' || COALESCE(j.error_message,''))
   FROM generation_jobs j
   LEFT JOIN assets a ON a.id = j.output_asset_id
   WHERE j.batch_id = '$BATCH'
   ORDER BY j.provider, j.variant_index"

SUCCEEDED=$(q "SELECT COUNT(*) FROM generation_jobs
               WHERE batch_id = '$BATCH' AND status = 'succeeded'")
[ "${SUCCEEDED:-0}" -gt 0 ]
