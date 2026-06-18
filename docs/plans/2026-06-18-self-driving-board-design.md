# Self-Driving Task Board — Design Spec

Date: 2026-06-18
Status: Draft — for owner review
Branch: `agent/vision-self-driving-design`

## 1. Problem & Goals

Today the board is a passive tracker. A human drags a task to a lane, manually creates a swarm job,
manually clicks **Dispatch**, manually clicks **Check status**, and manually clicks **Accept**. The
machinery to do all of this autonomously already exists — it is just only ever triggered by HTTP
request handlers. Nothing runs on a timer except the healer (stuck-job recovery) and the Task Master
hygiene scanner (stale/review/ownership scans, which do **not** dispatch work).

**Goal: the board drives itself.** Work moves through the pipeline without a human touching dispatch
or status:

```
external channel ─┐
                  ├─► task in "ready" lane ─► auto-dispatch ─► running ─► proof ─► REVIEW queue ─► human accept ─► done
manual task ──────┘                                              │                                      │
                                                                 └── failed → retry/backoff → queued ◄──┘ (reject)
```

The single human gate is **review**: a person looks at the proof and accepts or rejects. Everything
before that is autonomous. Everything after a reject loops back automatically.

### Non-goals
- Replacing the human review gate (it stays, configurable).
- Building new providers (we use the existing 7).
- Changing the `tasks` table schema (it already has `origin_channel`).

### What already exists (verified in code)
| Capability | Where | State |
| --- | --- | --- |
| Capacity-aware, idempotent auto-dispatch | `dispatcher.ts` → `kickAutoDispatch()` | Built, but only called from HTTP handlers (`routes.ts` job-create + status webhook) |
| Job lifecycle (dispatch → status → proof → review) | `dispatcher.ts` → `dispatchJob`, `checkJobStatus`, `acceptJob`, `rejectJob` | Built |
| Retry on provider failure | `dispatcher.ts` → `checkJobStatus` (failed → `queued` if `retry_count < max_retries`) | Built |
| DB-level atomic claim/release | `db.ts` → `claimSwarmJob`, `releaseSwarmJob` | Built |
| Stuck-job recovery (>60 min in `running`) | `healer.ts` → `startHealer()` on 5-min timer | Built + wired in `index.ts` |
| Settings gate | `dispatcher.ts` → `readSwarmPluginSettings()` reads `autoDispatch`, `maxConcurrentJobs` from `plugin_settings` (`geordi-swarm`) | Built |
| Tasks carry an origin | `packages/db/src/index.ts` → `TaskRecord.origin_channel` | Built (column exists) |
| Task lifecycle hooks | `index.ts` → `pluginHooks.emit("task:created" | "task:moved" | "task:updated")` | Built |
| WS broadcast | `index.ts` → `broadcast(data)` over `wss` | Built (swarm emits nothing) |

The three open TODOs at the top of `dispatcher.ts` are exactly the gap:
```
TODO: Add background poll loop for running jobs
TODO: Add retry logic on failure        ← partly done in checkJobStatus; needs backoff
TODO: Add WebSocket notifications for status changes
```

## 2. The Auto-Dispatch Engine

A single background loop — call it the **conductor** — closes the gaps. It does two jobs every tick:
**advance running jobs** (poll their providers) and **dispatch ready jobs** (fill capacity). It reuses
the functions that already exist; it does not reimplement the state machine.

New file: `packages/server/src/swarm/conductor.ts` (mirrors `healer.ts` structure exactly:
`startConductor()`, `stopConductor()`, `getConductorStatus()`, an exported `tick()`).

### What it polls
1. **Active jobs** (`status IN ('dispatched','running')`) → call existing `checkJobStatus(job.id)`.
   That function already transitions `completed → proof → review` (writing a proof bundle) and
   `failed → queued|failed`. The loop just supplies the heartbeat the synchronous V1 lacked.
2. **Ready jobs** (`status = 'queued'`) → call existing `kickAutoDispatch()`, which already:
   - returns early unless `autoDispatch === true`,
   - computes `capacity = maxConcurrentJobs - active`,
   - dispatches oldest-first up to capacity,
   - guards re-entrancy with the module-level `autoDispatchInFlight` flag.

### Tick algorithm
```
tick():
  if not autoDispatch: return            # global kill switch (see §5)
  # 1. advance in-flight work
  for job in listSwarmJobs({status:'dispatched'|'running'}):
     if backoffGate(job) passes:         # see retry/backoff
        prev = job.status
        await checkJobStatus(job.id)
        if status changed: notify(job)   # WS (see below)
  # 2. fill free capacity
  before = snapshot statuses
  await kickAutoDispatch()
  notify() for any job that moved queued→dispatched
```

### Idempotency (don't double-dispatch)
Three independent guards, all already present:
- **Re-entrancy:** `autoDispatchInFlight` (module-level) prevents overlapping `kickAutoDispatch`
  runs; the conductor adds its own `tickInFlight` flag so a slow tick can't stack.
- **Capacity:** `kickAutoDispatch` recomputes `active` from the DB each call — a job that was
  dispatched last tick counts against capacity this tick.
- **Status precondition:** `dispatchJob` rejects anything not in `('draft','queued')`, and
  `claimSwarmJob` does a conditional `UPDATE ... WHERE status IN (...)` that returns 0 rows if
  already claimed (used by the Symphony pull path). The poll loop and the pull path cannot
  both win the same job.

Single-process SQLite means we rely on these in-process guards; no distributed lock needed. If
the server is ever multi-process, the `claimSwarmJob` conditional update is the durable guard.

### Provider selection & health
- Selection stays **explicit per job** (`swarm_jobs.provider`, defaulting to `'acp'`). Auto-creation
  (§4) sets it; the engine does not guess.
- `dispatchJob` already calls `provider.healthCheck()` and refuses to dispatch an unhealthy provider
  (returns `{success:false}` and leaves the job `queued`). The conductor treats a health failure as a
  soft retry: the job stays `queued` and is retried next tick after a backoff window, rather than
  burning a `retry_count`.
- A future enhancement (not Phase A) is a provider-fallback policy (e.g. `acp → codex`). Listed in
  Decisions.

### Retry & backoff
Provider-failure retry already exists (`checkJobStatus`: `failed → queued` while
`retry_count < max_retries`, else `failed`). What's missing is **backoff** so a flapping provider
isn't hammered every tick. Add a derived gate (no schema change required for Phase A — compute from
existing `updated_at` + `retry_count`):

```
backoffMs(retry_count) = min(BASE * 2^retry_count, CAP)   # e.g. BASE=30s, CAP=15min
eligible if now - job.updated_at >= backoffMs(retry_count)
```

The conductor skips re-dispatch/re-poll of a job until its backoff window elapses. The healer keeps
its separate, coarser job: any job wedged in `running` for >60 min regardless of provider response.
The two are complementary — healer is the safety net for the engine.

### WebSocket notifications
`index.ts` already owns `broadcast()` and exports it into the app wiring (it's handed to `TaskAgent`).
Provide the same `broadcast` to the conductor at startup (pass it into `startConductor(broadcast)`,
matching how `TaskAgent` receives it). On every status transition emit:

```
broadcast({ type: 'swarm:job:updated', jobId, status, taskId })
broadcast({ type: 'swarm:job:review', jobId, taskId })   # when a job enters review
```

The frontend `useSwarmBoard` hook currently auto-polls; these events let it stop polling and update
live. Mirror the existing `task:*` event naming convention.

## 3. Board Lanes ⇄ Swarm Job States

The board (`tasks.column`: `backlog | todo | doing | review | done`) and swarm jobs
(`draft → queued → dispatched → running → proof → review → done/failed/cancelled`) are linked by
`swarm_jobs.task_id`. The mapping:

| Board lane (`tasks.column`) | Meaning | Swarm job side |
| --- | --- | --- |
| `backlog` | not ready | no job |
| `todo` (the "ready" lane) | ready to dispatch | creating/queueing a job (trigger) |
| `doing` | agent working | job `dispatched`/`running` |
| `review` | proof ready, awaiting human | job in `review` (proof bundle exists) |
| `done` | accepted | job `done` |

> **Naming note for the owner:** the vision calls the trigger lane "ready". The board's existing
> lanes are `backlog/todo/doing/review/done`. This spec treats **`todo` as the ready lane** (no new
> column). If you'd rather add an explicit `ready` lane, that's a `TASK_COLUMNS` change — see Decisions.

### Trigger: moving a task into the ready lane creates/queues a job
Hook the **existing** `pluginHooks.emit("task:moved", ...)` in `index.ts` (line ~3013). Add a swarm
listener:

```
on task:moved → if task.column === READY_LANE ('todo'):
   job = existing queued/draft job for task_id  ? reuse : createSwarmJob({task_id, ...derived spec})
   updateSwarmJob(job.id, { status: 'queued' })   # ready
   await kickAutoDispatch()                        # opportunistic; conductor also catches it
```

This reuses the same dispatch path the conductor uses, so a move and a tick converge on the same
outcome (idempotent — see §2). Job spec is derived from `task.name` + `task.description`/`brief`;
provider from the default (Decisions).

### Reflecting job state back onto the lane
The conductor (or the swarm listeners) writes the task's lane when the job transitions, so the board
shows reality without the human dragging:

```
job dispatched/running → task.column = 'doing'
job review             → task.column = 'review'   (+ swarm:job:review WS event)
job done               → task.column = 'done'
```

These lane writes go through the existing `taskSyncLayer.moveTask()` so the normal
`broadcast({type:'task:moved'})` and activity log fire.

### Review accept/reject
- **Accept** (human clicks accept in review): existing `acceptJob(jobId)` → job `done`; listener sets
  `task.column = 'done'`.
- **Reject** (with feedback): existing `rejectJob(jobId, feedback)` → job back to `queued`,
  `retry_count++`, `run_handle` cleared, feedback attached. The conductor re-dispatches it next tick
  (after backoff) with the feedback carried into `BuildJobPayload.feedback`. Task lane moves back to
  `doing` on re-dispatch.

This keeps the human in exactly one place — the review queue — and makes reject a first-class, looping
signal rather than a dead end.

## 4. Channels → Tasks (pluggable intake)

Tasks can be born from outside the board (e.g. a website watcher). The DB is already ready:
`TaskRecord.origin_channel` exists. Design a thin, pluggable intake layer that **only creates tasks**
and then lets the existing loop take over — channels never touch swarm jobs directly.

### Intake contract
New file: `packages/server/src/intake/channel.ts`

```
interface IntakeChannel {
  id: string;                 // e.g. 'web-watcher', 'github-webhook'
  poll?(): Promise<IntakeItem[]>;     // for watchers (timer-driven)
  // webhook channels post directly to the intake route instead of polling
}
interface IntakeItem {
  externalId: string;         // for dedupe
  name: string;
  description?: string;
  priority?: string;
  autoReady?: boolean;        // if true, land directly in the ready lane
}
```

### Two intake modes
1. **Webhook** — a generic route `POST /api/intake/:channel` validates and calls `createTask({ ...,
   origin_channel: channel })`. Reuses the auth used on other `/api` routes.
2. **Watcher** — a timer (same pattern as the conductor/healer) calls `channel.poll()`, dedupes by
   `externalId` against existing tasks' metadata, and creates new ones.

### Dedupe
Store `externalId` in `tasks.metadata` (JSON) keyed by channel; intake skips items whose
`(origin_channel, externalId)` already exists. No schema change — `metadata` already exists.

### Hand-off to the loop
A created task lands in `backlog` by default, or directly in the ready lane (`todo`) if
`autoReady` (per-channel policy). If it lands ready, the same `task:moved`/auto-dispatch path from §3
picks it up. **Channels feed the front of the same pipeline; they add no new execution path.**

This keeps the closed loop honest: every task — manual, moved, or channel-born — flows through one
dispatch path and one review gate.

## 5. Safety / Guardrails

| Guardrail | Mechanism |
| --- | --- |
| **Human review gate** | Jobs stop at `review`; only `acceptJob` (human action) advances to `done`. Mandatory by default; can be relaxed per provider/priority (Decisions). |
| **Global kill switch** | `autoDispatch=false` in `plugin_settings.geordi-swarm` halts both `kickAutoDispatch` and the conductor's dispatch step. Already wired in `readSwarmPluginSettings()`. The conductor checks it every tick. |
| **Concurrency cap** | `maxConcurrentJobs` (default 2) enforced by `kickAutoDispatch` capacity math each tick. |
| **Per-task retry cap** | `swarm_jobs.max_retries` (default 3); `checkJobStatus`/`rejectJob`/healer all respect it, then park the job in `failed`. |
| **Backoff** | Exponential gate (§2) prevents tight retry loops against a flapping provider. |
| **Stuck-job net** | Existing healer re-queues/fails jobs wedged in `running` >60 min, independent of the conductor — so a hung conductor or unresponsive provider still self-heals. |
| **Provider health pre-check** | `dispatchJob` refuses unhealthy providers; conductor soft-retries rather than failing the job. |
| **Idempotency** | `autoDispatchInFlight` + capacity recompute + `claimSwarmJob` conditional update (§2). |
| **Channel trust** | Channels can only *create tasks*; they cannot dispatch, accept, or bypass review. New tasks default to `backlog` unless a channel is explicitly trusted with `autoReady`. |

**Healer ↔ conductor relationship:** distinct intervals, distinct jobs. Conductor = forward progress
(poll + dispatch, fast tick ~15–30 s). Healer = backstop (recover wedged jobs, slow tick 5 min). They
share the same DB functions and the same idempotency guarantees, so running both is safe.

## 6. Phased Plan

Each phase is independently shippable and gated behind the **existing** `autoDispatch` flag (default
off), so nothing changes for current users until the owner flips it on.

### Phase A — Background poll + auto-dispatch (behind `autoDispatch`)
Make the loop run on a timer. No new behavior beyond automating what HTTP handlers already do.
- **New** `packages/server/src/swarm/conductor.ts`: `startConductor()`, `stopConductor()`,
  `getConductorStatus()`, `tick()` — clone of `healer.ts` shape. `tick()` calls `checkJobStatus` for
  active jobs, then `kickAutoDispatch()`.
- **Edit** `packages/server/src/index.ts` (~line 6012, beside the healer bootstrap): add
  `import("./swarm/conductor").then(({startConductor}) => startConductor())`.
- **Edit** `packages/server/src/swarm/routes.ts`: add `GET /conductor/status` (mirror
  `/healer/status`) and `POST /conductor/tick` (manual kick, mirror `/heal`).
- Reuses existing `kickAutoDispatch`, `checkJobStatus`, `readSwarmPluginSettings`.
- **Verify:** with `autoDispatch=true` and a `queued` job + healthy stub provider, the job reaches
  `review` with no HTTP calls. Add a `conductor.test.ts` alongside `healer.ts`'s tests.

### Phase B — WS notifications + retry/backoff
- **Edit** `index.ts`: pass `broadcast` into `startConductor(broadcast)` (same way `TaskAgent` gets it).
- **Edit** `conductor.ts`: emit `swarm:job:updated` / `swarm:job:review` on every transition; add the
  `backoffMs(retry_count)` eligibility gate before re-poll/re-dispatch.
- **Edit** `dispatcher.ts`: remove the now-resolved TODOs; ensure `rejectJob` feedback flows into the
  next `BuildJobPayload.feedback` (it already persists to `swarm_jobs.feedback`, and `dispatchJob`
  already reads it).
- **Edit** frontend `useSwarmBoard`: subscribe to the new WS events; reduce polling.
- **Verify:** reject a job → confirm it re-dispatches after the backoff window with feedback attached;
  confirm WS events arrive on the board.

### Phase C — Channel intake
- **New** `packages/server/src/intake/channel.ts`: `IntakeChannel`/`IntakeItem` contract + a registry.
- **New** intake route `POST /api/intake/:channel` (webhook mode) → `createTask({origin_channel})`,
  mounted in `index.ts` next to the swarm router (~line 351).
- **New** watcher timer (clone conductor/healer shape) for `poll()`-based channels; dedupe via
  `tasks.metadata`.
- **Edit** `index.ts`: add a swarm listener on the existing `pluginHooks.emit("task:moved")` /
  `"task:created"` so a task entering the ready lane queues a job (the §3 trigger). This single
  listener is what makes *both* channel-born and manually-moved tasks self-drive.
- **Verify:** POST a fake webhook → task appears in `backlog`; move/auto-ready it → job dispatches →
  reaches review. End-to-end through the loop.

## 7. DECISIONS NEEDED FROM OWNER

1. **Which lane triggers dispatch?** Use existing **`todo` as the "ready" lane** (no schema change,
   recommended), or add a real `ready` column to `TASK_COLUMNS` (`backlog | ready | doing | review |
   done`)? Adding a column touches `packages/db/src/index.ts` and the board UI.
2. **Default provider for auto-created jobs.** Current code default is `acp`. Keep `acp`, or pick
   another of the 7 (symphony / eforge / codex / ccp / paperclip / flywheel)? And do you want a
   **fallback chain** (e.g. `acp → codex` on health failure) or strict single-provider?
3. **Concurrency cap.** `maxConcurrentJobs` default is 2. Confirm the global cap; do you also want a
   per-provider cap so one slow provider can't consume the whole budget?
4. **Is review mandatory?** Default: every job stops at `review` for human accept. Allow auto-accept
   for certain cases (e.g. `priority='low'` with all tests passing, or specific trusted providers), or
   keep review always-on?
5. **Channel auto-ready trust.** Should channel-born tasks land in `backlog` (human promotes them) or
   may a trusted channel drop tasks straight into the ready lane (`autoReady`) and auto-dispatch with
   no human touch before review?
