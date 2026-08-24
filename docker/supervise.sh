#!/bin/sh
set -eu

node /app/packages/server/dist/server/src/index.js &
entity_pid=$!
caddy run --config /app/docker/Caddyfile --adapter caddyfile &
proxy_pid=$!
shutting_down=0

shutdown() {
  [ "$shutting_down" -eq 1 ] && return
  shutting_down=1
  trap - INT TERM EXIT
  kill -TERM "$entity_pid" "$proxy_pid" 2>/dev/null || true
  wait "$entity_pid" 2>/dev/null || true
  wait "$proxy_pid" 2>/dev/null || true
}

trap shutdown INT TERM EXIT

while kill -0 "$entity_pid" 2>/dev/null && kill -0 "$proxy_pid" 2>/dev/null; do
  sleep 1
done

status=1
if ! kill -0 "$entity_pid" 2>/dev/null; then
  wait "$entity_pid" || status=$?
elif ! kill -0 "$proxy_pid" 2>/dev/null; then
  wait "$proxy_pid" || status=$?
fi
shutdown
exit "$status"
