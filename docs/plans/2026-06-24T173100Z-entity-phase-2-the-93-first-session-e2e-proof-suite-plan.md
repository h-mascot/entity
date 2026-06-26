## Task

Build the Phase 2 first-session E2E proof suite for THE-93.

**MC Task:** THE-93
**Created:** 2026-06-24T17:31Z
**Agent:** GPT-5.5
**Status:** IN PROGRESS

## Context

Implement THE-20.3 / THE-93 from the release observability and proof gates parent. Live Linear asks for an end-to-end proof path covering the buyer first-session spine: connect/read indexed context, register one Helm-backed agent binding, create a business-ops task, attach context, complete with canonical receipt, review it, inspect proof/search/activity, and prove degraded-safe behavior.

Branch: `THE-93-first-session-e2e-proof-suite`
Linear: `THE-93` / parent `THE-20`
Base checkpoint: THE-92 approved commit `580d963`.

This ticket should add a runnable proof suite and documentation. It should not add new deep Helm controls, Google Docs mutation, ClickClack dependency, sensitive-material handling, or broad product behavior.

## Dependencies

- [x] Required Phase 2 repo context read: `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, build context, canonical PRD, THE-93 live issue body, parent THE-20 live body, and relevant spec excerpt `E15.T3`.
- [x] THE-92 supervisor approval received; THE-92 is safe to continue.
- [x] Branch created from clean THE-92 checkpoint.
- [x] Step 2 depends on Step 1 proof-suite shape and output contract.
- [x] Full proof depends on focused proof-suite verification passing.
- [ ] CLI Tester verify depends on real Book review approval; packet review returned `REQUESTED`.

## Plan

- [x] Step 1: Add deterministic THE-93 first-session proof-suite script.
  - **Files:** `scripts/proof/entity-phase-2-first-session-spine.mjs`, `package.json`
  - **Verify:** `npm run proof:phase2:first-session -- --out output/entity-phase-2/first-session-spine/THE-93`
- [x] Step 2: Document local setup, proof artifacts, and degraded-state expectations.
  - **Files:** `docs/runbooks/entity-phase-2-first-session-proof-suite.md`
  - **Verify:** `rg "THE-93|first-session|degraded" docs/runbooks/entity-phase-2-first-session-proof-suite.md`
- [x] Step 3: Run focused THE-93 proof.
  - **Files:** ignored `output/entity-phase-2/first-session-spine/THE-93/*`
  - **Verify:** `npm run proof:phase2:first-session -- --out output/entity-phase-2/first-session-spine/THE-93`
- [x] Step 4: Run required repo proof.
  - **Files:** none
  - **Verify:** `cd packages/server && npm run build && npx vitest run`; `npm run build`; `bash scripts/proof/entity-phase-2-smoke.sh`
- [ ] Step 5: Run CLI Tester request/run/book-review/verify flow. BLOCKED: packet Book review returned `REQUESTED` / `safeToContinue=false`.
  - **Files:** ignored `output/entity-phase-2/test-gate/THE-93.json`, `output/entity-phase-2/book-review/THE-93.json`
  - **Verify:** `/Users/enterprise/Code/cli-tester/bin/project-test-gate --root /Users/enterprise/Code/entity --config /Users/enterprise/Code/entity/.project-gate.json verify THE-93 THE-93-first-session-e2e-proof-suite`
- [x] Step 6: Inspect final status and report.
  - **Files:** none
  - **Verify:** `git status --short --branch`, proof receipt paths, Book gate status

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 17:31Z | Setup | COMPLETE | Read required repo context, live THE-93/THE-20 via Linear GraphQL, spec `E15.T3`, current gap matrix, and existing proof surfaces. |
| 17:31Z | Branch | COMPLETE | Created `THE-93-first-session-e2e-proof-suite` from clean THE-92 checkpoint. |
| 17:31Z | Plan | COMPLETE | Created compaction-survivable THE-93 plan before implementation. |
| 17:35Z | Steps 1-3 | COMPLETE | Added first-session proof script, package command, runbook, and focused proof artifacts; focused proof passed with 12 checks. |
| 17:38Z | Step 4 | COMPLETE | Node 22 proof passed: server build, 74 files / 552 Vitest tests, root build, and Phase 2 smoke. |
| 17:40Z | Step 5 | BLOCKED | CLI Tester request/run PASS; Book review packet returned `REQUESTED` / `safeToContinue=false`, so verify was not run. |
| 17:41Z | Step 6 | COMPLETE | Final status inspected; working tree has scoped THE-93 source/docs/plan changes and ignored proof receipts. |

## Files Touched

- `docs/plans/2026-06-24T173100Z-entity-phase-2-the-93-first-session-e2e-proof-suite-plan.md` - created - compaction-survivable THE-93 plan.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution pointer for THE-93.
- `scripts/proof/entity-phase-2-first-session-spine.mjs` - created - deterministic first-session E2E proof suite.
- `package.json` - modified - local npm proof command.
- `docs/runbooks/entity-phase-2-first-session-proof-suite.md` - created - setup and artifact documentation.

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Confirm branch is `THE-93-first-session-e2e-proof-suite`.
4. Find the first unchecked step above.
5. Continue from the first unchecked step; do not redo completed proof unless the changed files affect it.
6. If Book review returns packet-only `REQUESTED`, stop at the Book gate and wait for supervisor review.

## Done

- [ ] All steps complete
- [x] Focused THE-93 proof passes
- [x] Full repo proof passes
- [x] Proof artifacts generated
- [x] Book review completed or stopped at requested Book gate
