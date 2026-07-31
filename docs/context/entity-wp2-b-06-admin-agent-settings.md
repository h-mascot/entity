# THE-887 / WP2-B-06 — Admin agent settings: TTL, modules, revoke audit

Status: **IMPLEMENTED**  
Date: 2026-07-31  
Worktree: `/Users/enterprise/Code/entity-the-887-wp2-b-06`  
Parent: THE-830 — Workplanes Slice 2 Phase B  
Dependency: THE-880 / WP2-A-05 Done; THE-886 / WP2-B-05 Done (`25220cc`)

## Verdict

Admin → Agents now hosts invite policy controls:

1. TTL default / min / max (hard-clamped 1 minute … 7 days)
2. Allowed + default modules for durable invite creation
3. Revoke / regenerate / settings audit log (no raw tokens, hashes, or secrets)

Create/revoke/regenerate invite paths enforce the TTL/module policy and append audit events.

## HTTP surface

| Method | Path | Role |
| --- | --- | --- |
| `GET` | `/api/agents/admin-settings` | Current TTL/module policy + catalog (audit-safe) |
| `PATCH` | `/api/agents/admin-settings` | Update policy; writes `settings_updated` audit |
| `GET` | `/api/agents/admin-settings/audit` | Recent invite lifecycle audit events |

Policy failures on invite create:

- `400 ttl_out_of_range`
- `400 module_not_allowed`

## Security

- Responses assert no secret-bearing keys (`token`, `apiKey`, hashes, etc.).
- Audit detail redacts strings that look secret-bearing.
- GET invite detail remains show-once-safe (no token re-emit).

## Modules

| Path | Role |
| --- | --- |
| `packages/server/src/agent/invite-kit/admin-settings.ts` | Policy store + TTL/module resolution |
| `packages/server/src/agent/invite-kit/audit-store.ts` | Durable audit events |
| `packages/server/src/routes/agent-admin-settings.ts` | Admin HTTP routes |
| `packages/server/src/agent/invite-kit/controls.ts` | Enforce policy + append audit on create/revoke/regenerate |
| `packages/app/src/components/settings/AdminAgentSettingsPanel.tsx` | Admin UI |
| `packages/app/src/lib/adminAgentSettings*.ts` | Client model/API/tests |

## Explicit non-goals

- Provider defaults / Task Master model config (Admin → Task Master)
- Production promotion
- Helm deep runtime admin
