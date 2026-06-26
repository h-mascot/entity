# THE-81 Google Connector Auth Scope Plan

## Task
Define the Google Docs/Drive connector authorization, scope, degraded reference, and readiness model for V1 read/index/link/preview only.

**Linear Issue:** THE-81
**Parent:** THE-18 Google Docs/Drive connector V1
**Created:** 2026-06-24T07:20:57Z
**Branch:** THE-81-define-google-connector-auth-scope-and-readiness-model
**Status:** IN PROGRESS

## Context
Live Linear THE-81 requires a compact connector model that distinguishes authorized, expired, insufficient scope, revoked/deleted refs, and unavailable readiness without mutating Google Docs or Drive. External connector permission and Entity visibility policy must remain separate. Slice 0 gap matrix is complete and lists THE-81 as the first Google connector model issue.

## Dependencies
- [x] Step 1 has no dependencies beyond clean HEAD `6e09fb0` and run-state `currentIssue=THE-81`.
- [x] Step 2 depends on Step 1 plan being written.
- [x] Step 3 depends on locating the existing ExternalDocumentRef model seams.
- [x] Step 4 depends on focused tests passing.
- [x] Step 5 depends on proof commands and CLI Tester receipts passing.

## Plan
- [x] Step 1: Confirm live Linear issue and create scoped branch/plan.
  - Files: `docs/plans/2026-06-24T072057Z-entity-phase-2-the-81-define-google-connector-auth-plan.md`, `docs/plans/ACTIVE_PLAN.md`
  - Verify: `git status --short --branch`
- [x] Step 2: Add focused failing tests for Google auth/readiness/scopes and separate Entity visibility.
  - Files: `packages/server/src/document-objects.test.ts`, `packages/db/src/index.ts`
  - Verify: `cd packages/server && npx vitest run src/document-objects.test.ts`
- [x] Step 3: Implement only the connector state/type model and read-only V1 scope helpers.
  - Files: `packages/db/src/index.ts`, `packages/server/src/document-objects.ts`
  - Verify: `cd packages/server && npx vitest run src/document-objects.test.ts`
- [x] Step 4: Add the required security note on scopes.
  - Files: `docs/context/entity-phase-2-google-connector-auth-model.md`
  - Verify: `rg "read/index/link/preview" docs/context/entity-phase-2-google-connector-auth-model.md`
- [x] Step 5: Run proof/gates, comment Linear, mark THE-81 Done, advance run-state to THE-82, and commit scoped work.
  - Files: `.cursor/run-state/entity-phase-2.json`, `output/entity-phase-2/test-gate/THE-81.*`, `output/entity-phase-2/book-review/THE-81*`
  - Verify: `bash scripts/proof/entity-phase-2-smoke.sh && npm run build && cd packages/server && npm run build && npx vitest run`
  - Verify: `project-test-gate request/run/book-review/verify THE-81`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 2026-06-24T07:20Z | Step 1 | In progress | Live THE-81/THE-18 fetched; branch created from `6e09fb0`; plan being written. |
| 2026-06-24T07:24Z | Steps 1-4 | Done | Google auth/scope/ref-state model implemented; focused route + DB tests pass under Node 22. |
| 2026-06-24T07:31Z | Step 5 | Done | Proof commands passed; CLI Tester run/verify PASS; Book review locally approved with hard rule 22; Linear comment posted and THE-81 marked Done; run-state advanced to THE-82. |

## Files Touched
- `docs/plans/2026-06-24T072057Z-entity-phase-2-the-81-define-google-connector-auth-plan.md` - created - issue execution plan
- `docs/plans/ACTIVE_PLAN.md` - modified - mirrored active plan
- `packages/db/src/index.ts` - modified - Google connector V1 scope/auth/readiness/ref-state model
- `packages/server/src/document-objects.ts` - modified - external ref API parser fields
- `packages/server/src/document-objects.test.ts` - modified - auth-state route fixture
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - persisted auth/scope/capability fixture
- `docs/context/entity-phase-2-google-connector-auth-model.md` - created - scope security note
- `.cursor/run-state/entity-phase-2.json` - modified - advanced local pointer to THE-82 (not committed)

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Confirm `currentIssue=THE-81` unless Step 5 is complete.
4. Find the first unchecked step above and continue there.
5. Do not implement THE-82 metadata service or any Google write/mutation behavior in this branch.

## Done
- [x] All plan steps complete.
- [x] Focused tests pass.
- [x] Full proof commands pass.
- [x] CLI Tester request/run/book-review/verify receipts captured.
- [x] Linear THE-81 proof comment posted and issue moved to Done.
- [x] Run-state advanced to THE-82.
