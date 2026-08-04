# THE-884 / WP2-B-03 — Attach agents to task Workplanes

Status: **IMPLEMENTED**  
Date: 2026-07-31  
Parent: THE-830 — Workplanes Slice 2 Phase B  
Dependencies: THE-883 / WP2-B-02 (`9cc7c9b`), THE-875 / WP1-C-07

## Verdict

Durable attach/detach/list for agents on task Workplanes, overlaid with truthful presence from THE-883. Missing stays missing until a real heartbeat; activity is never invented.

## Surfaces

| Layer | Path |
| --- | --- |
| Store | `packages/server/src/agent/workplane-attach/store.ts` |
| Service | `packages/server/src/agent/workplane-attach/service.ts` |
| Routes | `packages/server/src/routes/workplane-agents.ts` |
| Presence join | `packages/server/src/agent/presence/service.ts` (`attachment_missing`) |
| App model | `packages/app/src/lib/workplaneAttachedAgents.ts` |
| Panel UI | `packages/app/src/components/agents/WorkplaneAttachedAgentsPanel.tsx` |
| Mount | Agent Desk invite detail (`AgentInviteDeskPanel`) |

## API

- `POST /api/workplanes/:workplaneId/agents` — attach by `agentId` and/or `inviteId` (idempotent)
- `GET /api/workplanes/:workplaneId/agents` — list attachments + presence overlay
- `DELETE /api/workplanes/:workplaneId/agents/:agentId` — detach (idempotent)

## Explicit non-goals

- Chief routing / ASK (WP2-B-04+)
- Production promotion
- Mutating invite.workplaneId as the only membership signal (attachments are first-class)
