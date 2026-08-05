# Active Plan — Luna CHANGES_REQUESTED Repair Generation 1

Run: `entity-customizable-boards-runner-20260805`
Reviewed clean HEAD (start): `d83bac03673d289f2d9e6431fbd82da858f8f715`
Worker: Pi citadel/glm5.2 (medium), sole gen-1 repair worker.
Production: FORBIDDEN. Do not touch canonical `/Users/enterprise/Code/entity` or sandbox.

## Slices (from repair-map-g1.md) — sequential narrow TDD

### Phase A — Swarm server cluster (share swarm/routes.ts, task-run.ts, db.ts)
- [x] A1. BRD-004 dispatch target fail-closed (no example placeholder) — task-run.ts
- [x] A2. BRD-004 eligibility predicate — task-run.ts + routes.ts
- [x] A3. BRD-004 source/auth: active task source (taskSyncLayer) + request scope — routes.ts
- [x] A4. BRD-004 atomic duplicate guard: partial unique index + transactional insert — db.ts + routes.ts

### Phase B — Boards DB + route (share db/src/boards.ts, server/routes/boards.ts)
- [x] B1. BRD-001 tenant scope: request-derived org/team, scoped repository, isolation — boards.ts + routes/boards.ts
- [x] B2. BRD-001 defaults guaranteed before first create — boards.ts (+ route POST seeds)

### Phase C — App UI (pure-logic tested via node:test in app/src/lib)
- [x] C1. BRD-002 customization controls (view/filter + reorder) — BoardSwitcher + App.tsx + lib helper
- [x] C2. BRD-003 membership: persisted filter applied to Engineering/Strategic — boardTaskFilter/MCEngineeringEntry/App.tsx
- [x] C3. BRD-003 deletion reselection drives render tab — boardsState helper + App.tsx
- [x] C4. BRD-004 proof/status: polling + terminal + proof affordance — swarmTaskRunClient lib + TaskDetailPanel

## Final gate
- [x] server build + vitest; app test; db test  (db 99, server 1386, app 455)
- [x] tsconfig check (app/server)  (server tsc clean, app tsc+vite clean)
- [x] ctrl:gate under Node 22 (`/opt/homebrew/opt/node@22/bin/node`)  (exit 0; ctrl-gate-g1.log)
- [x] git diff --check; private-default + secrets/diff scope; diff vs base = BRD scope only  (0 errors; BRD-only)
- [x] scoped commits; clean worktree  (1f5b3f2, a0fc4a0, b4495eb; HEAD b4495eb, clean)
- [x] update receipts (red-green, focused-proof, ctrl-gate, runner-state READY_FOR_REVIEW at new HEAD); do NOT rewrite historical Luna JSON
- [x] STOP. No review/push/PR/merge/deploy.

## Resume
Continue from first unchecked `[ ]`. After Phase A/B/C, run final gate. State ends READY_FOR_REVIEW.
