# MC #1036 — Business onboarding MVP (Matrix-style)

## Mission

Ship an auth-deferred business/org setup wizard for Entity:

fork → org name → domains → goal → blueprint review → agent mapping

The MVP uses Curacel-shaped domains and maps existing named agents to provisioned teams instead of creating new agents.

## Source evidence

- `/Users/enterprise/.hermes/tmp/entity-business-onboarding/matrix-teardown.md` §3.2–3.5: MVP shape, three additive org columns, one React component, one server route file, admin wizard behind existing onboarding gate.
- `/Users/enterprise/.hermes/tmp/entity-business-onboarding/SYNTHESIS.md` §E: Curacel-shaped taxonomy and named-agent mapping.
- Entity source: org/team/project CRUD already exists in `packages/db/src/index.ts` and `packages/server/src/routes/workspace.ts`.

## Acceptance criteria

- [x] Add exactly the MVP org fields as additive/backward-compatible schema: `orgs.mission`, `orgs.domains_json`, `orgs.blueprint_json`.
- [x] Existing org CRUD reads/writes the new fields without breaking older DBs.
- [x] Add one server route file for `/api/onboarding/business/*` with start/update/provision/confirm.
- [x] Use closed domain taxonomy: `claims-ops`, `engineering-devops`, `product`, `sales-bd`, `marketing`, `finance`, `customer-success`, `people-ops`, `health-business`, `ai-ops`, `other`.
- [x] Provision one team + one seed project per selected domain.
- [x] Map existing agents to teams where applicable: Atlas→Product, Mafa→Commercial, Sabi→Customer Success, Kashy→Finance. Do not generate agent registry records.
- [x] Add one React component for the Matrix-style wizard and wire `/onboarding/business` behind `onboardingCompleted === true`.
- [x] Run focused server tests, app build, server build, and root build/CTRL gate as practical.

## Files touched

- `docs/plans/2026-07-07-mc-1036-business-onboarding.md`
- `docs/plans/ACTIVE_PLAN.md`
- `packages/db/src/index.ts`
- `packages/server/src/routes/business-onboarding.ts`
- `packages/server/src/routes/business-onboarding.test.ts`
- `packages/server/src/index.ts`
- `packages/app/src/components/BusinessOnboardingFlow.tsx`
- `packages/app/src/components/businessOnboardingCatalog.ts`
- `packages/app/src/components/businessOnboardingCatalog.test.ts`
- `packages/app/src/App.tsx`

## Progress log

- 2026-07-07T02:19:45Z — Created isolated worktree `/Users/enterprise/Code/entity-mc-1036-business-onboarding` from clean `f3d86e3` because the main checkout had unrelated MC #1037/#1038 edits.
- 2026-07-07T02:19:45Z — Loaded Entity context, Matrix teardown, synthesis, and workspace/onboarding architecture reference.
- 2026-07-07T07:50:07Z — Focused server tests passed: `npm --prefix packages/server run test -- src/routes/business-onboarding.test.ts src/routes/workspace.test.ts src/__tests__/db-repositories.test.ts` (3 files, 89 tests).
- 2026-07-07T07:50:39Z — Server build and app build passed; app build emitted `BusinessOnboardingFlow-Bk_9syua.js`.
- 2026-07-07T08:17:03Z — `SHELL= npm run ctrl:gate` passed after full root build and all workspace unit gates (99 server files, 692 server tests). Plain `npm run ctrl:gate` had one pre-existing local-shell expectation failure in `terminal.test.ts` on this macOS environment because `$SHELL` resolved to `/bin/zsh`; rerunning with empty `SHELL` exercises the intended fallback and passes.
- 2026-07-07T08:14:15Z — Browser proof on `http://127.0.0.1:43106/onboarding/business`: rendered business wizard, completed Curacel flow, confirmed dashboard return, and DB/API readback showed 4 teams, 4 mapped agents, 4 projects, and 12 seed tasks.
- 2026-07-07T08:22:00Z — Codex autoreview clean; receipt saved under `/Users/enterprise/.hermes/output/mc-1036/`.
- 2026-07-30T02:40:00Z — AUTH-A-03 / THE-914 REWORK in this worktree: fail-closed `taskRepoFactory` (no `createOrgScopedTaskRepository` default), production `index.ts` wires shared `taskSyncLayer` via `createTaskSyncLayerRepoFactory`, durable `confirmedAt` in `blueprint_json`, catalog GET on UI mount with honest degraded fallback, negative tests for empty-domain provision + confirm-without-provision.

## Verification plan

- `export PATH=/Users/enterprise/.hermes/node/bin:/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`
- `npm --prefix packages/server run test -- src/routes/business-onboarding.test.ts src/routes/workspace.test.ts`
- `npm --prefix packages/server run test -- src/__tests__/db-repositories.test.ts`
- `npm --prefix packages/server run build`
- `npm --prefix packages/app run build`
- `npm run build`
- If a local browser/server is feasible: serve the worktree build, visit `/onboarding/business`, verify wizard renders and console is clean.

## Resume instructions

If context compacts: read this plan, inspect `git status --short` in `/Users/enterprise/Code/entity-mc-1036-business-onboarding`, and continue from the first unchecked acceptance criterion. Do not modify `/Users/enterprise/Code/Entity` main checkout; it currently contains unrelated in-progress work.
