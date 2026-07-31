# THE-886 / WP2-B-05 — ASK claim/resolve flow

Status: **IMPLEMENTED**  
Date: 2026-07-31  
Parent: THE-830 — Workplanes Slice 2 Phase B  
Dependencies: THE-885 / WP2-B-04 (`72e56a4`)

## Verdict

Durable Workplane ASK model with compare-and-swap claim/resolve. Reuses WP2-B-04 chief priority and worker fallback. Stale version and double resolution are rejected with truthful error codes and an event log.

## Surfaces

| Layer | Path |
| --- | --- |
| Types / policy | `packages/server/src/agent/ask-flow/{types,policy}.ts` |
| Store / service | `packages/server/src/agent/ask-flow/{store,service}.ts` |
| Routes | `packages/server/src/routes/workplane-asks.ts` |
| App model | `packages/app/src/lib/workplaneAskFlow.ts` |
| Panel UI | `packages/app/src/components/agents/WorkplaneAskPanel.tsx` |
| Mount | Agent Desk invite detail (`AgentInviteDeskPanel`) |

## API

- `GET /api/workplanes/:workplaneId/asks` — list ASKs (`?panel=1` for summary panel)
- `POST /api/workplanes/:workplaneId/asks` — create ASK
- `GET /api/workplanes/:workplaneId/asks/:askId` — get ASK
- `POST .../asks/:askId/claim` — CAS claim (`expectedVersion` required)
- `POST .../asks/:askId/resolve` — CAS resolve (`expectedVersion` required)
- `POST .../asks/:askId/block` — CAS block (chief/operator)
- `GET .../asks/:askId/events` — claim/resolve/CAS event log

## Ask states

`open` · `chief_review` · `claimed` · `blocked` · `resolved` · `stale`

- Live chief assigned → create as `chief_review`
- No/unavailable chief → create as `open` (workers may claim)
- Claim/resolve require matching `expectedVersion` (CAS)
- Double resolve → `409 double_resolve`
- Stale version → `409 stale_version` (+ `cas_rejected` event)

## Policy (claim)

Reuses WP2-B-04 `evaluateClaimPolicy`:

1. Actor must be attached.
2. Already claimed by another → deny.
3. Live chief + priority window → workers denied (`chief_priority`).
4. Chief stale/offline/missing → worker fallback.
5. Chief may always claim when attached.

## Explicit non-goals

- Production promotion / privileged command execution
- Secret/token exposure on ASK surfaces
- Doc Hub rebuild / Provider Registry / Skill Workshop
