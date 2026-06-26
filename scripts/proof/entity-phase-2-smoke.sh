#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "[entity-phase-2-smoke] repo=$ROOT"
echo "[entity-phase-2-smoke] node=$(node -v 2>/dev/null || true) npm=$(npm -v 2>/dev/null || true)"

if [ ! -f AGENTS.md ]; then echo "missing AGENTS.md" >&2; exit 1; fi
if [ ! -f docs/context/entity-phase-2-build-context.md ]; then echo "missing Phase 2 context" >&2; exit 1; fi
if [ ! -f docs/specs/entity-phase-2-prd-canonical-20260620.md ]; then echo "missing canonical PRD" >&2; exit 1; fi

echo "[entity-phase-2-smoke] checking package scripts"
node - <<'NODE'
const pkg=require('./package.json');
for (const s of ['build','ctrl:gate']) {
  if (!pkg.scripts || !pkg.scripts[s]) { throw new Error(`missing script ${s}`); }
  console.log(`${s}: ${pkg.scripts[s]}`);
}
NODE

echo "[entity-phase-2-smoke] server build + tests"
(cd packages/server && npm run build && npx vitest run)

echo "[entity-phase-2-smoke] root build"
npm run build

echo "[entity-phase-2-smoke] PASS"
