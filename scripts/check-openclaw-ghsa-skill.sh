#!/usr/bin/env bash
set -euo pipefail

skill_slug="${OPENCLAW_GHSA_SKILL_SLUG:-openclaw-ghsa-maintainer}"

skill_dirs=(
  "$HOME/.openclaw/skills"
  "$HOME/.agents/skills"
  "/usr/lib/node_modules/openclaw/skills"
  "/usr/local/lib/node_modules/openclaw/skills"
)

found=0

printf "OpenClaw GHSA skill verification
"
printf "skill: %s
" "$skill_slug"
printf "host: %s
" "$(hostname)"
printf "user: %s
" "$(whoami)"
printf "checked_at_utc: %s
" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf "openclaw_bin: %s
" "$(command -v openclaw || echo not-found)"
if command -v openclaw >/dev/null 2>&1; then
  printf "openclaw_version: %s
" "$(openclaw --version 2>/dev/null || echo unavailable)"
fi

printf "
Search paths:
"
for dir in "${skill_dirs[@]}"; do
  printf -- "- %s
" "$dir"
  candidate="$dir/$skill_slug/SKILL.md"
  if [[ -f "$candidate" ]]; then
    found=1
    printf "  FOUND: %s
" "$candidate"
  fi
done

printf "
Fallback search:
"
search_roots=("$HOME/.openclaw" "$HOME/.agents" "/usr/lib/node_modules/openclaw" "/usr/local/lib/node_modules/openclaw")
for root in "${search_roots[@]}"; do
  [[ -d "$root" ]] || continue
  matches="$(find "$root" -maxdepth 4 -type f \( -name 'SKILL.md' -o -name '*.md' -o -name '*.json' \) 2>/dev/null | grep -i "$skill_slug" || true)"
  if [[ -n "$matches" ]]; then
    printf "%s
" "$matches"
    found=1
  fi
done

printf "
Result: "
if [[ "$found" -eq 1 ]]; then
  printf "FOUND
"
else
  printf "NOT_FOUND
"
  exit 1
fi

