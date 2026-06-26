## Task

Write the Entity Phase 2 rollback runbook and release checklist.

**MC Task:** THE-95
**Created:** 2026-06-24T18:15Z
**Agent:** GPT-5.5
**Status:** IN PROGRESS

## Context

Implement THE-20.5 / THE-95 from the release observability and proof gates parent. THE-95 documents rollout/rollback procedures, release readiness tests, proof attachment standards, and the operator checklist for Phase 2 launch.

Branch: `THE-95-rollback-runbook-release-checklist`
Linear: `THE-95` / parent `THE-20`
Base checkpoint: THE-94 approved commit `b426844`.

This ticket is documentation and proof only. It must not add runtime behavior, broaden strict enforcement, expose sensitive material, add Google mutation, add Helm deep admin controls, block core Entity flows on ClickClack availability, or fabricate historical receipt certainty.

## Dependencies

- [x] Required Phase 2 repo context read: `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, build context, canonical PRD, detailed spec excerpt `E15.T5`/`E15.T6`, current gap matrix, local live-verified THE-95 issue packet, and THE-20 parent excerpt.
- [x] THE-94 supervisor approval received; THE-94 is safe to continue.
- [x] Branch created from clean THE-94 checkpoint.
- [x] Runbook content depends on THE-90 migration rollback docs, THE-91 staged flags, THE-92 diagnostics, THE-93 first-session proof, and THE-94 boundary gate.
- [ ] Book/packet verify depends on docs proof and required repo proof passing.

## Plan

- [x] Step 1: Add THE-95 rollback runbook covering flags, migration rollback, receipt failure recovery, Task Master runaway loop, search permission leak, connector degradation, notification failure, and audit preservation.
  - **Files:** `docs/runbooks/entity-phase-2-rollback-runbook.md`
  - **Verify:** `rg "THE-95|feature flag|migration rollback|receipt writer|Task Master|search permission|connector degradation|notification failure|audit trail" docs/runbooks/entity-phase-2-rollback-runbook.md`
- [x] Step 2: Add THE-95 release checklist with PRD release readiness tests, boundary checks, proof scripts, Linear issue map links, and a completed staging sample checklist.
  - **Files:** `docs/runbooks/entity-phase-2-release-checklist.md`
  - **Verify:** `rg "THE-95|release readiness|receipt proof|Curacel|Paperclip|Entity/Helm/ClickClack|proof:phase2:first-session|proof:phase2:boundary|staging sample" docs/runbooks/entity-phase-2-release-checklist.md`
- [x] Step 3: Run focused documentation proof.
  - **Files:** none
  - **Verify:** focused `rg` checks above and `git diff --check`
- [x] Step 4: Run required repo proof.
  - **Files:** none
  - **Verify:** `cd packages/server && npm run build && npx vitest run`; `npm run build`; `bash scripts/proof/entity-phase-2-smoke.sh`
- [ ] Step 5: Run CLI Tester request/run/book-review/verify flow. BLOCKED: packet-only Book review returned `decision=REQUESTED`, `safeToContinue=false`; verify was not run.
  - **Files:** ignored `output/entity-phase-2/test-gate/THE-95.json`, `output/entity-phase-2/book-review/THE-95.json`
  - **Verify:** `/Users/enterprise/Code/cli-tester/bin/project-test-gate --root /Users/enterprise/Code/entity --config /Users/enterprise/Code/entity/.project-gate.json verify THE-95 THE-95-rollback-runbook-release-checklist`
- [x] Step 6: Inspect final status and report.
  - **Files:** none
  - **Verify:** `git status --short --branch`, proof receipt paths, Book gate status

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 18:15Z | Setup | COMPLETE | Read required repo context, THE-95 local issue packet, parent THE-20 excerpt, detailed spec `E15.T5`/`E15.T6`, current gap matrix, and prior THE-90 through THE-94 proof surfaces. |
| 18:15Z | Branch | COMPLETE | Created `THE-95-rollback-runbook-release-checklist` from approved THE-94 commit `b426844`. |
| 18:15Z | Plan | COMPLETE | Created compaction-survivable THE-95 plan before doc implementation. |
| 18:20Z | Steps 1-3 | COMPLETE | Added rollback runbook and release checklist; focused doc `rg` checks and `git diff --check` passed. |
| 18:25Z | Step 4 | COMPLETE | Node 26 hit the known `better-sqlite3` ABI mismatch; reran under Node 22.22.2 and server build + 74 files / 552 Vitest tests, root build, Phase 2 smoke, first-session proof, and boundary gate passed. |
| 18:30Z | Step 5 | BLOCKED | CLI Tester request/run PASS, banned/private scans 0/0, but Book review is packet-only `REQUESTED` with `safeToContinue=false`; stopped before verify per gate discipline. |
| 18:32Z | Step 6 | COMPLETE | Final status/diff inspected; `git diff --check` passes; GitNexus detect_changes reports low risk, no changed symbols, no affected processes. |

## Files Touched

- `docs/plans/2026-06-24T181500Z-entity-phase-2-the-95-rollback-runbook-release-checklist-plan.md` - created - compaction-survivable THE-95 plan.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution pointer for THE-95.
- `docs/runbooks/entity-phase-2-rollback-runbook.md` - created - Phase 2 rollback triggers, actions, recovery proof, and audit-preservation rules.
- `docs/runbooks/entity-phase-2-release-checklist.md` - created - Phase 2 release readiness checklist, proof commands, PRD release tests, and staging sample.
- `output/entity-phase-2/test-gate/THE-95.json` - generated - CLI Tester request/run receipt (ignored).
- `output/entity-phase-2/book-review/THE-95.json` - generated - packet-only Book review request receipt (ignored).

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Confirm branch is `THE-95-rollback-runbook-release-checklist`.
4. Find the first unchecked step above.
5. Continue from the first unchecked step; do not redo completed proof unless changed files affect it.
6. If Book review returns packet-only `REQUESTED`, stop at the Book gate and wait for supervisor review.

## Done

- [ ] All steps complete
- [x] Focused documentation proof passes
- [x] Full repo proof passes
- [x] Proof artifacts generated
- [x] Book review completed or stopped at requested Book gate
