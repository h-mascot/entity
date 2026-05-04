#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"

if ! command -v git >/dev/null 2>&1; then
  echo "[release-check] git is required for deploy safety checks" >&2
  exit 1
fi

if ! git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[release-check] ${REPO_ROOT} is not a git work tree" >&2
  exit 1
fi

HEAD_SHA="$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
BRANCH_NAME="$(git -C "${REPO_ROOT}" rev-parse --abbrev-ref HEAD)"
STATUS_OUTPUT="$(git -C "${REPO_ROOT}" status --short --untracked-files=normal)"

if [[ -n "${STATUS_OUTPUT}" ]]; then
  echo "[release-check] Refusing deploy from dirty worktree at ${REPO_ROOT}" >&2
  echo "[release-check] Branch: ${BRANCH_NAME} @ ${HEAD_SHA}" >&2
  echo "[release-check] Commit or stash changes, or rerun with ENTITY_ALLOW_DIRTY_DEPLOY=1 if you really mean it" >&2
  echo "${STATUS_OUTPUT}" >&2
  exit 1
fi

echo "[release-check] OK: ${BRANCH_NAME} @ ${HEAD_SHA} is clean"
