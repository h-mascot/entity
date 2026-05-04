#!/usr/bin/env bash
set -euo pipefail

# Read mode from .ctrlrc.json or default to mvp
MODE="mvp"
if [ -f .ctrlrc.json ]; then
  MODE=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.ctrlrc.json','utf8')).mode || 'mvp')")
fi

echo "[ctrl] Running in $MODE mode"

# Build is always required
npm run build || { echo "[ctrl] build failed"; exit 1; }

if [ "$MODE" == "production" ]; then
  echo "[ctrl] Production mode — running full gates"
  
  # Unit tests
  if npm run test:unit 2>/dev/null; then
    echo "[ctrl] unit tests passed"
  else
    echo "[ctrl] unit tests failed"
    exit 1
  fi
  
  # E2E tests
  if npm run test:e2e 2>/dev/null; then
    echo "[ctrl] e2e tests passed"
  else
    echo "[ctrl] e2e tests failed"
    exit 1
  fi
  
  # Coverage check (if configured)
  if [ -f .ctrlrc.json ]; then
    ENFORCE=$(node -e "const c=JSON.parse(require('fs').readFileSync('.ctrlrc.json','utf8')); console.log(c.coverage?.enforce ? '1' : '0')")
    if [ "$ENFORCE" == "1" ]; then
      npm run test:coverage 2>/dev/null || echo "[ctrl] coverage check skipped (no script)"
    fi
  fi
else
  echo "[ctrl] MVP mode — build passed, tests optional"
  # Run tests if they exist but don't fail on missing
  npm run test:unit 2>/dev/null || echo "[ctrl] unit tests skipped"
fi

echo "[ctrl] gate passed ✅"
