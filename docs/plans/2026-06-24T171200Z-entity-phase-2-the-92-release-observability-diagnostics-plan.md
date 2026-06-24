## Task

Add Phase 2 release observability diagnostics for receipts, review, search, integrations, notifications, and migration.

**MC Task:** THE-92
**Created:** 2026-06-24T17:12Z
**Agent:** GPT-5.5
**Status:** IN PROGRESS

## Context

Implement THE-20.2 / THE-92 from the release observability and proof gates parent. THE-92 instruments operator diagnostics for key Phase 2 degraded states without exposing sensitive content or secrets.

Branch: `THE-92-phase2-release-observability-diagnostics`
Linear: `THE-92` / parent `THE-20`

Supervisor context says a prior THE-92 attempt was lost by full server proof checkout behavior. This plan includes the explicit supervisor-approved local savepoint commit after focused proof/build passes and before the full server proof suite. Do not push or merge.

## Dependencies

- [x] Required Phase 2 repo context read: `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, build context, canonical PRD, THE-92 live issue body, parent THE-20 live body, and relevant spec excerpt.
- [x] Branch switched to `THE-92-phase2-release-observability-diagnostics` from clean base `aafac59`.
- [x] THE-92 scope confirmed: diagnostics for receipt failures/integrity, review/gate queues, search index lag, Helm/ClickClack/Google degraded states, notification failures, and migration warnings.
- [x] Savepoint commit depends on focused THE-92 proof/build passing.
- [ ] Full proof depends on the local savepoint commit existing.

## Plan

- [x] Step 1: Add typed Phase 2 observability diagnostics builder and no-secret log fixtures.
  - **Files:** `packages/server/src/phase2-observability.ts`, `packages/server/src/phase2-observability.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/phase2-observability.test.ts`
- [x] Step 2: Wire observability into the existing Phase 2 diagnostics endpoint.
  - **Files:** `packages/server/src/index.ts`
  - **Verify:** focused diagnostics test or focused observability test proving payload shape
- [x] Step 3: Run focused THE-92 proof/build.
  - **Files:** none
  - **Verify:** focused test, `cd packages/server && npm run build`
- [ ] Step 4: Create supervisor-authorized local savepoint commit.
  - **Files:** scoped source/test/docs plan files only; exclude generated output receipts
  - **Verify:** `git status --short --branch && git log -1 --oneline`
- [ ] Step 5: Run full required proof after savepoint commit.
  - **Files:** none
  - **Verify:** `cd packages/server && npm run build && npx vitest run`; `npm run build`; Phase 2 smoke proof if applicable
- [ ] Step 6: Run CLI Tester request/run/book-review/verify flow.
  - **Files:** ignored `output/entity-phase-2/test-gate/THE-92.json`, `output/entity-phase-2/book-review/THE-92.json`
  - **Verify:** CLI Tester verify for THE-92 if Book review approves; stop at Book gate if packet-only `REQUESTED`
- [ ] Step 7: Inspect final status and report.
  - **Files:** none
  - **Verify:** `git status --short --branch`, local commit id, proof receipt paths, Book gate status

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 17:12Z | Setup | COMPLETE | Read required context, fetched live THE-92 and THE-20 via Linear GraphQL, confirmed branch clean at `aafac59`. |
| 17:12Z | Plan | COMPLETE | Created compaction-survivable THE-92 plan before implementation. |
| 17:14Z | Steps 1-3 | COMPLETE | Added observability diagnostics builder/tests, wired `/phase2/diagnostics`, and passed focused Vitest plus server build. |

## Files Touched

- `docs/plans/2026-06-24T171200Z-entity-phase-2-the-92-release-observability-diagnostics-plan.md` - created - compaction-survivable THE-92 plan.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution pointer for THE-92.
- `packages/server/src/phase2-observability.ts` - created - Phase 2 health metrics/log diagnostics builder.
- `packages/server/src/phase2-observability.test.ts` - created - observability state, metrics, and no-secret log fixture coverage.
- `packages/server/src/index.ts` - modified - includes observability in existing Phase 2 diagnostics endpoint.

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Confirm branch is `THE-92-phase2-release-observability-diagnostics`.
4. Find the first unchecked step above.
5. If focused proof passed but no local savepoint commit exists, create the scoped local commit before full server proof.
6. Continue from the first unchecked step above; do not redo completed steps.
7. If Book review returns packet-only `REQUESTED`, stop at the Book gate and leave the local commit in place.

## Done

- [ ] All steps complete
- [ ] Tests pass
- [ ] Local savepoint commit created
- [ ] Proof artifacts generated
- [ ] Book review completed or stopped at requested Book gate
