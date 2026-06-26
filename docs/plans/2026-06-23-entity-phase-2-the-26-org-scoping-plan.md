# Entity Phase 2 THE-26 Org Scoping Plan

## Task
Implement `THE-26` (`THE-7.1`) by adding the foundational org/team/project schema and request org-scoping seam for downstream workspace hierarchy/accountability work.

**MC Task:** THE-26  
**Created:** 2026-06-23  
**Agent:** Cursor  
**Status:** BLOCKED ON BOOK REVIEW

## Context
Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, Phase 2 context/spec files, `.project-gate.json`, and the execution-pack plan.

`THE-26` is a child of `THE-7`. It is dependency-safe because `THE-25` is marked Done in Linear, Book review is `APPROVED`, and `project-test-gate verify THE-25` passed under Node v22.22.2 with no blockers.

Scope is the foundational seam only: add or define migration-safe org/team/project/task scoping fields, require org context in service query helpers, and prove cross-org denial by construction. Do not implement the later full service API/UI/backfill children (`THE-27` through `THE-30`) unless strictly needed as a seam for `THE-26`.

## Dependencies
- [x] Live Linear body confirms `THE-26` maps to `THE-7.1`.
- [x] Parent epic `THE-7` confirms workspace hierarchy/accountability scope.
- [x] `THE-25` gate, Book review, and verify receipts allow continuation.
- [x] Branch `THE-26-add-org-team-project-schema-and-request-org-scoping-seam` exists.
- [x] Existing DB schema, repository helpers, request context, and tests are inspected.
- [x] Implementation stays scoped to data/request-org seam and focused tests.
- [ ] Required proof commands and CLI Tester gates pass. Local proof and machine gate pass; Book review is `REQUESTED/BLOCKED`.

## Plan
- [x] Step 1: Confirm issue mapping, parent, and dependency safety.
  - **Files:** Linear `THE-26`, `THE-7`, `.cursor/run-state/entity-phase-2.json`, `output/entity-phase-2/test-gate/THE-25.json`, `output/entity-phase-2/book-review/THE-25.json`
  - **Verify:** `project-test-gate verify THE-25` under Node v22.22.2
- [x] Step 2: Inspect existing data/request seams and tests.
  - **Files:** `packages/db/src/*`, `packages/server/src/*`, existing tests around repositories/routes/request context
  - **Verify:** targeted reads/searches identify existing patterns before editing
- [x] Step 3: Implement migration-safe org/team/project schema and org-bound query helper seam.
  - **Files:** expected `packages/db/src/*` and/or scoped server request context files, pending inspection
  - **Verify:** TypeScript build plus focused tests
- [x] Step 4: Add focused success and cross-org denial tests.
  - **Files:** colocated tests near modified DB/server code
  - **Verify:** focused `npx vitest run <test files>`
- [x] Step 5: Update local run state and any required docs/receipts.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, this plan, `docs/plans/ACTIVE_PLAN.md`
  - **Verify:** `git status --short --branch`
- [ ] Step 6: Run proof and gate commands.
  - **Files:** proof receipts under `output/entity-phase-2/`
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, and `cd packages/server && npm run build && npx vitest run` pass; CLI Tester `request` and `run` pass; CLI Tester `book-review` is blocked with `decision=REQUESTED`, `safeToContinue=false`, so `verify` is not run.
- [ ] Step 7: Commit scoped work and post Linear proof comment.
  - **Files:** changed implementation/tests/docs; local state remains uncommitted
  - **Verify:** `git status --short --branch`, `git log -1 --oneline`, Linear comment response

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 02:37 | Step 1 | done | `THE-25` verified PASS under Node v22.22.2; `THE-26` child and parent fetched; branch created. |
| 02:41 | Steps 2-4 | done | Added migration-safe org/team/project/task scoping fields and org-bound repository helpers; focused DB repository test passes. |
| 02:42 | Proof | done | `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, and `cd packages/server && npm run build && npx vitest run` all passed under Node v22.22.2. |
| 02:43 | Gate | blocked | CLI Tester `request` and `run` passed; `book-review` wrote `output/entity-phase-2/book-review/THE-26.json` with `decision=REQUESTED`, `safeToContinue=false`. Do not start `THE-27`. |

## Files Touched
- `docs/plans/2026-06-23-entity-phase-2-the-26-org-scoping-plan.md` - created - compaction-safe plan for current issue.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution plan for current issue.
- `packages/db/src/index.ts` - modified - org/team/project schema, scoped repository interfaces, migration/backfill, and org-bound helper implementations.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - focused success and cross-org denial test coverage.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Continue from the first unchecked step above.
5. Do not start `THE-27` until `THE-26` Book review is `APPROVED`, `safeToContinue=true`, and CLI Tester `verify THE-26` passes with `nextChildBlocked=false`, or Henry explicitly waives the gate.

## Done
- [x] All local implementation/proof steps complete.
- [x] Proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass.
- [ ] Linear proof comment added.
- [ ] `THE-27` identified as next candidate only after verify allows continuation.
