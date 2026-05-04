#!/bin/bash
# Ralph loop runner for MC Agent-Native Editor
# - Executes one PRD story per iteration via Codex exec
# - Pauses automatically at 50% completion for manual frontend testing

set -euo pipefail

cd ~/Code/entity

export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"

RALPH_DIR="scripts/ralph"
PRD_FILE="$RALPH_DIR/mc-agent-native-editor-prd.json"
PROMPT_FILE="$RALPH_DIR/mc-agent-native-editor-prompt.md"
PROGRESS_FILE="$RALPH_DIR/mc-agent-native-editor-progress.txt"
LOG_FILE="$RALPH_DIR/mc-agent-native-editor-run.log"
CHECKPOINT_FILE="$RALPH_DIR/.mc-agent-native-editor-50pct"

MAX_RUNTIME_MINUTES="${MAX_RUNTIME_MINUTES:-45}"
MAX_LOOPS="${1:-40}"
RESUME_AFTER_50="${RESUME_AFTER_50:-0}"
ITERATION_TIMEOUT_SEC="${ITERATION_TIMEOUT_SEC:-900}"

if [ ! -f "$PRD_FILE" ]; then
  echo "Missing PRD file: $PRD_FILE" >&2
  exit 1
fi

if [ ! -f "$PROMPT_FILE" ]; then
  echo "Missing prompt file: $PROMPT_FILE" >&2
  exit 1
fi

if [ ! -f "$PROGRESS_FILE" ]; then
  cat > "$PROGRESS_FILE" <<'PROGRESS'
# MC Agent-Native Editor Ralph Progress

## Notes
- Initialized runner and PRD.
PROGRESS
fi

TOTAL=$(python3 -c "import json; d=json.load(open('$PRD_FILE')); print(len(d['userStories']))")
HALF=$((TOTAL / 2))

if [ "$HALF" -lt 1 ]; then
  HALF=1
fi

# If the user already acknowledged the 50% checkpoint, keep it marked so the
# runner won't pause repeatedly on subsequent resumes.
if [ "$RESUME_AFTER_50" = "1" ]; then
  touch "$CHECKPOINT_FILE"
fi

echo "Ralph Loop — MC Agent-Native Editor" | tee "$LOG_FILE"
echo "PRD: $PRD_FILE" | tee -a "$LOG_FILE"
echo "Started: $(date)" | tee -a "$LOG_FILE"
echo "Target loops: $MAX_LOOPS" | tee -a "$LOG_FILE"
echo "Max runtime: $MAX_RUNTIME_MINUTES min" | tee -a "$LOG_FILE"
echo "50% checkpoint: $HALF/$TOTAL" | tee -a "$LOG_FILE"

START_TIME=$(date +%s)
MAX_RUNTIME_SEC=$((MAX_RUNTIME_MINUTES * 60))

for i in $(seq 1 "$MAX_LOOPS"); do
  NOW=$(date +%s)
  ELAPSED=$((NOW - START_TIME))
  
  echo "" | tee -a "$LOG_FILE"
  echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
  echo "  Iteration $i of $MAX_LOOPS" | tee -a "$LOG_FILE"
  echo "  Elapsed: $((ELAPSED/60)) min" | tee -a "$LOG_FILE"
  echo "  $(date)" | tee -a "$LOG_FILE"
  echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"

  REMAINING=$(python3 -c "import json; d=json.load(open('$PRD_FILE')); print(len([s for s in d['userStories'] if not s['passes']]))")
  if [ "$REMAINING" -eq 0 ]; then
    echo "ALL STORIES COMPLETE" | tee -a "$LOG_FILE"
    break
  fi

  if [ "$ELAPSED" -gt "$MAX_RUNTIME_SEC" ]; then
    echo "MAX RUNTIME REACHED ($MAX_RUNTIME_MINUTES min). Stopping." | tee -a "$LOG_FILE"
    echo "Resume with: MAX_RUNTIME_MINUTES=90 $0" | tee -a "$LOG_FILE"
    break
  fi

  NEXT=$(python3 -c "import json; d=json.load(open('$PRD_FILE')); stories=[s for s in d['userStories'] if not s['passes']]; s=sorted(stories, key=lambda x: x['priority'])[0]; print(f\"{s['id']}: {s['title']}\")")
  echo "Next story: $NEXT" | tee -a "$LOG_FILE"

  NEXT_JSON=$(python3 - <<'PY'
import json
from pathlib import Path
p = Path('scripts/ralph/mc-agent-native-editor-prd.json')
d = json.loads(p.read_text())
story = sorted([s for s in d["userStories"] if not s["passes"]], key=lambda x: x["priority"])[0]
print(json.dumps(story, indent=2))
PY
)

  TASK="You are implementing the MC Agent-Native Editor roadmap.

$(cat "$PROMPT_FILE")

Target story (must complete exactly this one):
$NEXT_JSON

IMPORTANT:
1. Implement ONLY this target story.
2. Run relevant build checks for touched packages.
3. Mark only this story passes:true when acceptance criteria are met.
4. Append progress notes to $PROGRESS_FILE.
5. Use non-destructive git operations only."

  set +e
  echo "$TASK" | timeout "${ITERATION_TIMEOUT_SEC}" npx @openai/codex exec --full-auto 2>&1 | tee -a "$LOG_FILE"
  CODEX_EXIT=${PIPESTATUS[1]}
  set -e

  if [ "$CODEX_EXIT" -ne 0 ]; then
    echo "Iteration failed or timed out (exit=$CODEX_EXIT). Continuing to next loop attempt." | tee -a "$LOG_FILE"
    continue
  fi

  DONE=$(python3 -c "import json; d=json.load(open('$PRD_FILE')); print(len([s for s in d['userStories'] if s['passes']]))")
  echo "Progress: $DONE/$TOTAL stories complete" | tee -a "$LOG_FILE"

  if [ "$DONE" -ge "$HALF" ] && [ ! -f "$CHECKPOINT_FILE" ]; then
    touch "$CHECKPOINT_FILE"
    echo "" | tee -a "$LOG_FILE"
    echo "FRONTEND TEST CHECKPOINT REACHED (50%)" | tee -a "$LOG_FILE"
    echo "Please test frontend behavior before continuing." | tee -a "$LOG_FILE"
    echo "Resume with: RESUME_AFTER_50=1 $RALPH_DIR/run-mc-agent-native-editor.sh" | tee -a "$LOG_FILE"
    break
  fi
done

echo "" | tee -a "$LOG_FILE"
echo "Finished: $(date)" | tee -a "$LOG_FILE"
echo "Loop finished." | tee -a "$LOG_FILE"
