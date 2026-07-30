# PR-A-08 — Scheduler State & Task Master Run History Audit

**Issue:** THE-740 / PR-A-08  
**Proof type:** Task Master health source map (SuperSpec §4.4)  
**Source SHA:** SuperSpec `4eaafc6815db1d731b0683ae4bf54096e64cc30e91a2b89d984fccc520ebd733`  
**Worktree HEAD:** `a87a6fd9527f06654291be174c88f7271ad5db66`

## §4.4 checklist

| Item | Answer |
| --- | --- |
| Scheduler enabled/disabled source | `AGENT_CONFIG.enabled` ← env `ENTITY_AGENT_ENABLED` (default false). Not in `app_settings`. |
| Startup/runtime error representation | Interval `.catch` → `console.error`; **no durable scheduler error state**. UI only sees `enabled` boolean. Missing → treat as **unknown/degraded** in Phase F. |
| Canonical last-attempt timestamp | **Incomplete today.** Closest: `agent_log.timestamp` / `getStatus().lastRun`. Failures before `recordActions` leave no row. Phase F must add attempt receipts (OQ-011). |
| Canonical last-success timestamp | **Unavailable as first-class field.** Would require filtering `agent_log` for successful actions; not defined. Mark N/A until Phase F attempt outcomes. |
| Canonical last-failure timestamp | **Unavailable.** Console-only for many failures. Mark N/A until Phase F. |
| Detect current/active run? | In-process flags: `staleScanRunning`, `reviewHygieneRunning`, `ownershipCheckRunning` on `TaskAgent`. **Not exposed via API.** Scheduler `isRunning()` only means interval handle exists. |
| Stale threshold + units | `taskAgent.settings.staleThresholdHours.{doing,review}`; units = **hours**; defaults 24/48. |
| Threshold persistence | JSON in `app_settings['taskAgent.settings']`. |
| Run Now path | `POST /api/agent/trigger` `{event:'manual'}` → primarily `runStaleScan('manual')` (mutating). |
| Smoke Test | **None.** Must invent non-mutating seam in Phase F. |
| Manual execution preserves human/review gates? | **Partial.** Review/human-gate policy is enforced on HTTP task transition routes and in the comment responder (`validateReviewCompletion`). TaskAgent tool `moveTask` calls `taskSyncLayer.moveTask` directly and does **not** invoke `validateReviewCompletion`. Current TaskAgent handlers move cards to `doing`/`todo` (and similar) rather than completing to `done` via that tool path. **Gap for Phase F:** Run Now / any completion path must enforce the same completion/human-gate checks as HTTP routes — do not claim current manual trigger preserves completion gates. |
| Log source + name enrichment | `agent_log` table; `/api/agent/log` enriches via `taskSyncLayer.getTask`. |
| Timezone / clock source | Timestamps are ISO strings from `new Date().toISOString()` (**UTC**) and SQLite `datetime('now')` (UTC). Scheduler uses Node `setInterval` wall clock. |

## Health source map (Phase F)

```text
providerReady     ← apiKeyConfigured
schedulerEnabled  ← ENTITY_AGENT_ENABLED
schedulerRunning  ← in-memory interval (not API-exposed)
activeScan        ← in-process flags (not API-exposed)
lastAttempt       ← incomplete (agent_log only)
lastSuccess/Fail  ← unavailable
staleThreshold    ← settings hours
recentOutcomes    ← agent_log rows
```

## Acceptance

- [x] §4.4 items answered or marked unavailable
- [x] Feeds OQ-010/011/012/013/014
