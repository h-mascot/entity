#!/bin/bash
# Entity dev server - connects to Mission Control DB on ada-gateway
export ENTITY_DB_MODE=CLOUD
export ENTITY_CLOUD_API_BASE=http://100.106.69.9:3000

# Feature flags - enable all new features
export ENTITY_FS_MULTISOURCE=true
export ENTITY_AGENT_NATIVE_EDITOR=true

# Start server + app in parallel
cd "."
echo "Entity dev server (DB: CLOUD -> $ENTITY_CLOUD_API_BASE)"
echo "File System: enabled"
echo "Agent-Native Editor: enabled"
npx ts-node packages/server/src/index.ts &
SERVER_PID=$!
cd packages/app && VITE_ENTITY_FS_MULTISOURCE=true VITE_ENTITY_AGENT_NATIVE_EDITOR=true npx vite &
APP_PID=$!

trap "kill $SERVER_PID $APP_PID 2>/dev/null" EXIT
wait
