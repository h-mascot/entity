#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

entity_mc_parse_common_args "$@"

mkdir -p "$ENTITY_MC_INSTALL_DIR" "$ENTITY_MC_BIN_DIR"
if [[ "$ENTITY_MC_INSTALL_DIR" != "$ENTITY_MC_SKILL_DIR" ]]; then
  cp -R "$ENTITY_MC_SKILL_DIR"/. "$ENTITY_MC_INSTALL_DIR"/
fi

cat > "$ENTITY_MC_BIN_DIR/entity-mc" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec "$ENTITY_MC_INSTALL_DIR/source-scripts/mc.sh" "\$@"
EOF
chmod +x "$ENTITY_MC_BIN_DIR/entity-mc"

entity_mc_write_config

cat <<EOF
INSTALL_OK
$(entity_mc_status_json)
EOF
