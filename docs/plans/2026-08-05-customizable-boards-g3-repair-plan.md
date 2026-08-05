# Customizable Boards — Generation 3 Repair Plan (D4–D7)

Worktree: `/Users/enterprise/Code/entity-customizable-boards-runner-20260805`
Base: `6049cdf1fb1006ff8eedb5a60b51bb08f8e2c91b` · Start HEAD: `275c90c4597b1833aa908c3ee48a02b5c2ae9de4`
Worker: Pi citadel/glm5.2 (thinking medium). Node 22 leads PATH.
Production is forbidden. Do not touch canonical `/Users/enterprise/Code/entity` or any sandbox.

Source: `repair-map-g3.md` + `review-luna-high.closed.275c90c.json` (4 actionable defects).

## Slices (sequential narrow TDD: RED → GREEN)

### D4 — Trusted tenant authority boundary (BRD-001+004) [HIGH]
Caller-supplied `x-entity-org-id`/`x-entity-team-id` are treated as tenant
authority on boards + Run-with-agents without trusted-context binding.
- [ ] RED: `packages/server/src/tenant-scope.test.ts` — headers ignored (fail
      closed to configured workspace) by default; honored only behind explicit
      `ENTITY_TRUST_TENANT_HEADERS`.
- [ ] GREEN: new `packages/server/src/tenant-scope.ts` `resolveTrustedTenantScope`.
- [ ] Wire `routes/boards.ts` `repoFor` + `swarm/routes.ts` `resolveRequestScope`.
- [ ] Update existing isolation tests to exercise the trusted-proxy path; add a
      fail-closed (no flag) test.
- Verify: `cd packages/server && npx vitest run src/tenant-scope.test.ts src/routes/boards.test.ts src/swarm/task-run-routes.test.ts`

### D5 — Scoped task-linked Swarm reads (BRD-004) [HIGH]
`GET /jobs/:id`, `GET /jobs/:id/proofs`, `GET /jobs?task_id=` are unscoped.
- [ ] RED: cross-tenant read tests in `swarm/task-run-routes.test.ts` (detail /
      proofs / list-by-task → 404 for out-of-scope task-linked job).
- [ ] GREEN: route-layer ownership via the linked task (`resolveTask` +
      `isTaskInScope`); unlinked operational jobs unchanged; Swarm APIs retained.
- Verify: `cd packages/server && npx vitest run src/swarm/task-run-routes.test.ts`

### D6 — Strategic filter domain contract (BRD-002+003) [MEDIUM]
Strategic filter restriction is UI-only; server/repo accept arbitrary filters.
- [ ] RED: `db/src/boards.test.ts` repo + helper tests; route direct-PATCH test.
- [ ] GREEN: `enforceStrategicFilterContract` in `db/src/boards.ts`, wired into
      `createBoard`/`updateBoard` (effective view).
- Verify: `cd packages/db && npx vitest run src/boards.test.ts` + server route test.

### D7 — Board reload effect cleanup (BRD-002) [LOW]
Effect calls `reloadBoards()` but does not return its cancellation cleanup.
- [ ] RED: `app/src/lib/boardReload.test.ts` cancellation-contract test.
- [ ] GREEN: `app/src/lib/boardReload.ts` `runBoardReload` (+ cancel); App.tsx
      effect returns cleanup with ref-guarded single initiation.
- Verify: `cd packages/app && npm test` (node:test picks up new lib test).

## Gate & receipts
- [ ] `cd packages/server && npm run build && npx vitest run`
- [ ] `npm --prefix packages/app run build` + app tests
- [ ] `npm --prefix packages/db run build` + db tests
- [ ] `PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run ctrl:gate` → `ctrl-gate-g3.log`
- [ ] `git diff --check`; private-default/secrets/diff-scope checks
- [ ] Commit scoped code/tests/docs; worktree clean
- [ ] Write `red-green-receipt-g3.md`, `focused-proof-g3.md`; update `runner-state.json` → READY_FOR_REVIEW at new HEAD

## Files touched
- `packages/server/src/tenant-scope.ts` (new) + `tenant-scope.test.ts` (new)
- `packages/server/src/routes/boards.ts`, `packages/server/src/routes/boards.test.ts`
- `packages/server/src/swarm/routes.ts`, `packages/server/src/swarm/task-run-routes.test.ts`
- `packages/db/src/boards.ts`, `packages/db/src/boards.test.ts`
- `packages/app/src/lib/boardReload.ts` (new) + `boardReload.test.ts` (new)
- `packages/app/src/App.tsx`
- receipts under clawd output root; `runner-state.json`

## Resume (next agent)
If interrupted: `git status` + find first unchecked `[ ]` above; do not redo
completed slices. Each slice is independently revertible via its own commit.
