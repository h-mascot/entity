## Task
Implement `THE-27` (`THE-7.2`) by exposing workspace hierarchy service APIs for orgs, teams, and projects on top of the org-scoped schema seam from `THE-26`.

**MC Task:** THE-27
**Created:** 2026-06-23
**Agent:** Cursor
**Status:** BLOCKED ON BOOK REVIEW

## Context
Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, Phase 2 context/spec files, `.project-gate.json`, and the execution-pack plan.

`THE-27` is a child of `THE-7`. It is dependency-safe because live Linear says `THE-26` is Done, the `THE-26` Book review receipt is APPROVED with `safeToContinue=true`, and the `THE-26` gate receipt reports `reviewGateStatus=PASS`.

Scope is the workspace hierarchy service/API layer only: create/read/update/list flows for orgs, teams, and projects with tenant isolation and explicit errors for missing or unauthorized scopes. Do not implement workspace navigation UI (`THE-29`), accountability enforcement (`THE-28`), or backfill (`THE-30`) unless a minimal hook is required for the API seam.

## Dependencies
- [x] Live Linear body confirms `THE-27` maps to `THE-7.2`.
- [x] Parent epic `THE-7` confirms workspace hierarchy/accountability scope.
- [x] `THE-26` gate and Book review receipts allow continuation.
- [x] Branch `THE-27-implement-workspace-hierarchy-service-apis` exists.
- [x] Existing DB repository, route, request context, and test patterns are inspected.
- [x] Implementation stays scoped to hierarchy service APIs and focused API tests.
- [ ] Required proof commands and CLI Tester gates pass. Local proof and machine gate pass; Book review is `REQUESTED/BLOCKED` after commit `ddf68e1`, so `verify` is not run.

## Plan
- [x] Step 1: Confirm issue mapping, parent, and dependency safety.
  - **Files:** Linear `THE-27`, Linear `THE-7`, `.cursor/run-state/entity-phase-2.json`, `output/entity-phase-2/test-gate/THE-26.json`, `output/entity-phase-2/book-review/THE-26.json`
  - **Verify:** Live Linear fetch plus receipt reads show `THE-26` Done/APPROVED/PASS.
- [x] Step 2: Inspect existing DB/service/route patterns before editing.
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/index.ts`, colocated route/repository tests
  - **Verify:** Targeted reads/searches identify the smallest local API pattern to extend.
- [x] Step 3: Implement org/team/project service APIs with org-scoped query helpers.
  - **Files:** expected `packages/server/src/*` and `packages/db/src/*` if repository helpers need extension
  - **Verify:** TypeScript build.
- [x] Step 4: Add focused API tests and request/response/denial fixtures.
  - **Files:** colocated tests near modified route/service code
  - **Verify:** Focused `npx vitest run <test files>` covers success, missing scope, and cross-org/unauthorized access.
- [x] Step 5: Update local run state and plan receipts.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, this plan, `docs/plans/ACTIVE_PLAN.md`
  - **Verify:** `git status --short --branch`
- [ ] Step 6: Run proof and gate commands.
  - **Files:** proof receipts under `output/entity-phase-2/`
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, and `cd packages/server && npm run build && npx vitest run` pass under Node v22.22.3; CLI Tester `request` and `run` pass; post-commit `book-review` is blocked with `decision=REQUESTED`, `safeToContinue=false`; `verify` is not run.
- [x] Step 7: Commit scoped work and post Linear proof comment.
  - **Files:** changed implementation/tests/docs; local state remains uncommitted
  - **Verify:** `git status --short --branch`, `git log -1 --oneline`, Linear comment response

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 03:24 | Step 1 | done | Live Linear confirms `THE-27` child/source mapping and `THE-26` Done; receipts show Book APPROVED and gate PASS. |
| 03:18 | Steps 2-4 | done | Added scoped workspace hierarchy router, repository read/update helpers, and focused API tests. Focused route tests plus DB/server builds pass. |
| 03:21 | Proof/gate | blocked | Node v26 proof failed with known `better-sqlite3` ABI mismatch; rerun under Node v22.22.3 passed smoke/root build/server build/full Vitest. CLI Tester request/run passed, but pre-commit Book review returned `REQUESTED`, `safeToContinue=false`; verify not run. |
| 03:23 | Commit/gate | blocked | Scoped commit `ddf68e1` created. CLI Tester request/run rerun against commit and passed; Book review remained `REQUESTED`, `safeToContinue=false`; verify not run. Linear proof/blocker comment `2f7143c9-b115-46e9-a3cf-4b6612fad67a` posted. |

## Files Touched
- `docs/plans/2026-06-23-entity-phase-2-the-27-workspace-apis-plan.md` - created - compaction-safe plan for current issue.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution plan for current issue.
- `packages/db/src/index.ts` - modified - scoped workspace repository read/update methods for org/team/project APIs.
- `packages/server/src/index.ts` - modified - mounts workspace hierarchy router.
- `packages/server/src/routes/workspace.ts` - created - org/team/project service API routes with explicit scope errors.
- `packages/server/src/routes/workspace.test.ts` - created - API success, missing-scope, and cross-scope denial coverage.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Continue from the first unchecked step above.
5. Wait for Book approval or an explicit Henry-approved waiver. Run CLI Tester `verify THE-27` only if Book review is APPROVED with `safeToContinue=true`.
6. Do not start `THE-28` until `THE-27` proof commands pass, CLI Tester `run` passes, Book review is APPROVED with `safeToContinue=true`, and CLI Tester `verify THE-27` passes with `nextChildBlocked=false`, or Henry explicitly waives the gate.

## Done
- [x] All local implementation/proof steps complete.
- [x] Proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass.
- [x] Linear proof comment added.
- [ ] `THE-28` identified as next candidate only after verify allows continuation.
