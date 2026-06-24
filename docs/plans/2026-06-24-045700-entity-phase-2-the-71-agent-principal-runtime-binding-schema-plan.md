# Entity Phase 2 THE-71 Agent Principal Runtime Binding Schema Plan

## Task
Entity Phase 2 THE-71: define agent principal and runtime binding schema.

**MC Task:** THE-71
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** IN PROGRESS

## Context
Live Linear issue THE-71 is child issue THE-16.1 under THE-16 Agent Management and Helm runtime binding. Scope is schema/types/tests for agent principal identity separated from runtime/provider identity, with `runtime_binding_id`, generic `provider_type`, `helm_managed`, and `binding_state` fields.

## Dependencies
- [x] Current run-state points to THE-71.
- [x] THE-70 notification contract issue is complete.
- [x] Branch created from THE-70 closeout commit: `THE-71-define-agent-principal-and-runtime-binding-schema`.
- [x] Live child issue and parent THE-16 body inspected.
- [x] Existing `entity_agents` schema, repository, API routes, and tests inspected.

## Plan

- [x] Step 1: Add provider/binding type contracts and `entity_agents` columns with safe migrations/defaults.
  - **Files:** `packages/db/src/index.ts`
  - **Verify:** TypeScript build and repository tests cover defaults.
- [x] Step 2: Update agent registry create/update mapping and API parsing for runtime binding fields.
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/routes/agent-registry.ts`
  - **Verify:** API route tests serialize provider-agnostic runtime binding fields.
- [x] Step 3: Add schema/type tests with provider-agnostic fixture and invalid/default binding state coverage.
  - **Files:** `packages/server/src/__tests__/db-repositories.test.ts`, `packages/server/src/__tests__/agent-registry-routes.test.ts`
  - **Verify:** focused Vitest tests pass.
- [x] Step 4: Run proof commands and impact/diff checks.
  - **Files:** proof artifacts under `output/entity-phase-2/`
  - **Verify:** focused tests; `bash scripts/proof/entity-phase-2-smoke.sh`; `npm run build`; `cd packages/server && npm run build && npx vitest run`; GitNexus detect-changes.
- [ ] Step 5: Run CLI Tester request/run/book-review/verify.
  - **Files:** `output/entity-phase-2/test-gate/THE-71.*`, `output/entity-phase-2/book-review/THE-71*`
  - **Verify:** machine gate PASS, Book review approved by packet-mode local approval only if scans are clean and diff is scoped.
- [ ] Step 6: Comment Linear, mark THE-71 Done, update run-state to THE-72, and commit scoped changes.
  - **Files:** `.cursor/run-state/entity-phase-2.json` local state only, source/test/plan for commit as appropriate
  - **Verify:** `git status --short`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 04:57Z | Setup | done | Read live child/parent issue; branch created after THE-70 completion. |
| 05:00Z | Steps 1-3 | done | Added agent binding schema/types, route parsing, display merge support, and provider-agnostic tests. |
| 05:03Z | Proof | done | Focused tests, full proof commands, and GitNexus detect-changes passed; risk low. |

## Files Touched
- `docs/plans/2026-06-24-045700-entity-phase-2-the-71-agent-principal-runtime-binding-schema-plan.md` - created - THE-71 execution plan.
- `docs/plans/ACTIVE_PLAN.md` - mirrored - active THE-71 plan.
- `packages/db/src/index.ts` - updated - agent runtime provider/binding schema, migrations, repository mapping.
- `packages/server/src/routes/agent-registry.ts` - updated - create/update parsing for binding fields.
- `packages/server/src/__tests__/db-repositories.test.ts` - updated - provider-agnostic binding schema tests.
- `packages/server/src/__tests__/agent-registry-routes.test.ts` - updated - route serialization/create/update binding tests.
- `packages/server/src/agent/agent-display.ts` - updated - display merge preserves binding fields.
- `packages/server/src/agent/agent-display.test.ts` - updated - binding field display assertions.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from the first unchecked step; do not redo completed work.
5. Keep THE-71 scoped to agent principal/runtime binding schema, route parsing, and tests.

## Done
- [ ] All steps complete
- [ ] Tests/build pass
- [ ] CLI Tester request/run/book-review/verify complete
- [ ] Linear THE-71 proof comment added and status moved to Done
- [ ] Run-state advanced to THE-72
