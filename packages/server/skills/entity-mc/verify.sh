#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

entity_mc_parse_common_args "$@"
entity_mc_load_config

[[ -d "$ENTITY_MC_INSTALL_DIR" ]] || entity_mc_fail "install dir missing: $ENTITY_MC_INSTALL_DIR"
[[ -x "$ENTITY_MC_INSTALL_DIR/source-scripts/mc.sh" ]] || entity_mc_fail "mc.sh missing or not executable"

if [[ -n "$ENTITY_MC_ENTITY_URL" && -n "$ENTITY_MC_ONBOARDING_TOKEN" ]]; then
  entity_mc_request GET "/api/onboarding/agent-session/$(entity_mc_token)/manifest" >/dev/null
fi

cat <<EOF
VERIFY_OK
$(entity_mc_status_json)
EOF
