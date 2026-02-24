#!/usr/bin/env bash
# Create a new PRD directory with a README.md from the template.
# Usage: init_prd.sh <slug> [--dir <prds-directory>]
#
# Examples:
#   init_prd.sh email-notifications
#   init_prd.sh email-notifications --dir docs/prds

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$SCRIPT_DIR/../assets/templates/prd-readme.md"

SLUG=""
PRD_DIR="docs/prds"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) PRD_DIR="$2"; shift 2 ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *) SLUG="$1"; shift ;;
  esac
done

if [[ -z "$SLUG" ]]; then
  echo "Usage: init_prd.sh <slug> [--dir <prds-directory>]" >&2
  exit 1
fi

TARGET="$PRD_DIR/$SLUG"

if [[ -d "$TARGET" ]]; then
  echo "PRD directory already exists: $TARGET" >&2
  exit 1
fi

mkdir -p "$TARGET"
DATE=$(date +%Y-%m-%d)
sed "s/{YYYY-MM-DD}/$DATE/" "$TEMPLATE" > "$TARGET/README.md"

echo "Created PRD: $TARGET/README.md"
