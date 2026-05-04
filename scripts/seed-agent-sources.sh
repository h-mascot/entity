#!/usr/bin/env bash
set -euo pipefail

API_BASE="${ENTITY_API_BASE:-${VITE_ENTITY_API_BASE:-http://127.0.0.1:3001}}"
API_BASE="${API_BASE%/}"

pick_sources_endpoint() {
  local fs_endpoint="${API_BASE}/api/fs/sources"
  local legacy_endpoint="${API_BASE}/api/sources"

  if curl -fsS "${fs_endpoint}" >/dev/null 2>&1; then
    printf '%s' "${fs_endpoint}"
    return 0
  fi

  if curl -fsS "${legacy_endpoint}" >/dev/null 2>&1; then
    printf '%s' "${legacy_endpoint}"
    return 0
  fi

  echo "Unable to reach sources endpoint at ${fs_endpoint} or ${legacy_endpoint}." 1>&2
  return 1
}

SOURCES_ENDPOINT="$(pick_sources_endpoint)"
echo "Using sources endpoint: ${SOURCES_ENDPOINT}"

tmp_sources_json="$(mktemp)"
trap 'rm -f "${tmp_sources_json}"' EXIT
curl -fsS "${SOURCES_ENDPOINT}?includeDisabled=1" >"${tmp_sources_json}"

source_exists() {
  local id="$1"
  local base_url="$2"

  node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const id = process.argv[2];
    const baseUrl = process.argv[3];
    const sources = Array.isArray(data.sources) ? data.sources : [];
    const found = sources.some((s) => s && (s.id === id || (baseUrl && s.baseUrl === baseUrl)));
    process.exit(found ? 0 : 1);
  ' "${tmp_sources_json}" "${id}" "${base_url}"
}

create_source() {
  local id="$1"
  local display_name="$2"
  local base_url="$3"
  local icon="$4"

  local payload
  payload="$(node -e '
    const payload = {
      id: process.argv[1],
      displayName: process.argv[2],
      type: "docsify",
      baseUrl: process.argv[3],
      enabled: true,
      icon: process.argv[4],
    };
    process.stdout.write(JSON.stringify(payload));
  ' "${id}" "${display_name}" "${base_url}" "${icon}")"

  curl -fsS \
    -X POST \
    -H 'Content-Type: application/json' \
    "${SOURCES_ENDPOINT}" \
    -d "${payload}" >/dev/null
}

declare -a SOURCE_IDS=("ada" "spock" "scotty" "vault")
declare -a SOURCE_NAMES=("Ada 🔮" "Spock 🖖" "Scotty 🔧" "Obsidian Vault")
declare -a SOURCE_URLS=("http://100.106.69.9:8788" "http://100.106.69.9:8789" "http://100.68.207.75:8788" "http://100.86.150.96:8787")
declare -a SOURCE_ICONS=("🔮" "🖖" "🔧" "📚")

for i in "${!SOURCE_IDS[@]}"; do
  id="${SOURCE_IDS[$i]}"
  name="${SOURCE_NAMES[$i]}"
  url="${SOURCE_URLS[$i]}"
  icon="${SOURCE_ICONS[$i]}"

  if source_exists "${id}" "${url}"; then
    echo "Exists: ${id} (${url})"
    continue
  fi

  echo "Creating: ${id} (${url})"
  create_source "${id}" "${name}" "${url}" "${icon}"
done

echo "Done."

