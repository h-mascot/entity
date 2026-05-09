#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

entity_mc_parse_common_args "$@"

rm -f "$ENTITY_MC_BIN_DIR/entity-mc"
rm -rf "$ENTITY_MC_INSTALL_DIR"

cat <<EOF
ROLLBACK_OK
installDir=$ENTITY_MC_INSTALL_DIR
bin=$ENTITY_MC_BIN_DIR/entity-mc
EOF
