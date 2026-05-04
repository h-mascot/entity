#!/bin/bash
# Ralph Loop x5 for Entity × Mission Control Integration
# Uses Codex CLI (gpt-5.3-codex from config)

set -e
cd ~/Code/entity

export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"

RALPH_DIR="scripts/ralph"
MAX_LOOPS=5
LOG_FILE="$RALPH_DIR/integration-run.log"

echo "🚀 Ralph Loop x5 — Entity × MC Integration" | tee "$LOG_FILE"
echo "Model: gpt-5.3-codex (high reasoning)" | tee -a "$LOG_FILE"
echo "Started: $(date)" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

for i in $(seq 1 $MAX_LOOPS); do
  echo "" | tee -a "$LOG_FILE"
  echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
  echo "  Ralph Iteration $i of $MAX_LOOPS" | tee -a "$LOG_FILE"
  echo "  $(date)" | tee -a "$LOG_FILE"
  echo "═══════════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"

  # Check remaining stories
  REMAINING=$(python3 -c "import json; d=json.load(open('$RALPH_DIR/integration-prd.json')); print(len([s for s in d['userStories'] if not s['passes']]))")
  if [ "$REMAINING" -eq 0 ]; then
    echo "🎉 ALL INTEGRATION STORIES COMPLETE!" | tee -a "$LOG_FILE"
    break
  fi

  # Get next story
  NEXT=$(python3 -c "import json; d=json.load(open('$RALPH_DIR/integration-prd.json')); stories=[s for s in d['userStories'] if not s['passes']]; s=sorted(stories, key=lambda x: x['priority'])[0]; print(f'{s[\"id\"]}: {s[\"title\"]}')")
  echo "📝 Next story: $NEXT" | tee -a "$LOG_FILE"

  # Build the prompt
  TASK="You are working on the Entity × Mission Control integration project.

$(cat $RALPH_DIR/integration-prompt.md)

Current integration-prd.json:
$(cat $RALPH_DIR/integration-prd.json)

IMPORTANT: 
1. Implement the FIRST story with passes: false (story: $NEXT)
2. After implementation, run 'cd packages/app && npm run build' to verify it compiles
3. If build succeeds, update scripts/ralph/integration-prd.json to set passes: true for that story
4. Create or update scripts/ralph/progress.txt with what you learned
5. Git add and commit your changes with message 'feat: [story title]'"

  # Run Codex with default model (gpt-5.3-codex from config)
  echo "$TASK" | npx @openai/codex exec --full-auto 2>&1 | tee -a "$LOG_FILE"

  # Status update
  DONE=$(python3 -c "import json; d=json.load(open('$RALPH_DIR/integration-prd.json')); print(len([s for s in d['userStories'] if s['passes']]))")
  TOTAL=$(python3 -c "import json; d=json.load(open('$RALPH_DIR/integration-prd.json')); print(len(d['userStories']))")
  echo "" | tee -a "$LOG_FILE"
  echo "📊 Progress: $DONE/$TOTAL stories complete" | tee -a "$LOG_FILE"
done

echo "" | tee -a "$LOG_FILE"
echo "Finished: $(date)" | tee -a "$LOG_FILE"
echo "🏁 Ralph Integration Loop complete." | tee -a "$LOG_FILE"
