#!/usr/bin/env bash
set -euo pipefail
if ! command -v docker >/dev/null 2>&1; then
  echo "[ctrl-docker] skipped (docker missing)"
  exit 0
fi
docker run --rm -v "$PWD":/app -w /app node:22-bullseye bash -lc 'npm ci && npm test'
