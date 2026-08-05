# Plan — Entity Customizable Boards (Governed Runner)

**Created:** 2026-08-05
**Agent:** Pi glm5.2 (worker), Luna gpt-5.6 (read-only review)
**Status:** IN PROGRESS
**Worktree:** `/Users/enterprise/Code/entity-customizable-boards-runner-20260805`
**Branch:** `runner/customizable-boards-20260805`
**Base:** `6049cdf1fb1006ff8eedb5a60b51bb08f8e2c91b`
**External authority:** `/Users/enterprise/clawd/output/entity/customizable-boards-runner-20260805/plan.md`

## Task
Replace the fixed Tasks peer tabs (`Kanban / Strategic / Insights / Swarm`) with a
customizable, persistent board model. Defaults: **General** and **Analytics**.
Templates: **Blank / Strategic / Engineering**. Swarm becomes a task execution
capability ("Run with agents"), not a board. Preserve all existing tasks/data and
Swarm capability.

## Context
- Existing fixed tabs: `packages/app/src/lib/mcBoardTabs.ts` + `App.tsx` (`mcBoardTab`).
- DB patterns: standalone modules (`packages/db/src/file-sources.ts`) with
  `getEntityDatabase(ensureXSchema)` + `createXRepository()` factory; strategic repo
  singleton in `packages/db/src/index.ts`. Server imports db via `../../db/src/*`.
- Swarm jobs already carry `task_id` (`packages/server/src/swarm/db.ts`).
- Strict TDD: RED first (record cmd+output), then GREEN, refactor while green.

## Dependencies
- BRD-002 depends on BRD-001 (board API + domain types).
- BRD-003 depends on BRD-002 (board switcher UI + stored-tab migration).
- BRD-004 depends on BRD-001 (board API exists) but is otherwise independent of 002/003.
- BRD-005 (gates/review/delivery) depends on all prior.

## Plan (slices, each = RED → GREEN → refactor → commit)

### BRD-001 — Persistent board domain + API
- [x] 1a. Pure domain helpers (views/templates/validation, filter-config normalize,
  legacy-tab→default-board-key migration). `packages/db/src/boards.ts`
  - **Verify:** `cd packages/db && npx vitest run src/boards.test.ts -t "domain"`
- [x] 1b. Repository persistence (schema ensure, CRUD, seed General/Analytics idempotent,
  reorder, delete-default guard) against temp DB. `packages/db/src/boards.ts`
  - **Verify:** `cd packages/db && npx vitest run src/boards.test.ts`
- [x] 1c. REST API `createBoardsRouter()` (list/create/update/reorder/delete + error
  paths), mounted at `/api/boards`. `packages/server/src/routes/boards.ts` + index.ts mount
  - **Verify:** `cd packages/server && npx vitest run src/routes/boards.test.ts`
- [x] 1d. Full db+server gate for BRD-001. Commit slice.
  - **Verify:** `cd packages/db && npx vitest run && cd ../server && npm run build && npx vitest run`

### BRD-002 — Board navigation + customization UI
- [x] 2a. Board reducer/adapter (load, select, create-from-template, rename, reorder,
  delete) as pure logic in `packages/app/src/lib/boards*.ts`. RED-first.
- [x] 2b. Board switcher component in App.tsx replacing fixed tabs; General=board,
  Analytics=analytics; + Add board from templates. Responsive/mobile-safe, accessible.
- [x] 2c. Wire board selection to existing TaskBoard/analytics surfaces; persist after
  reload. Rebuild app; browser verify.

### BRD-003 — Task membership/filter behavior + migration
- [ ] 3a. Filter adapter (derive visible tasks from board filter_config; Engineering
  template defaults use work-domain/project metadata). Pure reducer tests.
- [ ] 3b. Migrate stored `entity.tasks.tab` (kanban/insights/strategic/plugin ids) to a
  valid board on load; never blank screen. Regression tests.

### BRD-004 — Swarm as task execution capability
- [ ] 4a. Remove Swarm from board selector (already not a default board; ensure no entry).
- [ ] 4b. "Run with agents" control in TaskDetailPanel: create task-linked swarm job via
  `/api/swarm/jobs`, prevent duplicate active jobs, show progress/error/proof. RED-first
  route/state tests for linkage, duplicate-active handling, error paths.

### BRD-005 — Proof, review, delivery, sandbox QA
- [ ] 5a. `npm run ctrl:gate` (build + unit) from this worktree; save `ctrl-gate.log`.
- [ ] 5b. Private-default/secrets/diff inspection; save receipts.
- [ ] 5c. Fresh read-only Luna-high review at HEAD; bounded repair if actionable.
- [ ] 5d. Non-production delivery (push/PR/CI/merge when clean). Stop at READY_FOR_REVIEW.

## Files Touched (running log)
- `packages/db/src/boards.ts`, `packages/db/src/boards.test.ts` (BRD-001)
- `packages/server/src/routes/boards.ts`, `packages/server/src/routes/boards.test.ts` (BRD-001)
- `packages/server/src/index.ts` (+import +mount `/api/boards`) (BRD-001)
- commit `ab5f2b7`
- `packages/app/src/lib/boardsState.ts` (+test), `packages/app/src/lib/boardsClient.ts`, `packages/app/src/components/BoardSwitcher.tsx`, `packages/app/src/App.tsx` (BRD-002)

## Resume Instructions
On compaction/restart: re-read AGENTS.md → CONTEXT.md → external plan.md → source-map.json
→ runner-state.json → `git status`/`git log`. Find first unchecked `[ ]` above and
continue from there. Do NOT redo completed steps. Keep receipts in the external receipt
root only.
