# EEPC-A-03 — Callback intake for plan/progress/proof/status/blocker → ActivityEvents

**Linear:** THE-891  
**Build-plan task:** EEPC-A-03  
**Parent:** THE-831 (Entity Execution-Engine Plugin Contract — Phase A)  
**Decision:** IMPLEMENTED (validate + map + route scaffolding; no production provider OAuth)  
**Dependencies:** EEPC-A-02 / THE-890 Done (`714fc02ecaa090c20804f6e331ca82d7b2ef045a`); WP1-C-02 Done

Grill authority (Q45–Q46): Entity owns task state / proof / callback intake; structured plan/progress/log/proof/status events share one ActivityEvent spine across Workplanes and execution engines.

## What this delivers

Server-side callback intake that:

1. Accepts execution-engine callbacks for **plan**, **progress**, **proof**, **status**, and **blocker**
2. Validates payloads against the EEPC-A-02 manifest contract (provider identity, allowed events, job binding, status enum)
3. Maps accepted callbacks into durable **ActivityEvent-compatible** records (task/workplane-ready)
4. Rejects malformed shapes, unknown provider/job, provider/job mismatches, and secret-bearing / public-unsafe payloads

| Surface | Path |
| --- | --- |
| Types | `packages/server/src/swarm/callback-intake/types.ts` |
| Validate | `packages/server/src/swarm/callback-intake/validate.ts` |
| Map | `packages/server/src/swarm/callback-intake/map.ts` |
| Service | `packages/server/src/swarm/callback-intake/service.ts` |
| Routes | `packages/server/src/swarm/callback-intake/routes.ts` |
| Manifest catalog | `packages/server/src/swarm/callback-intake/manifest-catalog.ts` (valid fixtures only) |
| Proofs | `packages/server/src/swarm/callback-intake/callback-intake.test.ts` |

## HTTP scaffolding

Mounted under `/api/swarm` (does **not** replace legacy mutation routes):

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/swarm/jobs/:id/callbacks/:event` | Canonical intake for all five kinds |
| POST | `/api/swarm/jobs/:id/plan` | Convenience alias |
| POST | `/api/swarm/jobs/:id/progress` | Convenience alias |
| POST | `/api/swarm/jobs/:id/blocker` | Convenience alias |

Legacy `POST /api/swarm/jobs/:id/status` and `POST /api/swarm/jobs/:id/proof` remain job-mutation routes (EEPC-A-04+ may emit through intake).

## ActivityEvent mapping

| Callback kind | `ActivityEventType` | Payload marker |
| --- | --- | --- |
| plan | `task_updated` | `data.execution_callback_kind=plan` |
| progress | `task_updated` | `data.execution_callback_kind=progress` |
| proof | `artifact_linked` | `data.execution_callback_kind=proof` |
| status | `status_changed` | `data.execution_callback_kind=status` |
| blocker | `task_blocked` | `data.execution_callback_kind=blocker` |

Jobs without `task_id` still map (HTTP 202) and are marked degraded with `missing_task_link`. When `appendTaskEvent` is wired, linked jobs persist (HTTP 201).

## Negative paths covered

- Malformed non-object payload / missing provider or jobId / missing summary
- Unknown provider (no validated EEPC-A-02 manifest)
- Unknown job
- Job/provider mismatch
- Invalid Swarm status enum values
- Secret-bearing keys (`api_key`, `authorization`, …) and secret-like values

## Deferred (explicit)

- Manifest-driven provider adapter registration (EEPC-A-04+)
- ~~Auth on tracker/callback routes (EEPC-A-07)~~ → delivered in EEPC-A-07 / THE-895
- Workplane panel wiring for job proof/status (EEPC-B-02)
- Replacing legacy status/proof mutation routes with intake-first emission

## Non-goals honored

- No Doc Hub rebuild / Provider Registry duplicate / Skill Workshop
- No production mutation / secret exposure / OAuth
- Isolated worktree only
