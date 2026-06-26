## Task
Entity Phase 2 THE-63: implement permission-safe content envelopes.

**MC Task:** THE-63
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** DONE

## Context
Live Linear issue THE-63 is child issue THE-14.3 under THE-14 permissions, sensitivity, and search envelope. Scope is wrapping tasks, artifacts, activity, docs, external refs, previews, snippets, notifications, and status refs in permission-aware envelopes so restricted content is suppressed before render.

## Dependencies
- [x] Current run-state points to THE-63.
- [x] THE-62 completed, committed, and Linear Done.
- [x] Branch created from 8196d33: `THE-63-implement-permission-safe-content-envelopes`.
- [x] Existing evaluator, request-org helpers, document-object routes, search route, and UI placeholder readers inspected before implementation.

## Plan

- [x] Step 1: Extend permission-safe envelope output with stable visibility metadata and restricted placeholders.
  - **Files:** `packages/server/src/permissions.ts`, `packages/server/src/permissions.test.ts`
  - **Verify:** focused permission leakage tests
- [x] Step 2: Return permission envelopes for document-object read/preview seams while keeping cross-org access as no-object denial.
  - **Files:** `packages/server/src/request-permissions.ts`, `packages/server/src/document-objects.ts`, `packages/server/src/document-objects.test.ts`
  - **Verify:** restricted same-org placeholder API test and cross-org no-leak test
- [x] Step 3: Apply search-result envelopes so snippets/content are suppressed before API response rendering.
  - **Files:** `packages/server/src/routes/search.ts`, `packages/server/src/__tests__/routes-search.test.ts`
  - **Verify:** search leakage test with mocked qmd JSON
- [x] Step 4: Run required proof commands, GitNexus detect-changes, and CLI Tester request/run/book-review/verify.
  - **Files:** `output/entity-phase-2/test-gate/THE-63.*`, `output/entity-phase-2/book-review/THE-63*`
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`; `npm run build`; `cd packages/server && npm run build && npx vitest run`; CLI Tester verify PASS
- [x] Step 5: Comment Linear, mark THE-63 Done, update run-state to THE-64, and commit only scoped source/test/plan changes.
  - **Files:** `.cursor/run-state/entity-phase-2.json` local state only, source/test/plan for commit as appropriate
  - **Verify:** `git status --short`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 04:20Z | Setup | done | Read live child issue; branch created from THE-62 completion commit; envelope/search/document placeholder seams inspected. |
| 04:17Z | Implementation | done | Added permission metadata envelopes, document-object same-org restricted placeholders, search snippet/content suppression, and focused leakage tests. |
| 04:24Z | Proof | done | Focused tests, server build, smoke, root build, full server Vitest, GitNexus detect-changes, and CLI Tester request/run/book-review/verify passed; Book packet-mode locally approved under hard rule 22 with clean scans. |
| 04:25Z | Linear/run-state | done | Final proof comment and Linear Done handled after verification; run-state advanced to THE-64. |

## Files Touched
- `docs/plans/2026-06-24-042000-entity-phase-2-the-63-permission-safe-content-envelopes-plan.md` - created - THE-63 execution plan.
- `docs/plans/ACTIVE_PLAN.md` - mirrored - active THE-63 plan.
- `packages/server/src/permissions.ts` - updated - stable visible/restricted envelope metadata and placeholders.
- `packages/server/src/permissions.test.ts` - updated - visible envelope and restricted no-leak assertions.
- `packages/server/src/request-permissions.ts` - updated - request-bound record envelope helper.
- `packages/server/src/document-objects.ts` - updated - read/version envelope responses for document/artifact objects.
- `packages/server/src/document-objects.test.ts` - updated - same-org restricted placeholder API proof.
- `packages/server/src/routes/search.ts` - updated - search result permission envelopes.
- `packages/server/src/__tests__/routes-search.test.ts` - updated - mocked restricted search no-leak proof.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from the first unchecked step; do not redo completed work.
5. Keep THE-63 scoped to permission-safe envelopes and restricted placeholder/no-leak behavior.

## Done
- [x] All steps complete
- [x] Tests/build pass
- [x] CLI Tester request/run/book-review/verify complete
- [x] Linear THE-63 proof comment added and status moved to Done
- [x] Run-state advanced to THE-64
