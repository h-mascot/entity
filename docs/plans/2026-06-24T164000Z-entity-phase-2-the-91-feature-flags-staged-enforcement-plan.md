## Task

Add feature flags and staged enforcement gates for Entity Phase 2 rollout.

**MC Task:** THE-91
**Created:** 2026-06-24T16:40Z
**Agent:** GPT-5.5
**Status:** IN PROGRESS

## Context

Implement THE-20.1 / THE-91 from the release observability and proof gates parent. THE-91 gates Phase 2 strict invariants and surfaces behind flags so new tasks can enforce stricter behavior while legacy data remains visible and usable.

Branch: `THE-91-feature-flags-staged-enforcement-gates`
Linear: `THE-91` / parent `THE-20`

Supervisor context says THE-90 is complete and approved by real Book review. THE-91 may build on THE-26 through THE-90. Preserve legacy task visibility; do not convert old migration warnings into broad runtime failures. Flag state must be visible in diagnostics.

## Dependencies

- [x] Required Phase 2 repo context read: `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, build context, canonical PRD, parent epic excerpt, THE-91 issue draft, and relevant spec excerpt.
- [x] THE-91 mapping confirmed: source `THE-20.1`, Linear UUID `415cecb1-b635-4111-b452-e61c743e3081`, parent `THE-20`.
- [x] Scoped THE-91 branch created from approved THE-90 checkpoint `7372db8`.
- [x] Feature flag implementation depends on existing receipt, review/gate, worktype registry, migration cleanup, and search permission seams.
- [ ] Final proof is blocked on real Book review approval; packet-only review returned `REQUESTED` / `safeToContinue=false`.

## Plan

- [x] Step 1: Add a typed Phase 2 feature flag registry and diagnostics payload.
  - **Files:** `packages/server/src/phase2-flags.ts`, `packages/server/src/phase2-flags.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/phase2-flags.test.ts`
- [x] Step 2: Thread staged flags into existing server enforcement and surface diagnostics.
  - **Files:** `packages/server/src/index.ts`, `packages/server/src/routes/worktype-registry.ts`, `packages/server/src/routes/migration-cleanup-queues.ts`, search route if needed
  - **Verify:** focused route tests for flag off/on behavior and diagnostics
- [x] Step 3: Add legacy compatibility fixtures proving old tasks/cleanup queues remain visible while strict gates are staged.
  - **Files:** existing colocated server route/service tests
  - **Verify:** focused Vitest files touched by this issue
- [x] Step 4: Run required server proof.
  - **Files:** none
  - **Verify:** `cd packages/server && npm run build && npx vitest run`
- [x] Step 5: Run full repo build and Phase 2 smoke proof.
  - **Files:** none
  - **Verify:** `npm run build && bash scripts/proof/entity-phase-2-smoke.sh`
- [ ] Step 6: Run test gate and Book review packet. BLOCKED: packet-only Book review returned `decision=REQUESTED`, `safeToContinue=false`.
  - **Files:** `output/entity-phase-2/test-gate/THE-91.json`, `output/entity-phase-2/book-review/THE-91.json` (ignored)
  - **Verify:** `/Users/enterprise/Code/cli-tester/bin/project-test-gate --root /Users/enterprise/Code/entity --config /Users/enterprise/Code/entity/.project-gate.json verify THE-91`
- [ ] Step 7: Inspect final diff and GitNexus changes.
  - **Files:** none
  - **Verify:** `git status --short && git diff --stat`; GitNexus `detect_changes(scope=all, worktree=/Users/enterprise/Code/entity)`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 16:40Z | Setup | COMPLETE | Confirmed THE-90 approved handoff, clean base, and THE-91 issue mapping/context. |
| 16:41Z | Branch | COMPLETE | Created `THE-91-feature-flags-staged-enforcement-gates` from `7372db8`. |
| 16:42Z | Plan | COMPLETE | Created compaction-survivable THE-91 plan before implementation. |
| 16:40Z | Steps 1-3 | COMPLETE | Added typed Phase 2 flags, diagnostics route, staged route/enforcement hooks, and focused tests. |
| 16:42Z | Step 4 | COMPLETE | `cd packages/server && npm run build && npx vitest run` passed under Node 22: 73 files, 548 tests. |
| 16:43Z | Step 5 | COMPLETE | `npm run build` and `bash scripts/proof/entity-phase-2-smoke.sh` passed under Node 22. |
| 16:45Z | Step 6 | BLOCKED | CLI Tester request/run PASS and scans clean, but Book review produced packet-only `REQUESTED` receipt with `safeToContinue=false`; verify was not run. |

## Files Touched

- `docs/plans/2026-06-24T164000Z-entity-phase-2-the-91-feature-flags-staged-enforcement-plan.md` - created - compaction-survivable THE-91 plan.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution pointer for THE-91.
- `packages/server/src/phase2-flags.ts` - created - Phase 2 flag registry and diagnostics serializer.
- `packages/server/src/phase2-flags.test.ts` - created - flag defaults, overrides, and diagnostics coverage.
- `packages/server/src/index.ts` - modified - diagnostics route and staged receipt/review enforcement switches.
- `packages/server/src/routes/worktype-registry.ts` - modified - worktype registry surface flag.
- `packages/server/src/routes/worktype-registry.test.ts` - modified - flag-disabled route coverage.
- `packages/server/src/routes/migration-cleanup-queues.ts` - modified - migration flag diagnostics while preserving legacy visibility.
- `packages/server/src/routes/migration-cleanup-queues.test.ts` - modified - old-task visibility and flag state proof.
- `packages/server/src/routes/search.ts` - modified - fail-closed search permission strictness flag.
- `packages/server/src/routes/search.test.ts` - created - disabled strictness returns 503 before snippets/documents.
- `output/entity-phase-2/test-gate/THE-91.json` - CLI Tester request/run receipt (ignored).
- `output/entity-phase-2/book-review/THE-91.json` - packet-only Book review request receipt (ignored).

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Confirm branch is `THE-91-feature-flags-staged-enforcement-gates`.
4. Confirm whether real Book review has approved `output/entity-phase-2/book-review/THE-91.json`.
5. If approved, rerun `/Users/enterprise/Code/cli-tester/bin/project-test-gate --root /Users/enterprise/Code/entity --config /Users/enterprise/Code/entity/.project-gate.json verify THE-91 THE-91-feature-flags-staged-enforcement-gates`.
6. Continue from the first unchecked step above; do not redo completed steps.
7. Preserve legacy task visibility; do not add broad strict enforcement outside staged flags.

## Done

- [ ] All steps complete
- [x] Tests pass
- [x] Proof artifacts generated
- [ ] Book review completed
