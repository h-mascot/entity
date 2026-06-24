# Entity Phase 2 THE-80 Plan: ClickClack Reuse, Proxy, and Bridge Tests

Issue: THE-80
Branch: THE-80-document-clickclack-reuse-proxy-and-bridge-tests
Status: IN PROGRESS

## Scope

Document ClickClack sidecar reuse, proxy/bridge behavior, local/cloud differences, degraded readiness, and smoke commands. Add narrow smoke/test coverage for live/mock and degraded proxy/bridge routes. Do not change chat primitives, add ClickClack administration, or make Entity proof/review depend on chat availability.

## Dependencies

- [x] THE-80 is confirmed as a child issue of THE-17.
- [x] THE-76 through THE-79 are Done and current HEAD includes readiness, ObjectRef links, embedded context, and degraded core-flow coverage.
- [x] THE-6 Slice 0 dependency is satisfied by the verified completed queue/run-state receipts.
- [x] Full proof and CLI Tester gate must pass before Linear status changes.

## Plan

- [x] Step 1: Confirm Linear scope, dependency safety, clean HEAD, and create branch.
  - Files: `.cursor/run-state/entity-phase-2.json`, Linear THE-80/THE-17 bodies
  - Verify: `git status --short --branch`
- [x] Step 2: Add ClickClack operations docs for optional sidecar, proxy/bridge paths, local/cloud differences, degraded behavior, and smoke commands.
  - Files: `docs/context/entity-phase-2-clickclack-operations.md`
  - Verify: `rg "ClickClack" docs/context/entity-phase-2-clickclack-operations.md`
- [x] Step 3: Add/update ClickClack smoke tests for live/mock and degraded proxy/bridge behavior.
  - Files: `packages/server/src/clickclack/proxy.test.ts`, `packages/server/src/clickclack/bridge.test.ts`
  - Verify: `cd packages/server && npx vitest run src/clickclack/proxy.test.ts src/clickclack/bridge.test.ts`
- [x] Step 4: Run proof commands and four-step CLI Tester gate.
  - Files: `output/entity-phase-2/test-gate/THE-80.*`, `output/entity-phase-2/book-review/THE-80*`
  - Verify: `bash scripts/proof/entity-phase-2-smoke.sh && npm run build && cd packages/server && npm run build && npx vitest run`
  - Verify: `project-test-gate request/run/book-review/verify THE-80`
- [ ] Step 5: Comment Linear, mark THE-80 Done if proof supports it, update run-state to THE-81, and commit scoped work.
  - Files: `.cursor/run-state/entity-phase-2.json`
  - Verify: `git status --short --branch`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 2026-06-24T06:46Z | Step 1 | Done | Run-state currentIssue confirmed as THE-80; branch created from `fe9af1c`. |
| 2026-06-24T06:46Z | Steps 2-3 | In progress | Existing ClickClack ADR/docs and bridge/proxy tests located. |
| 2026-06-24T06:50Z | Steps 2-3 | Done | ClickClack operations doc added; proxy degraded-route smoke added; focused bridge/proxy tests pass. |
| 2026-06-24T06:51Z | Step 4 | Done | Full proof passed; CLI Tester run PASS, packet-mode Book review locally approved, verify PASS with no blockers; GitNexus low risk. |

## Files Touched

- `docs/plans/2026-06-24-064600-entity-phase-2-the-80-clickclack-reuse-proxy-bridge-tests-plan.md` - created - compaction-survivable plan
- `docs/plans/ACTIVE_PLAN.md` - modified - mirrored active plan
- `docs/context/entity-phase-2-clickclack-operations.md` - created - sidecar/proxy/bridge/degraded operations docs
- `packages/server/src/clickclack/proxy.test.ts` - modified - degraded proxy API failure smoke

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff`.
3. Continue from the first unchecked step.
4. Keep scope limited to docs and smoke tests for ClickClack sidecar/proxy/bridge degraded behavior.

## Done

- [ ] All steps complete
- [ ] Docs committed
- [ ] ClickClack smoke tests pass
- [ ] Full proof commands pass
- [ ] CLI Tester request/run/book-review/verify completed
- [ ] Linear proof comment posted and THE-80 marked Done if supported
