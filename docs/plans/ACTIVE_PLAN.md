# Entity Phase 2 THE-73 Plan: Build Agent Management Surface

Issue: THE-73
Branch: THE-73-build-agent-management-surface
Status: DONE

## Scope

Build an Agent Management surface distinct from Agent Activity. It must show agent identity, capabilities/skills, current work, recurring crons/loops visibility, and Helm runtime binding status. Unknown/offline/degraded agents must be explicit. Do not add safe light controls, destructive runtime actions, credentials, provider configuration, or deep runtime admin configuration; those are outside THE-73 and belong to later Helm-boundary work.

## Dependencies

- [x] THE-73 is confirmed as a child issue of THE-16.
- [x] THE-6 Slice 0 dependency is satisfied by the verified completed queue/run-state receipts.
- [x] THE-71/THE-72 data and Helm status serialization are available from current HEAD.
- [x] Full proof and CLI Tester gate must pass before Linear status changes.

## Plan

- [x] Step 1: Confirm Linear scope, dependency safety, clean HEAD, and create branch.
  - Files: `.cursor/run-state/entity-phase-2.json`, Linear THE-73/THE-16 bodies
  - Verify: `git status --short --branch`
- [x] Step 2: Add a distinct Agent Management UI using existing registry/status data.
  - Files: `packages/app/src/components/AgentManagementSurface.tsx`, `packages/app/src/components/AgentDashboardV2.tsx`
  - Verify: `npm run build`
- [x] Step 3: Surface explicit degraded/unknown/offline binding and runtime status copy without admin controls.
  - Files: `packages/app/src/components/AgentManagementSurface.tsx`
  - Verify: `npm run build`
  - Verify: `output/entity-phase-2/browser-proof/THE-73-agent-management-dom.md`
- [x] Step 4: Add focused tests for THE-73 data contract.
  - Files: `packages/server/src/__tests__/agent-registry-routes.test.ts`
  - Verify: `cd packages/server && npx vitest run src/__tests__/agent-registry-routes.test.ts`
- [x] Step 5: Run proof commands and four-step CLI Tester gate.
  - Files: `output/entity-phase-2/test-gate/THE-73.*`, `output/entity-phase-2/book-review/THE-73*`
  - Verify: `bash scripts/proof/entity-phase-2-smoke.sh && npm run build && cd packages/server && npm run build && npx vitest run`
  - Verify: `project-test-gate request/run/book-review/verify THE-73`
- [x] Step 6: Comment Linear, mark THE-73 Done if proof supports it, update run-state to THE-74, and commit scoped work.
  - Files: `.cursor/run-state/entity-phase-2.json`
  - Verify: `git status --short --branch`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 2026-06-24T05:23Z | Step 1 | Done | Run-state currentIssue confirmed as THE-73; branch created from `e4ac908`. |
| 2026-06-24T05:23Z | Step 2 | In progress | Existing registry and Helm status route found; UI work remains. |
| 2026-06-24T05:27Z | Steps 2-4 | Done | Agent Management tab added; focused route contract test and full workspace build pass. |
| 2026-06-24T05:35Z | Browser proof | Done | Headless Chrome DOM/screenshot proof passed for Agent Management, Runtime Binding, capabilities, recurring loops, and separate Activity tab. |
| 2026-06-24T05:39Z | Step 5 | Done | Full proof passed with Node 22, CLI Tester run PASS, packet-mode Book review locally approved, verify PASS with `nextChildBlocked=false`. |
| 2026-06-24T05:40Z | Step 6 | Done | Linear proof comment posted, THE-73 marked Done, implementation commit `7e0710c`, run-state advanced to THE-74. |

## Files Touched

- `docs/plans/2026-06-24-052300-entity-phase-2-the-73-build-agent-management-surface-plan.md` - created - compaction-survivable plan
- `docs/plans/ACTIVE_PLAN.md` - modified - mirrored active plan
- `packages/app/src/components/AgentManagementSurface.tsx` - created - distinct Agent Management surface
- `packages/app/src/components/AgentDashboardV2.tsx` - modified - management tab wiring
- `packages/server/src/__tests__/agent-registry-routes.test.ts` - modified - management data contract test
- `.cursor/run-state/entity-phase-2.json` - modified - advanced local pointer to THE-74 (not committed)

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff`.
3. Continue from the first unchecked step.
4. Keep scope limited to THE-73 Agent Management visibility. Do not implement THE-74 safe light controls/deep links or THE-75 docs.

## Done

- [x] All steps complete
- [x] Focused tests pass
- [x] Full proof commands pass
- [x] CLI Tester request/run/book-review/verify completed
- [x] Linear proof comment posted and THE-73 marked Done if supported
