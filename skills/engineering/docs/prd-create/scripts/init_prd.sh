#!/usr/bin/env bash
# Scaffold a prd-create task folder with prd.md / tasks.md / log.md skeletons.
# Usage: init_prd.sh <slug> [--dir <tasks-active-directory>]
#
# Examples:
#   init_prd.sh admin-detail-page
#   init_prd.sh admin-detail-page --dir docs/tasks/active
#
# Creates: <dir>/<YYYY-MM-DD>-<slug>/{prd.md,tasks.md,log.md}
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TPL="$SCRIPT_DIR/../assets/templates"

SLUG=""
PRD_DIR="docs/tasks/active"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) PRD_DIR="$2"; shift 2 ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *) SLUG="$1"; shift ;;
  esac
done

if [[ -z "$SLUG" ]]; then
  echo "Usage: init_prd.sh <slug> [--dir <tasks-active-directory>]" >&2
  exit 1
fi

DATE="$(date +%Y-%m-%d)"
TARGET="$PRD_DIR/${DATE}-${SLUG}"
if [[ -d "$TARGET" ]]; then
  echo "Task folder already exists: $TARGET" >&2
  exit 1
fi

mkdir -p "$TARGET"
cp "$TPL/prd-readme.md" "$TARGET/prd.md"
cp "$TPL/tasks.md"      "$TARGET/tasks.md"
cp "$TPL/notebook.md"   "$TARGET/log.md"

echo "Created task folder: $TARGET"
echo "  - prd.md   (fill using references/prd-format.md)"
echo "  - tasks.md (decompose using references/task-format.md)"
echo "  - log.md   (continuity notebook)"
echo "Validate when drafted: python3 $SCRIPT_DIR/validate_prd.py $TARGET"
