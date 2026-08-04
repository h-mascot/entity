# THE-878 / WP2-A-03 — Agents → Add Agent creation UI

Status: **IMPLEMENTED** (UI shell + local preview seam; no durable invite HTTP)  
Date: 2026-07-31  
Worktree: `/Users/enterprise/Code/entity-the-878-wp2-a-03`  
Parent: THE-829 — Workplanes Slice 2 Phase A  
Dependency: THE-877 / WP2-A-02 Done (`a0053dd`)

## Verdict

Added the minimal **Agents → Add Agent** creation UI on the Agent Fleet surface:

1. Pure creation model under `packages/app/src/lib/addAgentInviteCreation.ts`
2. Presentational panel `packages/app/src/components/agents/AddAgentCreationPanel.tsx`
3. Wired into `AgentDashboardV2` fleet view

Uses THE-877 product statuses (`created` on success) and `creationSource: agents_invite`.

## Explicit seam / dependency

| Concern | This ticket | Later |
| --- | --- | --- |
| UI host + progressive disclosure | ✅ | — |
| empty / loading / error / ready | ✅ | — |
| Local preview invite kit | ✅ (`local_preview_not_durable`) | — |
| Copyable full invite prompt | Next-step note only | **WP2-A-04** |
| Durable `POST /api/agents/invites` | Not shipped | **WP2-A-05** |
| Revoke / regenerate | Not shipped | **WP2-A-05** |
| Agent Desk progress view | Not shipped | **WP2-A-06** |

**Does not** call `POST /api/onboarding/agent-session` for Agents-created invites (that path mutates global `onboarding.state`, forbidden for `agents_invite` per THE-877).

Optional `probeDurableCreate` hook is ready for WP2-A-05; today create falls back to clearly labeled local preview.

## UI states

| `data-add-agent-status` | Meaning |
| --- | --- |
| `empty` | Closed / no invite in progress |
| `editing` | Form open |
| `loading` | Create in flight |
| `error` | Validation or forced failure (Retry) |
| `ready` | Preview kit with status `created` |

## Modules

| Path | Role |
| --- | --- |
| `packages/app/src/lib/addAgentInviteCreation.ts` | Draft/validate/create model |
| `packages/app/src/lib/addAgentInviteCreation.test.ts` | Focused state/interaction tests |
| `packages/app/src/components/agents/AddAgentCreationPanel.tsx` | User-facing panel |
| `packages/app/src/components/AgentDashboardV2.tsx` | Fleet host |
