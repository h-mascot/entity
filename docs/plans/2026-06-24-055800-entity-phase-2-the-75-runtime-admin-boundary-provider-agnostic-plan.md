# Entity Phase 2 THE-75 Plan: Runtime/Admin Boundary and Provider-Agnostic Behavior

Issue: THE-75
Branch: THE-75-document-runtime-admin-boundary-and-provider-agnostic-behavior
Status: IN PROGRESS

## Scope

Add boundary docs and focused tests proving Entity remains the work plane, Helm owns deep runtime/admin configuration, and runtime/provider-backed agents are provider-agnostic. Search may surface Helm status/reference records but must not become a deep Helm object search surface. Do not add new runtime controls, provider configuration, schedules, deployment settings, credentials, or broad admin search.

## Dependencies

- [x] THE-75 is confirmed as a child issue of THE-16.
- [x] THE-6 Slice 0 dependency is satisfied by the verified completed queue/run-state receipts.
- [x] THE-71 through THE-74 provider/runtime status and safe-control slices are available from current HEAD.
- [x] Full proof and CLI Tester gate must pass before Linear status changes.

## Plan

- [x] Step 1: Confirm Linear scope, dependency safety, clean HEAD, and create branch.
  - Files: `.cursor/run-state/entity-phase-2.json`, Linear THE-75/THE-16 bodies
  - Verify: `git status --short --branch`
- [x] Step 2: Add a concise runtime/admin boundary ADR.
  - Files: `docs/adr/2026-06-24-runtime-admin-boundary-and-provider-agnostic-agents.md`
  - Verify: `rg "Helm owns" docs/adr/2026-06-24-runtime-admin-boundary-and-provider-agnostic-agents.md`
- [x] Step 3: Add provider-agnostic tests for OpenClaw/Hermes/generic provider behavior without treating any provider as Entity itself.
  - Files: `packages/server/src/__tests__/agent-registry-routes.test.ts`
  - Verify: `cd packages/server && npx vitest run src/__tests__/agent-registry-routes.test.ts`
- [x] Step 4: Add search boundary tests proving Helm status refs remain references and deep Helm object search is not exposed.
  - Files: `packages/server/src/fs/routes-search.test.ts`
  - Verify: `cd packages/server && npx vitest run src/fs/routes-search.test.ts`
- [x] Step 5: Run proof commands and four-step CLI Tester gate.
  - Files: `output/entity-phase-2/test-gate/THE-75.*`, `output/entity-phase-2/book-review/THE-75*`
  - Verify: `bash scripts/proof/entity-phase-2-smoke.sh && npm run build && cd packages/server && npm run build && npx vitest run`
  - Verify: `project-test-gate request/run/book-review/verify THE-75`
- [ ] Step 6: Comment Linear, mark THE-75 Done if proof supports it, update run-state to THE-76, and commit scoped work.
  - Files: `.cursor/run-state/entity-phase-2.json`
  - Verify: `git status --short --branch`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 2026-06-24T05:58Z | Step 1 | Done | Run-state currentIssue confirmed as THE-75; branch created from `2398e97`. |
| 2026-06-24T05:58Z | Step 2 | In progress | Existing context docs and search/registry tests located; no broad search rewrite planned. |
| 2026-06-24T05:59Z | Steps 2-4 | Done | Boundary ADR added; provider-agnostic registry and Helm-status search boundary tests pass. |
| 2026-06-24T06:03Z | Step 5 | Done | Full proof passed with Node 22 after one transient server-suite rerun; CLI Tester run PASS, packet-mode Book review locally approved, verify PASS with `nextChildBlocked=false`; GitNexus risk low. |

## Files Touched

- `docs/plans/2026-06-24-055800-entity-phase-2-the-75-runtime-admin-boundary-provider-agnostic-plan.md` - created - compaction-survivable plan
- `docs/plans/ACTIVE_PLAN.md` - modified - mirrored active plan
- `docs/adr/2026-06-24-runtime-admin-boundary-and-provider-agnostic-agents.md` - created - runtime/admin boundary ADR
- `packages/server/src/__tests__/agent-registry-routes.test.ts` - modified - provider-agnostic runtime-backed agent test
- `packages/server/src/fs/routes-search.test.ts` - modified - Helm status reference search boundary test

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff`.
3. Continue from the first unchecked step.
4. Keep scope limited to docs and focused tests. Stop if implementation requires new runtime controls, provider setup, schedule edits, deployment settings, credentials, or deep Helm object search.

## Done

- [ ] All steps complete
- [ ] Focused tests pass
- [ ] Full proof commands pass
- [ ] CLI Tester request/run/book-review/verify completed
- [ ] Linear proof comment posted and THE-75 marked Done if supported
