## Task
Entity Phase 2 THE-60: build worktype overlay UI, filters, and docs.

**MC Task:** THE-60
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** PROOF PASSED; CLI GATES PENDING

## Context
Live Linear issue THE-60 is child issue THE-13.5 under THE-13 worktype registry and overlays. Scope is to render domain-appropriate sales/CS/people/business-ops fields without forcing engineering/spec language, expose declared indexable overlay filter fields safely, and document registry/overlay versioning/migration behavior.

## Dependencies
- [x] Current run-state points to THE-60.
- [x] THE-59 completed, committed, and Linear Done.
- [x] Branch created from 78fff00: `THE-60-build-worktype-overlay-ui-filters-and-docs`.
- [x] Existing task create/detail UI, search/filter UI, and docs patterns inspected before implementation.

## Plan

- [x] Step 1: Inspect task create/detail UI, search/filter UI, shared task types, and existing docs patterns.
  - **Files:** `packages/app/src`, docs under `docs/`
  - **Verify:** source reads/search complete
- [x] Step 2: Expose registry metadata to the app/API path needed by UI without leaking restricted values.
  - **Files:** server/db/app types as needed
  - **Verify:** focused tests or type/build coverage
- [x] Step 3: Render worktype overlays on task create/detail with domain labels for sales, customer-success, people, and business-ops.
  - **Files:** task board/detail/create components
  - **Verify:** DOM proof for overlay fields
- [x] Step 4: Add safe search/filter UI for declared indexable overlay fields.
  - **Files:** search/filter components/routes as applicable
  - **Verify:** DOM proof and build/test
- [x] Step 5: Add docs/ADR explaining registry, overlay versioning, and migration behavior.
  - **Files:** docs
  - **Verify:** doc file created and linked where appropriate
- [x] Step 6: Run required proof commands and browser/DOM proof.
  - **Files:** no source edits expected
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`; `npm run build`; `cd packages/server && npm run build && npx vitest run`; browser/DOM screenshot or text receipt for THE-60 UI
- [ ] Step 7: Run CLI Tester request/run/book-review/verify and apply packet-mode local approval only if scans are 0/0 and diff is issue-scoped.
  - **Files:** `output/entity-phase-2/test-gate/THE-60.*`, `output/entity-phase-2/book-review/THE-60*`
  - **Verify:** CLI Tester verify reports PASS and `nextChildBlocked=false`
- [ ] Step 8: Comment Linear, mark THE-60 Done, update run-state to THE-61, and commit only scoped source/test/docs/plan changes.
  - **Files:** `.cursor/run-state/entity-phase-2.json` local state only, source/tests/docs/plan for commit as appropriate
  - **Verify:** `git status --short`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 03:36Z | Setup | done | Read live child issue; branch created from THE-59 commit. |
| 03:44Z | Implementation/proof | done | App create/detail/filter overlay UI implemented; proof commands passed; Playwright DOM proof captured at `output/entity-phase-2/browser-proof/THE-60-people-overlay-create.png` and snapshot output `agent-tools/5b6a7c19-fbef-4474-8f12-1058a75cd4ba.txt`. |

## Files Touched
- `docs/plans/2026-06-24-033600-entity-phase-2-the-60-worktype-overlay-ui-filters-docs-plan.md` - created - THE-60 execution plan.
- `docs/plans/ACTIVE_PLAN.md` - mirrored - active THE-60 plan.
- `docs/worktype-overlays.md` - created - registry, versioning, filter, and migration behavior.
- `packages/server/src/routes/worktype-registry.ts` - created - versioned registry API router.
- `packages/server/src/routes/worktype-registry.test.ts` - created - registry route test.
- `packages/server/src/index.ts` - updated - mounts registry route and forwards task worktype policy inputs.
- `packages/app/src/components/mission-control/utils/worktypeRegistry.ts` - created - frontend registry helper and overlay parser.
- `packages/app/src/hooks/useTaskBoard.ts` - updated - preserves worktype and policy inputs in task payloads.
- `packages/app/src/components/mission-control/MCCreateTaskModal.tsx` - updated - renders domain overlay fields on create.
- `packages/app/src/components/mission-control/TaskDetailPanel.tsx` - updated - displays recorded overlay values.
- `packages/app/src/components/mission-control/MCOpsView.tsx` - updated - adds indexable overlay filter/search support.
- `packages/app/src/components/TaskBoard.tsx` - updated - adds task board worktype and indexable overlay filters.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from the first unchecked step; do not redo completed work.
5. Keep THE-60 scoped to overlay UI, safe indexable filter UI, and registry/versioning docs. Browser/DOM proof is mandatory because the issue is UI-facing.

## Done
- [ ] All steps complete
- [x] Tests/build pass
- [x] Browser/DOM proof captured
- [ ] CLI Tester request/run/book-review/verify complete
- [ ] Linear THE-60 proof comment added and status moved to Done
- [ ] Run-state advanced to THE-61
