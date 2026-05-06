#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/mc.sh" config >/dev/null
"$SCRIPT_DIR/mc.sh" tasks >/dev/null
echo "ENTITY_MC_HEALTH_OK"
