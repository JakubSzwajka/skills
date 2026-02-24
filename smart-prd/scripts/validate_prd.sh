#!/usr/bin/env bash
set -euo pipefail

file="${1:?Usage: validate_prd.sh <path-to-README.md>}"
errors=0
warns=0

if [[ ! -f "$file" ]]; then
  echo "ERROR: File not found: $file"
  exit 1
fi

content="$(cat "$file")"
lines="$(wc -l < "$file" | tr -d ' ')"

# --- Frontmatter ---

if ! head -1 "$file" | grep -q '^---$'; then
  echo "ERROR: Missing frontmatter — file must start with ---"
  ((errors++))
else
  closing_line="$(tail -n +2 "$file" | grep -n '^---$' | head -1 | cut -d: -f1)"
  if [[ -z "$closing_line" ]]; then
    echo "ERROR: Missing closing --- for frontmatter"
    ((errors++))
  else
    fm_end=$((closing_line + 1))
    frontmatter="$(sed -n "2,$((fm_end - 1))p" "$file")"

    for field in status date author; do
      value="$(echo "$frontmatter" | grep -E "^${field}:" | sed "s/^${field}:[[:space:]]*//" | sed 's/^["'"'"']//' | sed 's/["'"'"']$//' | xargs)"
      if [[ -z "$value" ]]; then
        echo "ERROR: Required frontmatter field '${field}' is missing or empty"
        ((errors++))
      else
        case "$field" in
          status)
            if ! echo "$value" | grep -qE '^(draft|proposed|accepted|in-progress|done)$'; then
              echo "ERROR: Invalid status '${value}' — must be one of: draft, proposed, accepted, in-progress, done"
              ((errors++))
            fi
            ;;
          date)
            if ! echo "$value" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
              if echo "$value" | grep -qF '{'; then
                echo "WARN: Date field contains unfilled placeholder"
                ((warns++))
              else
                echo "ERROR: Invalid date format '${value}' — must be YYYY-MM-DD"
                ((errors++))
              fi
            fi
            ;;
        esac
      fi
    done
  fi
fi

# --- Required sections ---

for section in "Problem" "Proposed Solution"; do
  if ! grep -qE "^## ${section}" "$file"; then
    echo "ERROR: Missing required section '## ${section}'"
    ((errors++))
  fi
done

# --- Line count ---

if [[ "$lines" -gt 300 ]]; then
  echo "ERROR: File is ${lines} lines — hard cap is 300"
  ((errors++))
elif [[ "$lines" -gt 250 ]]; then
  echo "WARN: File is ${lines} lines — recommended max is 250"
  ((warns++))
fi

# --- Unfilled placeholders ---

placeholder_count="$(grep -oE '\{[^}]+\}' "$file" | wc -l | tr -d ' ')"
if [[ "$placeholder_count" -gt 0 ]]; then
  echo "WARN: Found ${placeholder_count} unfilled {…} placeholders"
  ((warns++))
fi

# --- Summary ---

if [[ "$errors" -gt 0 ]]; then
  echo "Validation failed: ${errors} error(s), ${warns} warning(s)"
  exit 1
fi

if [[ "$warns" -gt 0 ]]; then
  echo "Validation passed with ${warns} warning(s)"
fi

exit 0
