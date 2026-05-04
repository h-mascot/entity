#!/bin/bash
# Gather agent health and cost metrics as JSON

# System health
CPU=$(top -bn1 | grep 'Cpu(s)' | awk '{print $2}')
MEM_USED=$(free -m | awk '/Mem:/{print $3}')
MEM_TOTAL=$(free -m | awk '/Mem:/{print $2}')
MEM_PCT=$(awk "BEGIN{printf \"%.1f\", $MEM_USED/$MEM_TOTAL*100}")
UPTIME_SECS=$(awk '{print int($1)}' /proc/uptime)
LOAD=$(cat /proc/loadavg | awk '{print $1}')

# Per-agent token usage from session files
SESSIONS_DIR="/home/henrymascot/.openclaw/agents"

get_agent_tokens() {
  local agent=$1
  local file="$SESSIONS_DIR/$agent/sessions/sessions.json"
  if [ -f "$file" ]; then
    python3 -c "
import json
with open('$file') as f:
    data = json.load(f)
total_in = 0
total_out = 0
total_ctx = 0
for k,v in data.items():
    if isinstance(v, dict):
        total_in += v.get('inputTokens', 0)
        total_out += v.get('outputTokens', 0)
        total_ctx += v.get('totalTokens', 0)
# Rough cost estimate: opus=$15/Mtok in, $75/Mtok out
cost = (total_in * 15 + total_out * 75) / 1000000
print(json.dumps({'inputTokens': total_in, 'outputTokens': total_out, 'contextTokens': total_ctx, 'estimatedCost': round(cost, 2)}))
" 2>/dev/null
  else
    echo '{"inputTokens":0,"outputTokens":0,"contextTokens":0,"estimatedCost":0}'
  fi
}

# Gateway process health
GW_PID=$(pgrep -f 'openclaw-gateway' | head -1)
GW_CPU="0"
GW_MEM="0"
if [ -n "$GW_PID" ]; then
  GW_STATS=$(ps -p $GW_PID -o %cpu,%mem --no-headers 2>/dev/null)
  GW_CPU=$(echo $GW_STATS | awk '{print $1}')
  GW_MEM=$(echo $GW_STATS | awk '{print $2}')
fi

# Build JSON
cat << EOF
{
  "system": {
    "cpuPercent": $CPU,
    "memUsedMb": $MEM_USED,
    "memTotalMb": $MEM_TOTAL,
    "memPercent": $MEM_PCT,
    "uptimeSeconds": $UPTIME_SECS,
    "loadAvg": $LOAD
  },
  "gateway": {
    "pid": ${GW_PID:-0},
    "cpuPercent": ${GW_CPU:-0},
    "memPercent": ${GW_MEM:-0}
  },
  "agents": {
    "main": $(get_agent_tokens main),
    "spock": $(get_agent_tokens spock),
    "scotty": $(get_agent_tokens scotty)
  }
}
EOF
