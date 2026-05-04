# PRD: Agent Dashboard Real-Time Accuracy Fix

## Problem
The Agents view shows stale/incorrect data across multiple dimensions:

### Current Issues
1. **Ada's activity "8h ago"** — Ada is actively working right now but the dashboard shows stale activity
2. **Task counts wrong** — Shows "Doing 89" when actual is 19 (after cleanup)
3. **Spock gateway wrong** — Shows "ada-gateway" but Spock runs on spock-gateway (100.78.229.38:18789)
4. **Agent "currently editing" stale** — Shows index.ts/README.md which aren't current
5. **Geordi "Working on" stale** — Shows a task that was moved to backlog
6. **Stats all zeros** — Files: 0, msgs: 0, err: 0 for agents that are clearly active
7. **Agent models incorrect** — Spock shows kimi-for-coding but may be running a different model

## Root Causes

### 1. OpenClaw API endpoint mismatch
The Entity server calls `${OPENCLAW}/api/agents` but OpenClaw serves HTML at that path (control UI). 
Need to find the correct OpenClaw API path for agent data, or use a different data source.

**Fix:** Check OpenClaw API docs for correct endpoint. Likely needs auth header or different path.

### 2. Fallback data is hardcoded and stale
When the OpenClaw API call fails, Entity falls back to a hardcoded agent list with wrong gateway info for Spock.

**Fix:** Update fallback in `packages/server/src/index.ts` line ~925:
```typescript
{ id: 'spock', name: 'Spock', emoji: '🖖', model: 'anthropic/claude-sonnet-4-5', gateway: 'spock-gateway' },
```

### 3. Task counts not refreshed
The task count shown per agent comes from a one-time query, not live.

**Fix:** Task counts should refresh on every page load, pulling from the `/api/tasks` endpoint and counting per assignee.

### 4. Activity stream not connected to real agent work
Activities come from task updates only, not from actual agent sessions (tool calls, messages, file edits).

**Fix:** For real-time agent activity, Entity needs to:
- Poll each gateway's session activity endpoint every 30-60 seconds
- OR receive WebSocket updates when agents do work
- The activity sparkline graph should reflect session activity, not just task column moves

### 5. "Currently editing" is fictional
There's no real mechanism feeding what file each agent is editing.

**Fix:** Either:
- Remove "Currently editing" (if we can't source it reliably)
- OR poll OpenClaw's active session for recent file operations

### 6. Agent current task needs to reflect MC board state
"CURRENT TASK" should pull the agent's top priority task from the Doing column, refreshed on each page load.

**Fix:** Query `/api/tasks?column=doing&assignee={agent}` and show the highest priority one.

## Implementation Plan

### Phase 1: Fix static data (P0 - immediate)
1. Fix Spock gateway in fallback config → "spock-gateway"
2. Fix Spock model in fallback config → match actual
3. Add correct OpenClaw API paths with auth headers
4. Remove or hide "Currently editing" until we have real data

### Phase 2: Real-time task data (P0 - today)
1. Task counts per agent: query from `/api/tasks` and count by assignee
2. Current task per agent: highest priority task in Doing column for that agent
3. Refresh on page load + every 60 seconds via polling or WebSocket

### Phase 3: Activity stream (P1 - this week)
1. For each remote agent gateway (Spock, Scotty), poll their session activity
2. Agent gateways:
   - Ada: http://100.106.69.9:18789 (local - use OPENCLAW env var)
   - Spock: http://100.78.229.38:18789
   - Scotty: http://100.68.207.75:18789
   - Geordi: SSH-based (Mac Codex - check tmux sessions)
   - Zora: http://100.86.150.96:18791
3. Activity sparkline should show actual session starts/tool calls per hour
4. Stats (files, msgs, err) should aggregate from session data

### Phase 4: Live status (P2)
1. WebSocket connection to each gateway for real-time status
2. Show "thinking..." / "running tool..." / "idle" states
3. True "currently working on" based on active session context

## Agent Config (correct values)

```typescript
const AGENT_GATEWAYS = {
  main: { name: 'Ada', gateway: 'ada-gateway', url: 'http://100.106.69.9:18789', model: 'anthropic/claude-opus-4-6' },
  spock: { name: 'Spock', gateway: 'spock-gateway', url: 'http://100.78.229.38:18789', model: 'anthropic/claude-sonnet-4-5' },
  scotty: { name: 'Scotty', gateway: 'castlemascot-r1', url: 'http://100.68.207.75:18789', model: 'anthropic/claude-sonnet-4-5' },
  geordi: { name: 'Geordi', gateway: 'MascotM3', url: null, model: 'openai-codex/gpt-5.3-codex' },
  zora: { name: 'Zora', gateway: 'MascotM3', url: 'http://100.86.150.96:18791', model: 'google/gemini-3-flash-preview' },
};
```

## Success Criteria
- Agent page loads with correct task counts within 2 seconds
- Current task reflects actual MC board state
- Activity shows events from the last hour, not 8+ hours ago
- Spock shows correct gateway (spock-gateway)
- No "currently editing" unless we have real data
- Stats show real numbers, not zeros

## Effort
- Phase 1: 30 minutes (config fix)
- Phase 2: 2 hours (task data integration)
- Phase 3: 3 hours (multi-gateway polling)
- Phase 4: 4 hours (WebSocket live status)
