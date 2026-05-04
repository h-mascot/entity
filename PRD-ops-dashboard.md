# PRD: Entity Ops Dashboard - Cron Health, System Status, and Agent Enrichment

## Overview

Add three new operational views to Entity that surface live infrastructure data from the OpenClaw gateway API. These views complement the existing task board and file editor without touching the Enterprise Crew Admin (ECA) app, which continues to run in its iframe embed for admin/config work.

Entity's server already connects to OpenClaw at `OPENCLAW` env var (default: `http://100.106.69.9:18789`). The new features use the same gateway HTTP API - no SSH, no filesystem reads.

## Architecture Context

- Entity server: Express + WebSocket (packages/server/src/index.ts)
- Entity frontend: React + Vite (packages/app/src/)
- Entity already has: `runtime.openclawBase` config for OpenClaw gateway URL
- Entity already has: WebSocket broadcast infrastructure for live updates
- Entity already has: MCHeader with tabs ('kanban' | 'insights'), MCAgentsView, MCOpsView, MCStrategicView
- OpenClaw gateway exposes: `/api/cron` (list/manage cron jobs), `/api/agents` (agent list), health data via the gateway dashboard

## Feature 1: Cron Health Dashboard

### What
A new MC tab "Crons" showing all cron jobs with live status indicators.

### Server API

Add to `packages/server/src/index.ts`:

```
GET /api/ops/crons
```

This proxies to the OpenClaw gateway's cron list endpoint. The gateway token is needed for auth.

**Implementation:**
```typescript
app.get('/api/ops/crons', async (_req, res) => {
  try {
    const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || '';
    const response = await fetch(`${OPENCLAW}/api/cron/jobs`, {
      headers: {
        'Authorization': `Bearer ${gatewayToken}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cron fetch failed';
    res.status(502).json({ error: message });
  }
});
```

Note: The exact OpenClaw cron API endpoint may need discovery. Check the gateway dashboard at `${OPENCLAW}/` for the correct path. Common patterns: `/api/cron/jobs`, `/cron/list`, or the gateway may use a different auth scheme. If the gateway token approach doesn't work, try without auth first (it may be open on localhost).

### Frontend Component

New file: `packages/app/src/components/mission-control/MCCronView.tsx`

**Data shape per cron job (from OpenClaw API):**
```typescript
type CronJob = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: {
    kind: 'cron' | 'every' | 'at';
    expr?: string;       // for cron kind
    everyMs?: number;    // for every kind
    tz?: string;
  };
  sessionTarget: 'isolated' | 'main';
  payload: {
    kind: 'agentTurn' | 'systemEvent';
    message?: string;
    model?: string;
  };
  state?: {
    lastRunAtMs?: number;
    lastStatus?: 'ok' | 'error';
    lastDurationMs?: number;
    lastError?: string;
    consecutiveErrors?: number;
    nextRunAtMs?: number;
  };
  delivery?: {
    mode: string;
    channel?: string;
    to?: string;
  };
};
```

**UI layout:**
- Table/list view with columns: Status dot | Name | Schedule | Model | Last Run | Duration | Next Run
- Status dot: green (ok), red (error), gray (never ran), yellow (disabled)
- Click a row to expand and see: full payload message, last error text, delivery config
- Filter bar: All | Enabled | Failing | Disabled
- Sort by: Name, Next Run, Last Status
- Auto-refresh every 30 seconds (use setInterval, not WebSocket - cron data comes from gateway API not Entity's own DB)

**Status dot logic:**
- `enabled && state.lastStatus === 'ok'` -> green dot
- `enabled && state.lastStatus === 'error'` -> red dot with error count badge
- `enabled && !state.lastRunAtMs` -> yellow dot (scheduled but never ran)
- `!enabled` -> gray dot

**Key details:**
- Show `consecutiveErrors` as a red badge count next to the status dot when > 0
- Format `lastDurationMs` as human-readable ("12s", "2m 15s", "5m+")
- Format `nextRunAtMs` as relative time ("in 15m", "in 2h")
- Format `schedule.expr` with a human-readable hint (e.g., "0 8 * * *" -> "Daily at 8:00 UTC")
- Show model name from `payload.model` (e.g., "MiniMax M2.5", "Opus", "Gemini")
- Red rows for crons with `lastStatus === 'error'` should have a subtle red tint background

### Integration with MCHeader

Extend the MCTab type:
```typescript
export type MCTab = 'kanban' | 'insights' | 'crons' | 'health';
```

Add "Crons" and "Health" tabs to the MCHeader tab bar.

## Feature 2: System Health Panel

### What
A new MC tab "Health" showing system infrastructure status at a glance.

### Server API

Add to `packages/server/src/index.ts`:

```
GET /api/ops/health
```

This runs the system health check script and returns results:

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

app.get('/api/ops/health', async (_req, res) => {
  try {
    const healthScript = process.env.HEALTH_SCRIPT || '/home/henrymascot/clawd/scripts/crons/system-health-check.sh';
    const { stdout } = await execAsync(`bash ${healthScript}`, { timeout: 30000 });
    
    const isHealthy = stdout.trim() === 'HEARTBEAT_OK';
    res.json({
      healthy: isHealthy,
      output: stdout.trim(),
      checkedAt: new Date().toISOString()
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Health check failed';
    res.status(500).json({ healthy: false, error: message });
  }
});
```

Also add gateway connectivity check:

```
GET /api/ops/gateway-status
```

```typescript
app.get('/api/ops/gateway-status', async (_req, res) => {
  const gateways = [
    { name: 'ada-gateway', url: process.env.OPENCLAW || 'http://100.106.69.9:18789' },
    { name: 'spock-gateway', url: 'http://100.78.229.38:18789' },
    { name: 'scotty', url: 'http://100.68.207.75:18789' },
  ];

  const results = await Promise.all(
    gateways.map(async (gw) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`${gw.url}/`, { signal: controller.signal });
        clearTimeout(timeout);
        return { ...gw, status: response.ok ? 'online' : 'degraded', httpCode: response.status };
      } catch {
        return { ...gw, status: 'offline', httpCode: 0 };
      }
    })
  );

  res.json({ gateways: results, checkedAt: new Date().toISOString() });
});
```

### Frontend Component

New file: `packages/app/src/components/mission-control/MCHealthView.tsx`

**UI layout:**
A grid of status cards:

1. **Gateway Status** - Card per gateway (Ada, Spock, Scotty) with online/offline indicator, last check time
2. **System Health** - Output from health check script parsed into individual check items with pass/fail
3. **Cron Summary** - Quick stats: X enabled, Y failing, Z disabled (links to Crons tab)
4. **Active Sessions** - Count of active sessions (from `/api/agents` data)

**Design:**
- Cards use Entity's existing dark theme CSS variables (--bg-primary, --bg-secondary, --border-primary, --text-primary, etc.)
- Status indicators: green circle for healthy, red for failing, amber for degraded
- Auto-refresh every 60 seconds
- "Last checked: X seconds ago" text in footer

## Feature 3: Enriched Agent Cards

### What
Enhance the existing MCAgentsView to show more useful data per agent.

### Changes

The existing `MCAgentsView` currently just renders an `MCFragment` with static HTML. Replace it with a proper React component that fetches live data.

**New data per agent card:**
- Agent name, emoji, model name (already from `/api/agents`)
- Active sub-agent count (new - from sessions API if available)
- Cron count: how many crons are assigned to this agent (filter cron list by `agentId`)
- Last activity timestamp
- Status: online/offline based on gateway reachability

**Implementation:**
The `/api/agents` endpoint already exists in Entity's server. Enrich it:

```typescript
app.get('/api/ops/agents-enriched', async (_req, res) => {
  try {
    // Get agents
    const agentsResponse = await fetch(`${OPENCLAW}/api/agents`);
    const agentsData = await agentsResponse.json();
    
    // Get crons for counts
    const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || '';
    let cronJobs: any[] = [];
    try {
      const cronResponse = await fetch(`${OPENCLAW}/api/cron/jobs`, {
        headers: gatewayToken ? { 'Authorization': `Bearer ${gatewayToken}` } : {}
      });
      const cronData = await cronResponse.json();
      cronJobs = cronData.jobs || cronData || [];
    } catch {}

    // Enrich agents with cron counts
    const agents = (agentsData.list || agentsData.agents || []).map((agent: any) => ({
      ...agent,
      cronCount: cronJobs.filter((j: any) => j.agentId === agent.id || (!j.agentId && agent.id === 'main')).length,
      enabledCronCount: cronJobs.filter((j: any) => 
        (j.agentId === agent.id || (!j.agentId && agent.id === 'main')) && j.enabled
      ).length,
      failingCronCount: cronJobs.filter((j: any) => 
        (j.agentId === agent.id || (!j.agentId && agent.id === 'main')) && 
        j.enabled && j.state?.lastStatus === 'error'
      ).length,
    }));

    res.json({ agents });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch agents';
    res.status(502).json({ error: message });
  }
});
```

## File Changes Summary

### New Files
- `packages/app/src/components/mission-control/MCCronView.tsx` - Cron health table
- `packages/app/src/components/mission-control/MCHealthView.tsx` - System health cards
- `packages/app/src/hooks/useOpsData.ts` - Hook for fetching ops data with polling

### Modified Files
- `packages/server/src/index.ts` - Add `/api/ops/crons`, `/api/ops/health`, `/api/ops/gateway-status`, `/api/ops/agents-enriched` routes
- `packages/app/src/components/mission-control/MCHeader.tsx` - Add 'crons' and 'health' to MCTab type and render tabs
- `packages/app/src/components/mission-control/MCAgentsView.tsx` - Replace MCFragment with live React component
- `packages/app/src/App.tsx` - Route new tabs to new components

### Environment Variables (add to .env)
```
OPENCLAW_GATEWAY_TOKEN=   # Optional: gateway auth token for cron API
HEALTH_SCRIPT=/home/henrymascot/clawd/scripts/crons/system-health-check.sh
```

## Design Guidelines

- Match Entity's existing dark theme exactly. Use CSS variables already defined (--bg-primary, --bg-secondary, --border-primary, --text-primary, --text-secondary, --text-muted, --accent, etc.)
- No new CSS frameworks or UI libraries. Use the same patterns as existing MC components.
- Table styling should match the existing activity stream styling.
- Status dots: 8px circles with appropriate colors (green: #10b981, red: #ef4444, amber: #f59e0b, gray: #6b7280)
- Cards: rounded-lg, border border-white/10, bg-white/5 (matching ECA's glass card style)
- Keep it minimal and information-dense. No decorative elements.
- Mobile responsive: stack cards vertically on small screens.

## Success Criteria

1. Crons tab shows all 26+ cron jobs with accurate status dots reflecting actual lastStatus
2. Failing crons are immediately visible (red dots, red tint row, error message on expand)
3. Health tab shows gateway connectivity for all 3 gateways
4. Agent cards show cron counts per agent
5. Auto-refresh works without full page reload
6. No breaking changes to existing kanban/insights/settings tabs
7. ECA iframe embed continues to work unchanged in settings

## Non-Goals

- Do NOT modify the Enterprise Crew Admin app
- Do NOT add cron editing/enabling/disabling (that stays in ECA)
- Do NOT add SSH-based operations (Entity uses HTTP APIs only)
- Do NOT add WebSocket for ops data (use polling - the data source is external)
