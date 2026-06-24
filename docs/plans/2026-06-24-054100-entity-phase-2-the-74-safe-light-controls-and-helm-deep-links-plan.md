# Entity Phase 2 THE-74 Plan: Safe Light Controls and Helm Deep Links

Issue: THE-74
Branch: THE-74-implement-safe-light-controls-and-helm-deep-links
Status: IN PROGRESS

## Scope

Expose only policy-allowed, reversible, audited light controls for Helm-managed agents: pause, resume, and request retry. Add Helm deep-link visibility for deep admin/configuration. Do not duplicate secrets, provider/model configuration, schedule editing, deployment settings, tool grants, destructive actions, or deep admin controls inside Entity.

## Dependencies

- [x] THE-74 is confirmed as a child issue of THE-16.
- [x] THE-6 Slice 0 dependency is satisfied by the verified completed queue/run-state receipts.
- [x] THE-72 Helm status adapter and THE-73 Agent Management surface are available from current HEAD.
- [x] Full proof and CLI Tester gate must pass before Linear status changes.

## Plan

- [x] Step 1: Confirm Linear scope, dependency safety, clean HEAD, and create branch.
  - Files: `.cursor/run-state/entity-phase-2.json`, Linear THE-74/THE-16 bodies
  - Verify: `git status --short --branch`
- [x] Step 2: Add server-side safe light-control contract and policy/audit handling.
  - Files: `packages/server/src/agent/helm-light-controls.ts`, `packages/server/src/routes/agent-registry.ts`
  - Verify: `cd packages/server && npx vitest run src/__tests__/agent-registry-routes.test.ts`
- [x] Step 3: Add focused boundary tests for allowed/denied controls, audit fixture, and no deep admin exposure.
  - Files: `packages/server/src/__tests__/agent-registry-routes.test.ts`
  - Verify: `cd packages/server && npx vitest run src/__tests__/agent-registry-routes.test.ts`
- [x] Step 4: Add UI controls/deep-link affordance in Agent Management without duplicating Helm admin settings.
  - Files: `packages/app/src/components/AgentManagementSurface.tsx`
  - Verify: `npm run build`
  - Verify: browser DOM/screenshot proof for allowed, denied/degraded, and deep-link states
- [x] Step 5: Run proof commands and four-step CLI Tester gate.
  - Files: `output/entity-phase-2/test-gate/THE-74.*`, `output/entity-phase-2/book-review/THE-74*`
  - Verify: `bash scripts/proof/entity-phase-2-smoke.sh && npm run build && cd packages/server && npm run build && npx vitest run`
  - Verify: `project-test-gate request/run/book-review/verify THE-74`
- [ ] Step 6: Comment Linear, mark THE-74 Done if proof supports it, update run-state to THE-75, and commit scoped work.
  - Files: `.cursor/run-state/entity-phase-2.json`
  - Verify: `git status --short --branch`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 2026-06-24T05:41Z | Step 1 | Done | Run-state currentIssue confirmed as THE-74; branch created from `2b9fc0b`. |
| 2026-06-24T05:41Z | Step 2 | In progress | Existing status adapter, Agent Management surface, and current Helm deep-link rendering found. |
| 2026-06-24T05:48Z | Steps 2-4 | Done | Safe-control route/audit contract added, focused tests pass, workspace build passes, browser proof wrote THE-74 DOM/screenshot receipts. |
| 2026-06-24T05:51Z | Step 5 | Done | Full proof passed with Node 22, CLI Tester run PASS, packet-mode Book review locally approved, verify PASS with `nextChildBlocked=false`; GitNexus risk low. |

## Files Touched

- `docs/plans/2026-06-24-054100-entity-phase-2-the-74-safe-light-controls-and-helm-deep-links-plan.md` - created - compaction-survivable plan
- `docs/plans/ACTIVE_PLAN.md` - modified - mirrored active plan
- `packages/server/src/agent/helm-light-controls.ts` - created - safe control adapter and audit record
- `packages/server/src/routes/agent-registry.ts` - modified - safe control endpoint
- `packages/server/src/__tests__/agent-registry-routes.test.ts` - modified - boundary/audit tests
- `packages/app/src/components/AgentManagementSurface.tsx` - modified - safe controls and Helm deep-link UI

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff`.
3. Continue from the first unchecked step.
4. Keep scope limited to reversible controls, audit records, and Helm deep links. Stop if implementation requires credentials, schedule edits, deployment settings, model/provider config, tool grants, destructive actions, or broad runtime admin.

## Done

- [ ] All steps complete
- [ ] Focused tests pass
- [ ] Full proof commands pass
- [ ] CLI Tester request/run/book-review/verify completed
- [ ] Linear proof comment posted and THE-74 marked Done if supported
