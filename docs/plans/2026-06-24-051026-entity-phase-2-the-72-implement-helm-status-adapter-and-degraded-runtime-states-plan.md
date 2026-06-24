# Entity Phase 2 THE-72 Plan: Helm Status Adapter and Degraded Runtime States

Issue: THE-72
Branch: THE-72-implement-helm-status-adapter-and-degraded-runtime-states
Status: IN PROGRESS

## Scope

Implement a bounded Helm status adapter keyed by `runtime_binding_id` so Entity can show safe runtime health/readiness/current work/heartbeat summaries. Unbound, stale, unreachable, or malformed Helm responses must render explicit degraded/unknown states and must not expose secrets, provider config, or deep admin controls.

## Dependencies

- THE-71 agent principal/runtime binding schema is complete.
- THE-72 is a child of THE-16, not a parent epic.
- THE-6 blocker is already satisfied by the verified completed queue in run-state.

## Steps

- [x] Confirm Linear scope and create branch.
  - Verify: `git status --short --branch`
- [x] Add server-side Helm runtime status adapter with sanitized success/degraded states.
  - Verify: `cd packages/server && npx vitest run src/agent/helm-status-adapter.test.ts`
- [x] Wire adapter into agent registry serialization without exposing secrets or deep admin config.
  - Verify: `cd packages/server && npx vitest run src/__tests__/agent-registry-routes.test.ts`
- [x] Render runtime status honestly in the agent dashboard using existing agent fields.
  - Verify: `npm run build`
- [ ] Run full proof and CLI Tester gate.
  - Verify: `bash scripts/proof/entity-phase-2-smoke.sh && npm run build && cd packages/server && npm run build && npx vitest run`
  - Verify: `project-test-gate request/run/book-review/verify THE-72`
- [ ] Comment Linear, mark Done, update run-state to THE-73, and commit scoped work.
  - Verify: `git log -1 --oneline && git status --short`

## Files Touched

- docs/plans/2026-06-24-051026-entity-phase-2-the-72-implement-helm-status-adapter-and-degraded-runtime-states-plan.md
- docs/plans/ACTIVE_PLAN.md
- packages/server/src/agent/helm-status-adapter.ts
- packages/server/src/agent/helm-status-adapter.test.ts
- packages/server/src/routes/agent-registry.ts
- packages/server/src/__tests__/agent-registry-routes.test.ts
- packages/app/src/App.tsx
- packages/app/src/components/AgentDashboardV2.tsx

## Checkpoints

- 2026-06-24T05:10Z: Linear body read; branch created; plan written.
- 2026-06-24T05:13Z: Focused adapter/route tests passed; full repo build passed.

## Resume Instructions

Continue with the first unchecked step. Keep THE-72 limited to status/readiness visibility and sanitized degraded states. Do not add Helm admin controls, credentials, model/provider config, destructive runtime actions, or unrelated agent management features.
