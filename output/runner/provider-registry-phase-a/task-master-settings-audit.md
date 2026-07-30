# PR-A-02 — Task Master Settings UI & API Audit

**Issue:** THE-734 / PR-A-02  
**Proof type:** Current-state map  
**Source SHA:** SuperSpec `4eaafc6815db1d731b0683ae4bf54096e64cc30e91a2b89d984fccc520ebd733`  
**Worktree HEAD:** `a87a6fd9527f06654291be174c88f7271ad5db66`  
**Coder:** Cursor Agent `grok-4.5`

## Known seam

`packages/app/src/components/TaskMasterSettings.tsx` → `packages/server/src/routes/agents.ts` (`registerAgentControlRoutes`) → `packages/server/src/agent/{index,settings,log,scheduler,config}.ts`

## UI surface (current)

| Section | Controls | Notes |
| --- | --- | --- |
| Status card | Enabled badge, provider, model, total actions, last run, API key source, stale thresholds, max scan actions | From `GET /api/agent/status` + settings |
| Review / Human Gate Policy | Static explanatory cards | Policy-backed copy only; no API writes |
| Manual Trigger | Run All Checks (`manual`), Review Check (`review_check`), Stale Scan (`stale_scan`) | `POST /api/agent/trigger`; disabled when agent not enabled |
| Model Provider | Provider select, model select, custom model ID, API key (password), optional base URL, stale thresholds, max actions | `PATCH /api/agent/settings` |
| Clear saved key | Clears DB-stored key when `apiKeySource === 'database'` | Sends `clearApiKey: true` |
| Recent Logs | Expandable list + Refresh | `GET /api/agent/log?limit=30` |

## APIs called by UI

| Method | Path | Purpose | Request body (shape) | Response (safe) |
| --- | --- | --- | --- | --- |
| GET | `/api/agent/status` | Status card | — | `lastRun`, `totalActions`, `provider`, `model`, `enabled`, `apiKeyConfigured`, `apiKeySource` — **no raw key** |
| GET | `/api/agent/settings` | Load drafts / provider catalog | — | Provider/model/thresholds + `apiKeyConfigured` / `apiKeySource` / `baseUrl` — **no raw key** |
| PATCH | `/api/agent/settings` | Save provider/config | May include `apiKey` (write-only), `clearApiKey`, `baseUrl`, thresholds | Returns redacted settings view |
| POST | `/api/agent/trigger` | Manual runs | `{ event }` where event ∈ `manual` \| `review_check` \| `stale_scan` (UI); server also accepts `review_hygiene`, `ownership_check` | `{ actions, summary }` or error |
| GET | `/api/agent/log?limit=30` | Recent actions | — | `{ entries: [...] }` with task name/assignee enrichment |

Routes are dual-registered under `/agent/*` and `/api/agent/*` (`registerAgentControlRoutes` with `""` and `"/api"`).

## Secret handling in UI

- Stored keys never returned by GET; UI shows `Key set from {database|env}` / `Missing`.
- API key input is `type="password"`; draft cleared after successful save (`setDraftApiKey('')`).
- Placeholder when configured: “Stored key is hidden…”
- Env fallback env var **names** shown (not values): `selectedProvider.envKeys.join(', ')`.

## Error / empty states

- Loading: “Loading Task Master status…”
- Trigger/save errors: red banner with `data.error` or exception message
- Success: green banner with action count/summary or “settings saved”
- Empty logs: “No logs yet”
- Triggers disabled when `status.enabled` is false (`ENTITY_AGENT_ENABLED` gate)

## Coupling notes for later phases

- Provider catalog is server-owned (`TASK_AGENT_PROVIDERS` in `agent/settings.ts`).
- No dedicated “Smoke Test” control exists in this UI (see PR-A-09).
- “Run All Checks” maps to trigger event `manual`, which currently runs stale scan (or task-scoped review/ownership logic when `taskId` provided server-side).

## Commands / verification

```bash
git status --short
# Static audit of TaskMasterSettings.tsx + agents.ts + agent/settings.ts
```

No browser mutation performed (audit-only; no Admin Inference Providers UI changes).

## Acceptance

- [x] Current-state map produced
- [x] All UI-called APIs inventoried
- [x] No raw secrets in this artifact
