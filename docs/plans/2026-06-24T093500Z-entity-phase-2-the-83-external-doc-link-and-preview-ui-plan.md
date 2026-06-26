## Task

**MC Task:** THE-83  
**Created:** 2026-06-24T09:35:00Z  
**Agent:** gpt-5.5  
**Status:** IN PROGRESS

## Context

Implement THE-18.3 from the Google Docs/Drive V1 read-only parent. Build on THE-82's read-only external document ref metadata/open routes. V1 remains link/preview/open only: no inline edit, no Google mutation, no sync/export/write controls. Expired or insufficient auth must render as an explicit degraded state.

## Dependencies

- [x] Run-state pointer is `THE-83`.
- [x] Branch `THE-83-implement-external-doc-link-and-preview-ui` was created from `a58da4f`.
- [x] Live Linear issue THE-83 and parent THE-18 body were read.
- [ ] App UI work depends on current `TaskDetailPanel` document object rendering and THE-82 metadata fields.
- [ ] Proof and Linear updates depend on implementation tests/builds passing.

## Plan

- [x] Step 1: Add a testable external document preview view-model for Google Docs/Drive refs.
  - **Files:** `packages/app/src/components/mission-control/utils/externalDocumentPreview.ts`, `packages/app/src/components/mission-control/utils/__tests__/externalDocumentPreview.test.ts`
  - **Verify:** `node --test packages/app/src/components/mission-control/utils/__tests__/externalDocumentPreview.test.ts`
- [x] Step 2: Wire the preview UI into task detail document cards.
  - **Files:** `packages/app/src/components/mission-control/TaskDetailPanel.tsx`
  - **Verify:** `npm --prefix packages/app run build`
- [x] Step 3: Keep API no-mutation coverage green and add any missing UI/degraded assertions.
  - **Files:** `packages/server/src/document-objects.test.ts` if needed
  - **Verify:** `cd packages/server && npx vitest run src/document-objects.test.ts`
- [ ] Step 4: Run the required gates, commit issue-scoped files, update Linear, and advance run-state.
  - **Files:** `docs/plans/ACTIVE_PLAN.md`, `.cursor/run-state/entity-phase-2.json`
  - **Verify:** `/Users/enterprise/Code/cli-tester/bin/project-test-gate \`request THE-83\``, `/Users/enterprise/Code/cli-tester/bin/project-test-gate \`run THE-83\``, `/Users/enterprise/Code/cli-tester/bin/project-test-gate \`book-review THE-83\``, `/Users/enterprise/Code/cli-tester/bin/project-test-gate \`verify THE-83\``, `cd packages/server && npm run build && npx vitest run`, `npm run build`, `bash scripts/proof/entity-phase-2-smoke.sh`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 09:35 | Setup | DONE | Run-state, Linear body, parent body, and branch verified. |
| 09:46 | Step 1 | DONE | Added preview view-model and 4 focused Node tests. |
| 09:48 | Step 2 | DONE | Wired external preview surface into task detail and app build passed. |
| 09:49 | Step 3 | DONE | Existing document-object Vitest suite passed: 13/13. |

## Files Touched

- `docs/plans/2026-06-24T093500Z-entity-phase-2-the-83-external-doc-link-and-preview-ui-plan.md` — created — compaction-survivable plan.
- `docs/plans/ACTIVE_PLAN.md` — modified — points to this issue plan.
- `packages/app/src/components/mission-control/utils/externalDocumentPreview.ts` — created — Google external doc preview view-model.
- `packages/app/src/components/mission-control/utils/__tests__/externalDocumentPreview.test.ts` — created — link/preview, degraded auth, and no-mutation tests.
- `packages/app/src/components/mission-control/TaskDetailPanel.tsx` — modified — renders external doc preview/link-out/read-only posture.

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from there without redoing completed steps.

## Done

- [ ] All steps complete.
- [ ] Tests pass.
- [ ] CLI Tester request/run/book-review/verify receipts pass.
- [ ] THE-83 committed locally.
- [ ] Linear THE-83 proof comment posted and issue moved to Done.
- [ ] Run-state advanced to THE-84.
