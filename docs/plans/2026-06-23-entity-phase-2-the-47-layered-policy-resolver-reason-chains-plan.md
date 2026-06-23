## Task
Implement `THE-47` / `THE-11.2`: implement layered policy resolver with reason chains.

**MC Task:** Entity Phase 2 approved queue
**Created:** 2026-06-23
**Agent:** Cursor
**Status:** BLOCKED

## Context
Live Linear `THE-47` is a child issue under parent `THE-11`, source `THE-11.2`. Scope is a deterministic layered policy resolver that outputs review required, human gate required, reviewer/approver target, Task Master drivability, thresholds, routes, and reason chain. Entity remains the work/collaboration/review plane; this issue must not introduce deep runtime/admin controls or generic orchestration.

Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, `docs/context/entity-phase-2-build-context.md`, canonical PRD, Oracle spec, `.project-gate.json`, execution-pack plan.

## Dependencies
- [x] Required repo rules, context, canonical PRD, Oracle spec excerpts, gate config, package scripts, issue map, and run-state read.
- [x] Live Linear `THE-47` read and confirmed as child `THE-11.2` under parent `THE-11`.
- [x] Live Linear parent `THE-11` read and confirms policy resolver, reason chain, human gate, and separation-of-duties scope.
- [x] Prior `THE-46` is `Done` in live Linear with Henry verify-scanner waiver comment and audit `output/entity-phase-2/audits/THE-46-verify-scanner-waiver.md`.
- [x] Current branch created: `THE-47-implement-layered-policy-resolver-with-reason-chains`.

## Plan
- [x] Step 1: Inspect existing policy schema, task persistence, and review/gate seams.
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/__tests__/db-repositories.test.ts`
  - **Verify:** identify the smallest resolver surface that builds on `TaskPolicyInputEnvelope`.
- [x] Step 2: Implement deterministic layered policy resolver.
  - **Files:** likely `packages/db/src/index.ts`
  - **Verify:** higher-risk layers escalate review/gate; lower-risk layers cannot bypass mandatory workspace/org/team/project/worktype/task requirements; reason chain is stable.
- [x] Step 3: Add policy matrix and reason-chain tests.
  - **Files:** likely `packages/server/src/__tests__/db-repositories.test.ts`
  - **Verify:** success path, escalation path, mandatory lower-bound preservation, and reason-chain snapshot/assertions.
- [x] Step 4: Run focused tests and required proof commands under Node 22.
  - **Files:** command receipts only
  - **Verify:** `cd packages/server && npx vitest run src/__tests__/db-repositories.test.ts`, `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, and `cd packages/server && npm run build && npx vitest run` pass.
- [ ] Step 5: Run CLI Tester four-step for `THE-47`.
  - **Files:** `output/entity-phase-2/test-gate/THE-47.*`, `output/entity-phase-2/book-review/THE-47.*`
  - **Verify:** request and run pass; book-review/verify currently block on `decision=REQUESTED`, `safeToContinue=false`.
- [ ] Step 6: Comment Linear, update run-state, commit, and advance only if gates pass.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-47`
  - **Verify:** Linear proof comment includes branch, files changed, commands/exit codes, proof paths, gate receipt, Book review receipt, and blockers if any.

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 22:18 | Setup | done | `THE-46` conflict resolved by live Henry waiver comment; `THE-47` and parent `THE-11` live Linear bodies read; branch created. |
| 22:20 | Step 1 | done | Existing `TaskPolicyInputEnvelope`, `ExternalSideEffect`, review state, and human gate state live in `packages/db/src/index.ts`; tests are in `packages/server/src/__tests__/db-repositories.test.ts`. |
| 22:23 | Steps 2-4 | done | Added `resolveTaskPolicy`, policy resolution result/reason types, and resolver matrix tests. Focused DB test initially failed under Node 26 ABI mismatch, then passed under Node v22.22.2. Required proof commands passed: smoke, root build, server build + full Vitest (59 files / 440 tests). GitNexus detect-changes risk low, no affected processes. |
| 22:26 | Step 5 | blocked | CLI Tester `request` and `run` passed with banned/private scans at 0. `book-review` returned `REQUESTED` / `safeToContinue=false`; `verify` exits non-zero because Book review is missing/blocked. Do not start `THE-48`. |
| 22:28 | Linear | done | Posted proof/blocker comment `ae1f3693-a68b-4f30-845d-30a2cf150933` to `THE-47`; run-state records the Book review blocker. |

## Files Touched
- `docs/plans/2026-06-23-entity-phase-2-the-47-layered-policy-resolver-reason-chains-plan.md` - created - compaction-safe plan for `THE-47`.
- `docs/plans/ACTIVE_PLAN.md` - modified - active resume plan for `THE-47`.
- `packages/db/src/index.ts` - modified - policy resolution result/reason types and deterministic layered resolver.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - resolver matrix and reason-chain tests.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Continue from the first unchecked step above.
5. Use Node v22.22.x for proof/gate commands unless native dependencies are rebuilt for another Node.
6. Do not start `THE-48` until `THE-47` proof commands, CLI Tester run, Book review, and verify pass, or Henry explicitly approves a waiver.

## Done
- [x] `THE-47` implementation complete.
- [x] Focused tests pass.
- [x] Required proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass with `nextChildBlocked=false`.
- [x] Linear proof comment posted.
- [x] Scoped save-point commit created.
- [ ] Run-state advanced to `THE-48`.
