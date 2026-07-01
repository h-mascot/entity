## Task

Refactor Doc Hub document-comment agent replies toward route/service separation, then run autoreview and thermo-nuclear review.

**MC Task:** N/A
**Created:** 2026-07-01
**Agent:** GPT-5.5
**Status:** COMPLETE

## Context

The current branch has a verified working Doc Hub document-comment @agent workflow. Another branch has a cleaner route/service separation: routes trigger mention response, service provides a context builder. User asked to implement in goal mode and then run autoreview plus thermo-nuclear review.

## Dependencies

- [x] Step 1 has no dependencies
- [x] Step 2 depends on comparing the two implementations
- [x] Step 3 depends on refactor passing targeted tests
- [x] Step 4 depends on automated gates passing
- [x] Step 5 depends on built app and local server
- [x] Step 6 depends on final diff and tests

## Plan

- [x] Step 1: Confirm branch state and compare other branch's unique design
  - **Files:** `packages/server/src/agent/document-comment-responder.ts`, `packages/server/src/editor/{index,routes,service}.ts`
  - **Verify:** `git diff HEAD..origin/cursor/doc-hub-agent-comments-8a39 -- packages/server/src/editor`
- [x] Step 2: Refactor responder trigger to route-level and service-owned context
  - **Files:** `packages/server/src/agent/document-comment-responder.ts`, `packages/server/src/editor/{index,routes,service}.ts`
  - **Verify:** `cd packages/server && npx vitest run src/agent/document-comment-responder.test.ts src/editor/service.test.ts`
- [x] Step 3: Preserve UI/runtime fixes and update tests
  - **Files:** `packages/app/src/App.tsx`, `packages/server/src/fs/*`, tests
  - **Verify:** targeted tests for auth, fs, responder, service
- [x] Step 4: Run full gates
  - **Files:** none
  - **Verify:** `cd packages/server && npm run build && npx vitest run`; `npm run build`
- [x] Step 5: Browser/API verify Doc Hub workflow
  - **Files:** artifacts only if new proof is needed
  - **Verify:** `/api/fs/tree`, `/api/documents/:docId/comments`, browser comments sidebar
- [x] Step 6: Run requested review passes and push PR update
  - **Files:** PR body/artifacts
  - **Verify:** autoreview output and thermo-nuclear review output recorded in final summary

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 01:13 | Step 1 | ⏳ | Started goal-mode refactor after comparing branches |
| 01:17 | Step 1-3 | ✅ | Refactored route/service responder boundary; targeted tests passed |
| 01:19 | Step 4 | ✅ | Full server gate and root build passed |
| 01:29 | Step 4 | ✅ | Fixed autoreview/thermo findings; targeted tests, full server gate, and root build passed |
| 01:40 | Step 4 | ✅ | Fixed second review auth/sanitization/default findings; targeted tests, full server gate, and root build passed |
| 01:51 | Step 4 | ✅ | Fixed final thermo findings for disabled sources, service actor binding, runtime URL exposure, and supported review fallback |
| 02:02 | Step 4 | ✅ | Fixed final autoreview findings for suggestion acceptance and legacy review type normalization; full gates passed |
| 02:06 | Step 5-6 | ✅ | Final API/browser proof completed; review passes rerun after fixes |

## Files Touched

- `docs/plans/2026-07-01-doc-comment-responder-refactor-plan.md` — created — resumable execution plan
- `docs/plans/ACTIVE_PLAN.md` — updated — active execution plan
- `packages/server/src/agent/document-comment-responder.ts` — modified — route-triggered responder with injected context/model hooks
- `packages/server/src/agent/document-comment-responder.test.ts` — modified — route-triggered responder tests
- `packages/server/src/editor/service.ts` — modified — `getCommentMentionContext` and thread trigger ids
- `packages/server/src/editor/service.test.ts` — modified — context and trigger id tests
- `packages/server/src/editor/routes.ts` — modified — triggers comment mention responder after create/reply
- `packages/server/src/editor/index.ts` — modified — wires responder with service context builder
- `packages/server/src/middleware/api-auth.ts` — modified — lets Documents API self-authenticate under global API auth
- `packages/server/src/middleware/api-auth.test.ts` — modified — covers Documents API global-auth bypass
- `packages/server/src/editor/auth.ts` — modified — aligns default known service actors with UI hints
- `packages/server/src/editor/auth.test.ts` — modified — covers default UI service actors
- `packages/app/src/components/mission-control/useReviewCompletion.ts` — modified — removes private reviewer fallback
- `packages/app/src/components/mission-control/reviewActions.ts` — modified — uses supported peer review type fallback
- `packages/app/src/components/mission-control/TaskCard.tsx` — modified — uses generic required-reviewer display label
- `packages/app/src/components/mission-control/MCOpsView.tsx` — modified — removes private reviewer/type fallbacks
- `packages/app/src/types/collaboration.ts` — modified — removes runtime URL from document health/index response types
- `packages/app/src/lib/documents-client.ts` — modified — stops parsing runtime URL from document health/index responses
- `packages/server/src/index.ts` — modified — removes runtime URL from legacy document health/index responses

## Resume Instructions

1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections
5. Continue from there — do NOT redo completed steps.

## Done

- [x] All steps complete
- [x] Tests pass (if applicable)
- [x] PR created or updated
- [x] ACTIVE_PLAN.md cleared or updated for next task
