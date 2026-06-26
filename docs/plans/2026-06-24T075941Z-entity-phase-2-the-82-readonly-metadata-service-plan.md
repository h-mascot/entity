# THE-82 Read-Only Google Docs/Drive Metadata Service Plan

## Task
Implement read-only Google Docs/Drive metadata read/list/search/open service APIs with degraded auth handling and no V1 mutation paths.

**Linear Issue:** THE-82  
**Parent:** THE-18 Google Docs/Drive connector V1  
**Created:** 2026-06-24T07:59:41Z  
**Branch:** THE-82-implement-readonly-docs-drive-metadata-service  
**Status:** IN PROGRESS

## Context
Live Linear THE-82 requires service/API support for read/list/search metadata and opening external document references. V1 is constrained to read/index/link/preview only; Google Docs/Drive create, update, export, sync, and write paths must not exist by default. Expired or insufficient auth must return an explicit degraded state instead of healthy metadata.

## Dependencies
- [x] Step 1 has no dependencies beyond clean HEAD `10cafbb` and run-state `currentIssue=THE-82`.
- [x] Step 2 depends on Step 1 plan and branch being ready.
- [x] Step 3 depends on repository list/search support from Step 2.
- [x] Step 4 depends on Step 3 routes.
- [ ] Step 5 depends on all focused tests passing.

## Plan
- [x] Step 1: Confirm live Linear issue/parent, create scoped branch, and write this plan.
  - **Files:** `docs/plans/2026-06-24T075941Z-entity-phase-2-the-82-readonly-metadata-service-plan.md`, `docs/plans/ACTIVE_PLAN.md`
  - **Verify:** `git status --short --branch`
- [x] Step 2: Add repository support for listing/searching ExternalDocumentRefs by org, connector type, query, and linked object ref.
  - **Files:** `packages/db/src/index.ts`
  - **Verify:** `cd packages/server && npx vitest run src/document-objects.test.ts`
- [x] Step 3: Add Google metadata/open helpers and read-only document-object API routes.
  - **Files:** `packages/server/src/google-docs-metadata.ts`, `packages/server/src/document-objects.ts`
  - **Verify:** `cd packages/server && npx vitest run src/document-objects.test.ts`
- [x] Step 4: Add focused read-only, no-mutation, and degraded auth API tests.
  - **Files:** `packages/server/src/document-objects.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/document-objects.test.ts`
- [ ] Step 5: Run gates/proof, commit scoped files, update Linear, and advance run-state to THE-83.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, `output/entity-phase-2/test-gate/THE-82.proof.txt`, `output/entity-phase-2/book-review/THE-82.json`
  - **Verify:** `/Users/enterprise/Code/cli-tester/bin/project-test-gate request/run/book-review/verify THE-82`; `cd packages/server && npm run build && npx vitest run`; `npm run build`; `bash scripts/proof/entity-phase-2-smoke.sh`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 2026-06-24T07:59Z | Step 1 | Done | Run-state confirmed THE-82; live child and parent Linear bodies fetched; branch created from `10cafbb`. |
| 2026-06-24T08:02Z | Steps 2-4 | Done | External ref list/search, metadata/open helpers, and read-only/no-mutation/degraded API tests added; focused Vitest passed. |

## Files Touched
- `docs/plans/2026-06-24T075941Z-entity-phase-2-the-82-readonly-metadata-service-plan.md` - created - issue execution plan.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution pointer for THE-82.
- `packages/db/src/index.ts` - modified - ExternalDocumentRef list/search repository support.
- `packages/server/src/google-docs-metadata.ts` - created - read-only metadata/open degraded-state helper.
- `packages/server/src/document-objects.ts` - modified - read-only metadata/open API routes.
- `packages/server/src/document-objects.test.ts` - modified - read-only/no-mutation/degraded auth API tests.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - SQLite ExternalDocumentRef list/search coverage.
- `.cursor/run-state/entity-phase-2.json` - planned - local pointer advanced after Linear closeout, not committed.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Confirm branch is `THE-82-implement-readonly-docs-drive-metadata-service` and run-state still has `currentIssue=THE-82` unless Step 5 is complete.
4. Find the first unchecked step above and continue there.
5. Do not add Google create/update/export/sync/write endpoints; V1 remains read/index/link/preview only.

## Done
- [ ] All plan steps complete.
- [ ] Focused tests pass.
- [ ] Full proof commands pass.
- [ ] CLI Tester request/run/book-review/verify receipts captured.
- [ ] Linear THE-82 proof comment posted and issue moved to Done.
- [ ] Run-state advanced to THE-83.
