# EEPC-A-01 — Swarm provider interface and dispatcher seams inventory

**Linear:** THE-889  
**Build-plan task:** EEPC-A-01  
**Parent:** THE-831 (Entity Execution-Engine Plugin Contract — Phase A)  
**Decision:** CHARACTERIZED  
**Dependency:** WP1-C-07 / THE-875 Done  
**Scope:** Read-only inventory of `packages/server/src/swarm` provider interface, registry, dispatcher, callback/tracker routes, health seams, and gaps for EEPC-A-02 manifest schema. No production mutation. No secret values copied into this receipt.

Grill authority (Q44–Q45): Workplanes slice 1 exists; Swarm/Codex/eforge should eventually register through an execution-engine contract rather than bespoke integrations. Entity owns task state / proof / callback intake; runners are swappable arms.

## Sources inspected

| Path | Role |
| --- | --- |
| `packages/server/src/swarm/providers/interface.ts` | `SwarmProvider` contract + payload/status/proof types |
| `packages/server/src/swarm/provider-registry.ts` | In-process singleton registry |
| `packages/server/src/swarm/dispatcher.ts` | Bootstrap registration, dispatch/status/cancel/accept/reject, auto-dispatch |
| `packages/server/src/swarm/routes.ts` | `/api/swarm/*` CRUD, dispatch, tracker callbacks, provider health/control |
| `packages/server/src/swarm/types.ts` | Job status machine + proof row types |
| `packages/server/src/swarm/db.ts` | `swarm_jobs` / `swarm_proofs`, claim/release |
| `packages/server/src/swarm/healer.ts` | Stuck-job auto-heal loop |
| `packages/server/src/swarm/providers/{acp,symphony,eforge,codex,ccp,flywheel}.ts` | Built-in adapters |
| `packages/server/src/swarm/providers/eforge-{queue,poller,client,mapper}.ts` | eforge hybrid pull/queue bridge |
| `packages/server/src/swarm/ARCHITECTURE.md` | Intended architecture (partially drifted) |
| `packages/server/src/index.ts` | Mount `app.use("/api/swarm", createSwarmRouter())` + `startHealer()` |
| `packages/app/src/components/SwarmBoard.tsx`, `hooks/useSwarmBoard.ts` | UI consumers (out of mutation scope) |

## Architecture (current)

```text
Entity UI/API
  → /api/swarm routes
    → dispatcher (state machine + auto-dispatch)
      → swarmProviderRegistry
        → SwarmProvider adapters (acp|symphony|eforge|codex|ccp|flywheel)
          → external runners / queue dirs / pull claim API
    → tracker callback routes (claim/release/status/proof/complete/fail)
    → healer + eforge poller (side loops)
```

Key principle already encoded: Entity tracks work; providers execute. Jobs live in plugin-owned `swarm_jobs` / `swarm_proofs` and optionally reference `task_id`.

## Provider interface contract (`SwarmProvider`)

Required surface:

| Member | Type | Notes |
| --- | --- | --- |
| `name` | `string` | Stable id stored on `swarm_jobs.provider` |
| `label` | `string` | UI label |
| `meta?` | `SwarmProviderMetadata` | Optional category / executionMode / acceptsDispatch / capabilities |
| `healthCheck()` | `→ ProviderHealth` | `{ available, message?, latencyMs? }` |
| `dispatch(job)` | `BuildJobPayload → DispatchResult` | Returns `runHandle`, optional `jobStatus`, `estimatedMinutes` |
| `status(runHandle)` | `→ RunStatus` | `queued\|running\|completed\|failed\|cancelled` |
| `cancel(runHandle)` | `→ void` | Best-effort |
| `collectProof(runHandle)` | `→ ProofBundle` | commit/branch/logs/tests/artifacts |

`BuildJobPayload` includes `jobId`, `title`, `spec`, `repo`, optional `branch` / `context` / `feedback` / `env`. Dispatcher today never forwards `env`.

`SwarmProviderMetadata` categories already enumerated: `orchestration` | `build-system` | `delivery-control-plane` | `environment`. Execution modes: `pull` | `push` | `hybrid`.

## Registry and bootstrap seams

- Singleton: `swarmProviderRegistry` (`register` / `get` / `list` / `has` / `size`).
- Duplicate `register(name)` warns and skips; no replace/unregister API.
- Comment claims providers self-register via `registerPlugin()`; **actual bootstrap is hardcoded** in `dispatcher.ensureProvidersRegistered()` once-per-process:
  1. `acp`
  2. `symphony`
  3. `eforge`
  4. `codex`
  5. `ccp`
  6. `flywheel`
- There is **no plugin manifest**, capability declaration file, or versioned adapter contract beyond the TypeScript interface.
- Mount point: `packages/server/src/index.ts` → `app.use("/api/swarm", createSwarmRouter())`.
- Soft-plugin settings key: `plugin_settings.plugin_id = 'geordi-swarm'` (`autoDispatch`, `maxConcurrentJobs`).

## Built-in providers (as registered today)

| name | meta present | execution mode (code/intent) | Dispatch reality | Health / config env (names only) | Notes |
| --- | --- | --- | --- | --- | --- |
| `acp` | no | push (implicit) | HTTP POST `{ACP}/runs`, poll status, collect proof | `ACP_BASE_URL` (default `http://localhost:8100`) | Fully implements push lifecycle |
| `symphony` | no | pull | Marks job `queued`, returns `symphony-pull:{jobId}`; proof via tracker API | `SYMPHONY_API_URL`, `SYMPHONY_API_KEY` (health Authorization only) | ARCHITECTURE.md OpenClaw fallback not present in code |
| `eforge` | yes (`build-system`, hybrid, acceptsDispatch) | hybrid | Writes queue file under `EFORGE_QUEUE_DIR`; status from DB; poller when `EFORGE_API_URL` set | `EFORGE_API_URL`, `EFORGE_QUEUE_DIR`, `EFORGE_WEB_URL`, `EFORGE_POLL_INTERVAL_MS` | Dedicated status/control routes |
| `codex` | yes (`build-system`, push) | push | WebSocket JSON-RPC to app server | `CODEX_APP_SERVER_URL`, `CODEX_CODEX_HOME` | Dedicated status/control routes |
| `ccp` | yes (`delivery-control-plane`, acceptsDispatch=false) | stub | `dispatch` throws; health always unavailable | none | Registry slot only |
| `flywheel` | yes (`environment`, acceptsDispatch=false) | stub | `dispatch` throws; health always unavailable | none | Registry slot only |

## Dispatcher seams

Exported operations:

- `getProvider` / `listProviders` / `checkProviderHealth`
- `dispatchJob` — requires status `draft|queued`; health-gates; transitions `dispatched` then provider-chosen status (`running` default, pull providers may return `queued`)
- `checkJobStatus` — maps provider `completed` → collect proof → `proof` → `review`; `failed` → requeue or permanent fail
- `cancelJob` / `acceptJob` / `rejectJob`
- `kickAutoDispatch` — optional capacity-limited queue drain from plugin settings

Job status machine (`types.ts`):

```text
draft → queued → dispatched → running → proof → review → done
                 └→ failed / cancelled
reject(review|proof) → queued (+ feedback, retry++)
```

Documented dispatcher TODOs still open: background poll loop, retry-on-failure policy beyond status-check path, WebSocket status notifications.

Unsafe / incomplete dispatcher assumptions:

1. `meta.acceptsDispatch === false` is **not enforced** — dispatcher will still call `dispatch` for stub providers if a job names them.
2. Pull providers rewrite status back to `queued` after dispatcher already wrote `dispatched`, creating a brief inconsistent window and confusing operator semantics.
3. No authZ around which caller may dispatch/cancel/accept.
4. `BuildJobPayload.env` is unused — secrets must not be stuffed here later without a private-default policy.
5. Default create-job provider is hardcoded `'acp'`.

## Callback / event / tracker touchpoints

These HTTP routes are the current “callback intake” surface for pull runners (especially Symphony). They are **not** methods on `SwarmProvider`:

| Method | Path | Role |
| --- | --- | --- |
| POST | `/api/swarm/jobs/:id/claim` | CAS claim `queued|draft` → `dispatched` |
| POST | `/api/swarm/jobs/:id/release` | Release `dispatched|running` → `queued` |
| POST | `/api/swarm/jobs/:id/status` | Arbitrary status/progress/`run_handle` updates |
| POST | `/api/swarm/jobs/:id/proof` | Append proof row; may move to `proof` |
| POST | `/api/swarm/jobs/:id/complete` | Done from review (or force from running/dispatched/proof) |
| POST | `/api/swarm/jobs/:id/fail` | Mark failed with reason |

Push path callbacks are effectively `POST /jobs/:id/check` (Entity polls provider) plus `collectProof`.

Side loops / events:

- `healer.ts` — every 5 minutes, stuck `running` > 60 minutes → requeue or fail; started from server boot.
- `eforge-poller.ts` — started from `swarm/index.ts` when `EFORGE_API_URL` set; syncs runs/events into job status + proofs.
- No shared ActivityEvent spine yet (grill Q46) — Swarm status changes do not emit a unified workplane activity model.

Doc drift: Symphony comments say runners poll `?status=ready`, but job statuses have no `ready` value; dispatch leaves jobs in `queued`.

## Health / registry API seams

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/swarm/providers` | `{ providers: [{ name, label, meta }] }` — `meta` key always projected (may be `undefined`); no secrets |
| GET | `/api/swarm/providers/:name/health` | `{ available, message?, latencyMs? }` |
| GET | `/api/swarm/providers/eforge/status` | Extended mode/urls/queue/activeJobs |
| POST | `/api/swarm/providers/eforge/control` | Shells `eforge daemon {start\|stop\|restart\|status}` |
| GET | `/api/swarm/providers/codex/status` | Codex healthCheck |
| POST | `/api/swarm/providers/codex/control` | Currently re-runs healthCheck only |
| GET | `/api/swarm/healer/status` | Healer interval state |
| POST | `/api/swarm/heal` | Manual heal |

Secret / safety posture (inventory findings, not redacted values):

- Provider API responses for list/health do **not** return env tokens (`SYMPHONY_API_KEY`, etc.).
- Health `message` strings often embed **base URLs and queue filesystem paths** — config leakage risk for EEPC-B-01 (“list engines with health without leaking secrets”).
- `POST .../eforge/control` is a **dangerous-action** seam (local shell exec); out of scope to harden here, but must be called out for later contract work.
- Tracker claim/status/proof routes appear unauthenticated at the Swarm router layer.

## Persistence seams

- Tables: `swarm_jobs`, `swarm_proofs` (plugin-owned; optional `task_id` FK semantics without mutating tasks schema).
- Claim/release use status + `run_handle` CAS helpers in `db.ts`.
- Proof rows store commit/branch/logs/tests/screenshots/artifacts JSON; no secret fields by schema.

## Gaps for EEPC-A-02 (manifest schema next)

EEPC-A-02 should define a durable execution-engine plugin manifest that covers at least:

1. **Identity:** `id` / `name` / `label` / `version` (today only `name`+`label`).
2. **Registration:** replace hardcoded `ensureProvidersRegistered` bootstrap with manifest-driven registration (still implementing `SwarmProvider`).
3. **Execution mode:** required `push|pull|hybrid|stub` + whether Entity should poll vs expect claim callbacks.
4. **Lifecycle capabilities:** which of `dispatch|status|cancel|collectProof|claimCallback|proofCallback` are supported; honor `acceptsDispatch`.
5. **Health contract:** public-safe health fields vs private diagnostics (never return tokens; decide whether URLs/paths are public).
6. **Callback contract:** formalize claim/release/status/proof/complete/fail shapes, auth, and idempotency (today ad hoc HTTP).
7. **Config binding:** env/config key names + required/optional + secret classification — not values.
8. **Status mapping:** provider run states ↔ Swarm job states, including pull-provider `queued` after “dispatch”.
9. **Dangerous actions:** explicit allowlist separate from health (eforge daemon control must not be implied by health).
10. **Activity/events:** placeholder for Q46 shared plan/progress/proof events (not invent full ActivityEvent here).
11. **Doc sync:** retire ARCHITECTURE.md OpenClaw/ready-status claims or implement them under the new contract.
12. **Non-goals preserved:** do not duplicate Provider Registry (inference) tickets; Skill Workshop stays Helm-owned.

## Explicit non-goals honored

- No Doc Hub rebuild.
- No Provider Registry duplicate work.
- No production mutation / secret exposure.
- No Skill Workshop in Entity core.
- No unsolicited reset/clean of the canonical dirty worktree.

## Verification anchors

Characterization test: `packages/server/src/swarm/eepc-a-01-inventory.test.ts`  
Machine-readable twin: `docs/context/entity-eepc-a-01-swarm-provider-dispatcher-inventory.json`
