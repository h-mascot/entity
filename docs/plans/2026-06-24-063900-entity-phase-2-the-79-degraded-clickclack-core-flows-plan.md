# Entity Phase 2 THE-79 Plan: Degraded ClickClack Core Flows

Issue: THE-79
Branch: THE-79-guarantee-degraded-clickclack-does-not-block-core-entity-flows
Status: DONE

## Scope

Prove and harden that ClickClack degraded/unavailable state cannot block core Entity task, proof/review, docs/files, and search flows. Prefer focused degraded-mode tests and small fixes only if tests expose a real coupling. Do not change ClickClack primitives, add deep chat admin, or make Entity work state depend on chat availability.

## Dependencies

- [x] THE-79 is confirmed as a child issue of THE-17.
- [x] THE-76 readiness contract, THE-77 ObjectRef links, and THE-78 embedded context panel are Done.
- [x] THE-6 Slice 0 dependency is satisfied by the verified completed queue/run-state receipts.
- [x] Full proof and CLI Tester gate must pass before Linear status changes.

## Plan

- [x] Step 1: Confirm Linear scope, dependency safety, clean HEAD, and create branch.
  - Files: `.cursor/run-state/entity-phase-2.json`, Linear THE-79/THE-17 bodies
  - Verify: `git status --short --branch`
- [x] Step 2: Add degraded ClickClack tests for task/proof/review/docs/search independence.
  - Files: `packages/server/src/routes/chat-degraded-core-flows.test.ts`
  - Verify: `cd packages/server && npx vitest run src/routes/chat-degraded-core-flows.test.ts`
- [x] Step 3: Apply minimal hardening only if Step 2 exposes coupling.
  - Files: none
  - Verify: `cd packages/server && npx vitest run src/routes/chat-degraded-core-flows.test.ts`
- [x] Step 4: Run proof commands and four-step CLI Tester gate.
  - Files: `output/entity-phase-2/test-gate/THE-79.*`, `output/entity-phase-2/book-review/THE-79*`
  - Verify: `bash scripts/proof/entity-phase-2-smoke.sh && npm run build && cd packages/server && npm run build && npx vitest run`
  - Verify: `project-test-gate request/run/book-review/verify THE-79`
- [x] Step 5: Comment Linear, mark THE-79 Done if proof supports it, update run-state to THE-80, and commit scoped work.
  - Files: `.cursor/run-state/entity-phase-2.json`
  - Verify: `git status --short --branch`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 2026-06-24T06:39Z | Step 1 | Done | Run-state currentIssue confirmed as THE-79; branch created from `be156df`. |
| 2026-06-24T06:39Z | Step 2 | In progress | Existing ClickClack degraded send tests and core route registrations located. |
| 2026-06-24T06:42Z | Steps 2-3 | Done | Degraded core-flow test passes; no production hardening needed. |
| 2026-06-24T06:44Z | Step 4 | Done | Full proof passed; CLI Tester run PASS, packet-mode Book review locally approved, verify PASS with no blockers; GitNexus low risk. |
| 2026-06-24T06:45Z | Step 5 | Done | Linear proof comment posted, THE-79 marked Done, implementation commit `a6f12bc`, run-state advanced to THE-80. |

## Files Touched

- `docs/plans/2026-06-24-063900-entity-phase-2-the-79-degraded-clickclack-core-flows-plan.md` - created - compaction-survivable plan
- `docs/plans/ACTIVE_PLAN.md` - modified - mirrored active plan
- `packages/server/src/routes/chat-degraded-core-flows.test.ts` - created - degraded chat/core Entity flow test
- `.cursor/run-state/entity-phase-2.json` - modified - advanced local pointer to THE-80 (not committed)

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff`.
3. Continue from the first unchecked step.
4. Keep scope limited to degraded-mode core-flow tests and only necessary hardening.

## Done

- [x] All steps complete
- [x] Focused tests pass
- [x] Full proof commands pass
- [x] CLI Tester request/run/book-review/verify completed
- [x] Linear proof comment posted and THE-79 marked Done if supported
