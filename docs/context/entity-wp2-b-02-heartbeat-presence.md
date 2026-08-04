# THE-883 / WP2-B-02 — Heartbeat/presence endpoint + Workplane presence panel

Status: **IMPLEMENTED**  
Date: 2026-07-31  
Parent: THE-830 — Workplanes Slice 2 Phase B  
Dependency: THE-882 / WP2-B-01 Done (`d77721d`)

## Verdict

Durable agent heartbeat/presence with Workplane panel that renders live / last-seen / stale / missing / degraded states. Missing presence is never coerced to live; activity is never invented.

## Surfaces

| Layer | Path |
| --- | --- |
| Store | `packages/server/src/agent/presence/store.ts` |
| Service | `packages/server/src/agent/presence/service.ts` |
| Routes | `packages/server/src/routes/agent-presence.ts` |
| App model | `packages/app/src/lib/workplanePresence.ts` |
| Panel UI | `packages/app/src/components/agents/WorkplanePresencePanel.tsx` |
| Mount | Agent Desk invite detail (`AgentInviteDeskPanel`) |

## API

- `POST /api/agents/presence/heartbeat` — upsert last-seen (`live|idle|offline` only)
- `GET /api/agents/presence/:agentId` — evaluated presence (stale derived on read)
- `GET /api/workplanes/:workplaneId/presence` — panel payload + invite-bound missing rows

Stale threshold defaults to 90s (aligned with THE-882 identity card).

## Explicit non-goals

- Workplane attach/detach (WP2-B-03)
- Chief routing / ASK (WP2-B-04+)
- Production promotion
