#!/bin/sh
set -eu

: "${ENTITY_API_TOKEN:?ENTITY_API_TOKEN is required for an internet-facing deployment}"
: "${ENTITY_DEFAULT_DOCUMENTS_TOKEN:?ENTITY_DEFAULT_DOCUMENTS_TOKEN is required}"
: "${ENTITY_CUSTOMER_ACCESS_TOKEN:?ENTITY_CUSTOMER_ACCESS_TOKEN is required}"
: "${ENTITY_BASIC_AUTH_USER:?ENTITY_BASIC_AUTH_USER is required}"
: "${ENTITY_BASIC_AUTH_HASH:?ENTITY_BASIC_AUTH_HASH is required}"
: "${ENTITY_TASK_DB_PATH:=/data/entity.sqlite}"

if [ "${#ENTITY_API_TOKEN}" -lt 32 ]; then
  echo "ENTITY_API_TOKEN must contain at least 32 characters" >&2
  exit 78
fi
if [ "${#ENTITY_DEFAULT_DOCUMENTS_TOKEN}" -lt 32 ]; then
  echo "ENTITY_DEFAULT_DOCUMENTS_TOKEN must contain at least 32 characters" >&2
  exit 78
fi
if [ "${#ENTITY_CUSTOMER_ACCESS_TOKEN}" -lt 32 ]; then
  echo "ENTITY_CUSTOMER_ACCESS_TOKEN must contain at least 32 characters" >&2
  exit 78
fi

umask 077
mkdir -p "$(dirname "$ENTITY_TASK_DB_PATH")" /workspace/home /workspace/output /workspace/memory /workspace/logs /workspace/caddy/config /workspace/caddy/data
node /app/docker/bootstrap-principals.cjs

exec dumb-init -- "$@"
