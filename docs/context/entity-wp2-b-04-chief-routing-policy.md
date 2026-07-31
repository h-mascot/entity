# THE-885 / WP2-B-04 — Chief-of-Staff routing policy surface (claim/assign)

Status: **IMPLEMENTED**  
Date: 2026-07-31  
Parent: THE-830 — Workplanes Slice 2 Phase B  
Dependencies: THE-884 / WP2-B-03 (`0b17ea4`)

## Verdict

Durable chief assignment + claim/assign policy for task Workplanes, using attach + presence overlays. Chief priority window blocks workers while the chief is live/idle; stale/missing/offline chief opens worker fallback. Full ASK claim/resolve remains WP2-B-05.

## Surfaces

| Layer | Path |
| --- | --- |
| Types / policy | `packages/server/src/agent/chief-routing/{types,policy}.ts` |
| Store / service | `packages/server/src/agent/chief-routing/{store,service}.ts` |
| Routes | `packages/server/src/routes/workplane-chief-routing.ts` |
| App model | `packages/app/src/lib/workplaneChiefRouting.ts` |
| Panel UI | `packages/app/src/components/agents/WorkplaneChiefRoutingPanel.tsx` |
| Mount | Agent Desk invite detail (`AgentInviteDeskPanel`) |

## API

- `GET /api/workplanes/:workplaneId/routing` — policy panel (+ optional `taskId`)
- `PUT /api/workplanes/:workplaneId/routing/chief` — assign chief (must be attached)
- `DELETE /api/workplanes/:workplaneId/routing/chief` — clear chief (idempotent)
- `POST /api/workplanes/:workplaneId/routing/claim` — agent claim (policy-gated)
- `POST /api/workplanes/:workplaneId/routing/assign` — chief/operator assign (policy-gated)
- `POST /api/workplanes/:workplaneId/routing/release` — release active claim
- `GET /api/workplanes/:workplaneId/routing/decisions` — recent claim/assign log

## Policy rules (claim)

1. Actor must be attached.
2. Active claim by another agent → deny (`already_claimed`).
3. No chief → attached workers may claim.
4. Actor is chief → always may claim when attached.
5. Chief live/idle + priority window open → workers denied (`chief_priority`).
6. Chief stale/offline/missing → workers may claim (fallback).
7. After priority window expires → workers may claim.

## Explicit non-goals

- ASK model / ask states / Workplane ASK panel (WP2-B-05)
- Production promotion / privileged command execution
- Secret/token exposure on routing surfaces
- Making chief mandatory for every Workplane
