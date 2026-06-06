#!/usr/bin/env bash
# Thin shim around validate_prd.py (the validator is in Python for reliable
# parsing). Validates a prd-create task folder or a single prd.md against
# references/prd-format.md + references/task-format.md.
#
# Usage:
#   validate_prd.sh <task-folder>      # validates prd.md + tasks.md + log.md
#   validate_prd.sh <path-to-prd.md>   # validates just the PRD
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$DIR/validate_prd.py" "$@"
