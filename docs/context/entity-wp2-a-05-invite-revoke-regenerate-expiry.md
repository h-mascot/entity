# THE-880 / WP2-A-05 — Invite revoke / regenerate / expiry controls

Status: **IMPLEMENTED** (durable human invite HTTP + tokenized revoke/expiry gate)  
Date: 2026-07-31  
Worktree: `/Users/enterprise/Code/entity-the-880-wp2-a-05`  
Parent: THE-829 — Workplanes Slice 2 Phase A  
Dependency: THE-879 / WP2-A-04 Done (`b55caa2`)

## Verdict

Added the minimal durable server/API layer for Add Agent invite controls:

1. Human-facing `/api/agents/invites*` create / get / revoke / regenerate
2. Tokenized `/api/onboarding/agent-session/:token/*` gate for durable revoke / expiry / rotation
3. Show-once raw token on create/regenerate only (GET is audit-safe)

Uses THE-877 status machine and THE-879 URL path shapes. No Agent Desk UI (WP2-A-06).

## HTTP surface

| Method | Path | Role |
| --- | --- | --- |
| `POST` | `/api/agents/invites` | Create durable invite; returns show-once `token` + setup/manifest/bundle/skill/progress paths |
| `GET` | `/api/agents/invites/:inviteId` | Human detail; **no** raw token re-emit |
| `POST` | `/api/agents/invites/:inviteId/revoke` | Status → `revoked`; tokenized endpoints 401 |
| `POST` | `/api/agents/invites/:inviteId/regenerate` | Rotate `token_hash`, `generation++`, prior hash retained; old token 401 `invite_token_rotated` |

Creation source default: `agents_invite` (does **not** mutate global `onboarding.state`).

## Tokenized gate

For each of manifest / progress / skill / bundle:

1. Hash path token
2. If durable invite matches current hash → apply expiry, enforce `canAccessTokenizedEndpoints`
3. If hash matches `previous_token_hash` → 401 `invite_token_rotated`
4. Else → legacy onboarding session path (first-run compatibility)

## Explicit non-goals

- WP2-A-06 — Agent Desk invite progress UI
- Wiring Add Agent panel `probeDurableCreate` to production UI (optional later)
- Heartbeat / Chief routing / Workplane attach
- Production promotion

## Modules

| Path | Role |
| --- | --- |
| `packages/server/src/agent/invite-kit/controls.ts` | Create/revoke/regenerate/expiry + tokenized access resolver |
| `packages/server/src/routes/agent-invites.ts` | Human invite HTTP routes |
| `packages/server/src/config/routes.ts` | Tokenized durable gate |
| `packages/db/src/agent-invites.ts` | `getInviteByPreviousTokenHash` for rotation fail-closed |
