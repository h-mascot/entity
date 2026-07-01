#!/usr/bin/env bash
# open-loop-pr.sh — deterministic git + PR step for repo automation loops.
#
# The Cursor agent step only edits files (restricted autonomy). This script does
# every privileged git/GitHub action, so branch creation, commit, push, and PR
# opening stay auditable and out of the agent's hands.
#
# Usage:
#   open-loop-pr.sh <slug> <commit-subject> <pr-title> [pr-body-file]
#
# Env:
#   GH_TOKEN / GITHUB_TOKEN — required for `gh pr create` and push auth in CI.
#   LOOP_PR_BASE            — base branch for the PR (default: main).
set -euo pipefail

slug="${1:?slug required}"
subject="${2:?commit subject required}"
title="${3:?pr title required}"
body_file="${4:-}"
base="${LOOP_PR_BASE:-main}"

if [ -z "$(git status --porcelain)" ]; then
  echo "No changes produced by the '${slug}' loop — nothing to commit."
  exit 0
fi

stamp="$(date -u +%Y%m%d-%H%M%S)"
branch="loops/${slug}-${stamp}"

git config user.name "entity-loops[bot]"
git config user.email "entity-loops@users.noreply.github.com"

git checkout -b "$branch"
git add -A
git commit -m "$subject"
git push -u origin "$branch"

if command -v gh >/dev/null 2>&1; then
  if [ -n "$body_file" ] && [ -f "$body_file" ]; then
    gh pr create --base "$base" --head "$branch" --title "$title" --body-file "$body_file"
  else
    gh pr create --base "$base" --head "$branch" --title "$title" \
      --body "Automated '${slug}' loop run (${stamp}). Review before merging."
  fi
  echo "Opened PR from ${branch} into ${base}."
else
  echo "gh CLI unavailable; pushed ${branch}. Open a PR into ${base} manually."
fi
