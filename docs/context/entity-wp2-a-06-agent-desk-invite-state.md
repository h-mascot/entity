# THE-881 / WP2-A-06 — Agent Desk invite/setup/verification state

Status: **IMPLEMENTED**  
Date: 2026-07-31  
Parent: THE-829 — Workplanes Slice 2 Phase A  
Dependency: THE-880 / WP2-A-05 Done (`ab094e6`)

## Verdict

Agent Desk (Agents surface) shows durable invite setup/verification state:

- List + detail from `GET /api/agents/invites` / `GET /api/agents/invites/:id`
- Status, expiry, generation/rotation, progress checklist
- Revoke / regenerate via WP2-A-05 controls
- Show-once token/URL bundle only after create/regenerate (in-memory; not re-emitted by GET)
- Empty / loading / error / revoked / expired / rotated affordances fail closed

## Server additions (minimal)

| Change | Why |
| --- | --- |
| `GET /api/agents/invites` | Operator list for Agent Desk |
| `progress` + `rotated` on `DurableInviteView` | Verification + rotation signal without secrets |

## Frontend

| Path | Role |
| --- | --- |
| `packages/app/src/lib/agentInviteDesk.ts` | Pure desk state + affordance helpers |
| `packages/app/src/lib/agentInviteApi.ts` | Durable invite HTTP helpers |
| `packages/app/src/components/agents/AgentInviteDeskPanel.tsx` | Invite desk UI |
| `packages/app/src/components/AgentDashboardV2.tsx` | Mount desk + refresh after Add Agent |
| `packages/app/src/components/agents/AddAgentCreationPanel.tsx` | Prefer durable create; notify desk |

## Explicit non-goals

- WP2-B identity/capability cards, presence, Chief routing, ASK
- Re-emitting raw tokens from GET
- Production promotion
