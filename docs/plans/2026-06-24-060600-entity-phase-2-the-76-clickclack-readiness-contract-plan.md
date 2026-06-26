# Entity Phase 2 THE-76 Plan: ClickClack Readiness Contract

Issue: THE-76
Branch: THE-76-define-entity-clickclack-contract-and-readiness-states
Status: DONE

## Scope

Document and implement ClickClack readiness states for Entity: live, staged, degraded, unavailable, and not configured. The contract must map current bridge/proxy behavior honestly and prove Entity-owned work state remains independent of chat readiness. Do not change chat primitives, add ClickClack deep admin, or make Entity work flows depend on ClickClack availability.

## Dependencies

- [x] THE-76 is confirmed as a child issue of THE-17.
- [x] THE-6 Slice 0 dependency is satisfied by the verified completed queue/run-state receipts.
- [x] Existing ClickClack bridge/proxy/chat degradation behavior is available from current HEAD.
- [x] Full proof and CLI Tester gate must pass before Linear status changes.

## Plan

- [x] Step 1: Confirm Linear scope, dependency safety, clean HEAD, and create branch.
  - Files: `.cursor/run-state/entity-phase-2.json`, Linear THE-76/THE-17 bodies
  - Verify: `git status --short --branch`
- [x] Step 2: Add ClickClack readiness contract docs.
  - Files: `docs/adr/2026-06-24-clickclack-readiness-contract.md`
  - Verify: `rg "live|staged|degraded|unavailable|not configured" docs/adr/2026-06-24-clickclack-readiness-contract.md`
- [x] Step 3: Add a server readiness classifier and route.
  - Files: `packages/server/src/clickclack/readiness.ts`, `packages/server/src/routes/chat.ts`
  - Verify: `cd packages/server && npx vitest run src/routes/chat-clickclack.test.ts`
- [x] Step 4: Add readiness mocks/tests proving work-state independence when ClickClack is degraded/unavailable/not configured.
  - Files: `packages/server/src/routes/chat-clickclack.test.ts`
  - Verify: `cd packages/server && npx vitest run src/routes/chat-clickclack.test.ts`
- [x] Step 5: Run proof commands and four-step CLI Tester gate.
  - Files: `output/entity-phase-2/test-gate/THE-76.*`, `output/entity-phase-2/book-review/THE-76*`
  - Verify: `bash scripts/proof/entity-phase-2-smoke.sh && npm run build && cd packages/server && npm run build && npx vitest run`
  - Verify: `project-test-gate request/run/book-review/verify THE-76`
- [x] Step 6: Comment Linear, mark THE-76 Done if proof supports it, update run-state to THE-77, and commit scoped work.
  - Files: `.cursor/run-state/entity-phase-2.json`
  - Verify: `git status --short --branch`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 2026-06-24T06:06Z | Step 1 | Done | Run-state currentIssue confirmed as THE-76; branch created from `eb75159`. |
| 2026-06-24T06:06Z | Step 2 | In progress | Existing ClickClack bridge/proxy/chat degraded send behavior found. |
| 2026-06-24T06:08Z | Steps 2-4 | Done | Readiness ADR, classifier/route, and tests for all states plus local work-state independence pass. |
| 2026-06-24T06:12Z | Step 5 | Done | Full proof passed; CLI Tester run PASS, packet-mode Book review locally approved, verify PASS with no blockers; GitNexus high-risk flag reviewed for `registerChatRoutes` hub impact. |
| 2026-06-24T06:12Z | Step 6 | Done | Linear proof comment posted, THE-76 marked Done, implementation commit `5af0f23`, run-state advanced to THE-77. |

## Files Touched

- `docs/plans/2026-06-24-060600-entity-phase-2-the-76-clickclack-readiness-contract-plan.md` - created - compaction-survivable plan
- `docs/plans/ACTIVE_PLAN.md` - modified - mirrored active plan
- `docs/adr/2026-06-24-clickclack-readiness-contract.md` - created - readiness contract ADR
- `packages/server/src/clickclack/readiness.ts` - created - readiness classifier/probe
- `packages/server/src/routes/chat.ts` - modified - readiness route
- `packages/server/src/routes/chat-clickclack.test.ts` - modified - readiness state and independence tests
- `.cursor/run-state/entity-phase-2.json` - modified - advanced local pointer to THE-77 (not committed)

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff`.
3. Continue from the first unchecked step.
4. Keep scope limited to readiness contract/docs/tests. Stop if implementation requires ClickClack admin controls, chat primitive ownership changes, or making Entity work state depend on ClickClack.

## Done

- [x] All steps complete
- [x] Focused tests pass
- [x] Full proof commands pass
- [x] CLI Tester request/run/book-review/verify completed
- [x] Linear proof comment posted and THE-76 marked Done if supported
