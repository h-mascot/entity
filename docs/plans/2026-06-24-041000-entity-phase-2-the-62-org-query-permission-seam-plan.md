## Task
Entity Phase 2 THE-62: enforce org/query permission seam across APIs.

**MC Task:** THE-62
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** DONE

## Context
Live Linear issue THE-62 is child issue THE-14.2 under THE-14 permissions, sensitivity, and search envelope. Scope is mandatory request-org predicates and permission checks across service/API/search seams so cross-org and restricted content fail before rendering.

## Dependencies
- [x] Current run-state points to THE-62.
- [x] THE-61 completed, committed, and Linear Done.
- [x] Branch created from 7fe556c: `THE-62-enforce-org-query-permission-seam-across-apis`.
- [x] Existing task, document-object, and search route seams inspected before implementation.

## Plan

- [x] Step 1: Add reusable request-org/API permission helpers for safe explicit denial responses.
  - **Files:** `packages/server/src/request-permissions.ts`
  - **Verify:** focused API tests compile
- [x] Step 2: Enforce request org binding and evaluator checks in document-object API read/write/link seams.
  - **Files:** `packages/server/src/document-objects.ts`, `packages/server/src/document-objects.test.ts`
  - **Verify:** cross-org and restricted document/artifact denial tests
- [x] Step 3: Enforce request org binding on search/document seams before returning query results or document content.
  - **Files:** `packages/server/src/routes/search.ts`, `packages/server/src/__tests__/routes-search.test.ts`
  - **Verify:** search route denial tests
- [x] Step 4: Run required proof commands, GitNexus detect-changes, and CLI Tester request/run/book-review/verify.
  - **Files:** `output/entity-phase-2/test-gate/THE-62.*`, `output/entity-phase-2/book-review/THE-62*`
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`; `npm run build`; `cd packages/server && npm run build && npx vitest run`; CLI Tester verify PASS
- [x] Step 5: Comment Linear, mark THE-62 Done, update run-state to THE-63, and commit only scoped source/test/plan changes.
  - **Files:** `.cursor/run-state/entity-phase-2.json` local state only, source/test/plan for commit as appropriate
  - **Verify:** `git status --short`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 04:10Z | Setup | done | Read live child issue; branch created from THE-61 completion commit; route seams inspected. |
| 04:13Z | Implementation | done | Added request-org helper, document-object permission checks, search org binding, and API denial tests. Service query review: document-object reads/writes/links and search/document content now require request org before data returns. |
| 04:12Z | Proof | done | Smoke, root build, server build+Vitest, GitNexus detect-changes, CLI Tester request/run/book-review/verify passed; Book packet-mode locally approved under hard rule 22 with clean scans. |

## Files Touched
- `docs/plans/2026-06-24-041000-entity-phase-2-the-62-org-query-permission-seam-plan.md` - created - THE-62 execution plan.
- `docs/plans/ACTIVE_PLAN.md` - mirrored - active THE-62 plan.
- `packages/server/src/request-permissions.ts` - created - request org/principal helper and safe denial responses.
- `packages/server/src/document-objects.ts` - updated - org-bound permission checks for document/artifact APIs.
- `packages/server/src/document-objects.test.ts` - updated - org binding, cross-org, and restricted denial tests.
- `packages/server/src/routes/search.ts` - updated - request org required before search/document content responses.
- `packages/server/src/__tests__/routes-search.test.ts` - updated - search/document org denial tests.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from the first unchecked step; do not redo completed work.
5. Keep THE-62 scoped to request-org/API/search denial seams and tests.

## Done
- [x] All steps complete
- [x] Tests/build pass
- [x] CLI Tester request/run/book-review/verify complete
- [x] Linear THE-62 proof comment added and status moved to Done
- [x] Run-state advanced to THE-63
