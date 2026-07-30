# PR-A-07 — Health / Test Endpoint Inventory

**Issue:** THE-739 / PR-A-07  
**Proof type:** Endpoint inventory  
**Source SHA:** SuperSpec `4eaafc6815db1d731b0683ae4bf54096e64cc30e91a2b89d984fccc520ebd733`  
**Worktree HEAD:** `a87a6fd9527f06654291be174c88f7271ad5db66`

## Inventory

### Core / release

| Method | Path | Auth | Returns | Secret risk |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | Public | `{ status, service, uptimeSeconds, timestamp }` | Low |
| GET | `/api/version` | Public | Release identity (`gitSha`, environment, paths…) | Low (no secrets) |
| GET | `/api/test-error` | Protected if token set; only if enabled | Triggers Sentry test | Low |
| GET | `/api/agents/metrics` | Protected when `ENTITY_API_TOKEN` set | Agent metrics | Review for PII; no API keys by design |

### Task Master / inference

| Method | Path | Auth | Purpose | Secret risk |
| --- | --- | --- | --- | --- |
| GET | `/api/agent/status` | Protected when token set | Enabled + lastRun + key configured flags | Low (flags only) |
| GET | `/api/agent/settings` | Protected when token set | Redacted settings | Low |
| PATCH | `/api/agent/settings` | Protected when token set | Write key/config | **High write surface** — accepts raw `apiKey` |
| POST | `/api/agent/trigger` | Protected when token set | Executes scans/actions (mutating) | Medium (side effects) |
| GET | `/api/agent/log` | Protected when token set | Recent actions | Low/medium (task names/results) |

**Missing (desired by SuperSpec Phase E/F):** dedicated inference provider health-test start/read APIs, configuration/connectivity/capability test endpoints, persisted health-check records.

### Doc Intelligence

| Method | Path | Notes |
| --- | --- | --- |
| GET/PATCH | `/api/doc-intelligence/settings` | Enable + inherited provider status |
| POST | `/api/doc-intelligence/ask` | Live model call (not a non-mutating smoke) |

### Documents / FS / TTS / agents (adjacent precedents)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/documents/health` | Document service health |
| GET | FS router `/health` | Filesystem router health |
| POST | `/api/fs/sources/:id/test` | **Existing adapter test precedent** — validates a file source, returns duration/capabilities, updates health |
| POST | `/api/tts/test` | TTS connectivity/smoke-style test |
| GET | `/api/agents/status` | Operational agents status (distinct from Task Master `/api/agent/status`) |
| GET | `/api/swarm/providers` | Swarm provider list |
| GET | `/api/swarm/providers/:name/health` | Execution-provider health — **not** inference registry |

Phase E/F provider health-test design should reuse semantics from `POST /api/fs/sources/:id/test` (structured result + duration + non-secret capability summary) rather than inventing an unrelated contract.

## Auth model summary

`packages/server/src/middleware/api-auth.ts`:

- If `ENTITY_API_TOKEN` unset → **auth skipped** (dev mode).
- If set → Bearer required for `/api/*` except public exact routes (`/api/health`, `/api/version`) and listed prefixes.
- Unprefixed mirrors (`/agent`, `/doc-intelligence`, …) also protected when token set.

## Design-freeze implication

Phase E must add **new** inference health-test APIs; do not overload `/api/health` or swarm provider health.

## Acceptance

- [x] Endpoint inventory produced
- [x] Gap vs desired health-test APIs recorded
