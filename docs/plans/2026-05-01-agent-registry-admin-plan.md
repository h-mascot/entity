# Agent Registry Admin + Crew Card Fix Plan

Date: 2026-05-01
Owner: Book

## Goal
Ship a verified first slice for agent registry management in Entity:
- fix broken crew display signals (missing avatars, unknown runtime, placeholder Assistant)
- expose safe backend routes for agent add/edit/disable and module grants
- add Admin UI to manage agents and scopes

## Constraints
- Source of truth: `/Users/enterprise/code/entity`
- Do not overwrite DB files.
- Server code changes require tests and `cd packages/server && npx vitest run` targeted/full as practical.
- Build app and browser-verify live UI behavior before claiming done.

## Steps
- [ ] Backend contract + tests
  - Add repository methods for soft disable/delete-like status and grant upsert/remove if missing.
  - Add route validation helpers in `packages/server/src/index.ts` for `/api/agents` mutations.
  - Verify with targeted Vitest tests.
- [ ] Frontend crew display fix
  - Preserve `capabilities`, `adapter_type`, `runtime_type`, `rawStatus` from `/api/agents` in `App.tsx`.
  - Hide placeholder/template `assistant` from operational Crew by default.
  - Add avatar fallback to initials/emoji on image load errors in `AgentsSidebarTab`.
- [ ] Admin Agent Settings UI
  - Add settings section/tab for Agents.
  - List agents from `/api/agents/registry`, modules from `/api/modules`, grants from `/api/agents/:id/grants`.
  - Add/edit basic identity fields and scope checkbox grants.
  - Disable instead of hard-delete.
- [ ] Verification
  - `cd packages/server && npx vitest run <targeted>`
  - `npm --prefix packages/app run build`
  - Browser: Agents sidebar no broken images, no Assistant in Crew, no `unknown · unknown` where runtime exists.
  - Browser/Admin: agent settings page loads and lists agents/modules.

## Files touched
- `docs/plans/2026-05-01-agent-registry-admin-plan.md`
- `docs/plans/ACTIVE_PLAN.md`
- `packages/db/src/index.ts`
- `packages/server/src/index.ts`
- `packages/server/src/__tests__/agent-registry-routes.test.ts` or colocated equivalent
- `packages/app/src/App.tsx`
- `packages/app/src/components/AgentsSidebarTab.tsx`
- `packages/app/src/components/settings/AgentRegistrySettings.tsx`

## Resume
Start with backend API mutations and tests. Keep UI minimal and shippable; do not build invite-link flow in this slice beyond leaving API shape compatible with it.
