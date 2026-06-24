## Task

Run the Phase 2 security/privacy/boundary release gate for THE-94.

**MC Task:** THE-94
**Created:** 2026-06-24T18:00Z
**Agent:** GPT-5.5
**Status:** IN PROGRESS

## Context

Implement THE-20.4 / THE-94 from the release observability and proof gates parent. The issue asks for a release gate that verifies Phase 2 boundary drift does not ship: no Paperclip internal dependency, no Curacel-specific framing, no Helm sensitive-material/deep admin exposure, no Google mutation, no ClickClack blocking, and no permission leaks.

Branch: `THE-94-security-privacy-boundary-release-gate`
Linear: `THE-94` / parent `THE-20`
Base checkpoint: THE-93 approved commit `734384c`.

This ticket should add deterministic proof tooling and documentation. It should not add runtime behavior, expose sensitive material, add Google mutation, add deep Helm controls, require ClickClack for proof/review, or broaden product scope around Curacel/Paperclip.

## Dependencies

- [x] Required Phase 2 repo context read: `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, build context, canonical PRD, local live-verified THE-94 issue packet, THE-20 parent epic, current gap matrix, and spec excerpt `E15.T4`.
- [x] THE-93 supervisor approval received; THE-93 is safe to continue.
- [x] Branch created from clean THE-93 checkpoint.
- [x] Step 1 depends on existing proof script patterns and known historical boundary references being scoped as baseline rather than silently ignored.
- [x] Step 3 depends on Step 1 script and Step 2 runbook being in place.
- [x] Full proof depends on focused THE-94 release gate passing.
- [ ] Book/packet verify depends on focused proof and required repo proof passing.

## Plan

- [x] Step 1: Add deterministic THE-94 security/privacy/boundary release-gate script.
  - **Files:** `scripts/proof/entity-phase-2-boundary-release-gate.mjs`, `package.json`
  - **Verify:** `npm run proof:phase2:boundary -- --out output/entity-phase-2/boundary-release-gate/THE-94`
- [x] Step 2: Document release gate scope, baseline handling, and proof artifacts.
  - **Files:** `docs/runbooks/entity-phase-2-boundary-release-gate.md`
  - **Verify:** `rg "THE-94|Paperclip|Curacel|Helm|Google|ClickClack|permission" docs/runbooks/entity-phase-2-boundary-release-gate.md`
- [x] Step 3: Run focused THE-94 boundary proof and targeted swarm regression tests.
  - **Files:** ignored `output/entity-phase-2/boundary-release-gate/THE-94/*`
  - **Verify:** `npm run proof:phase2:boundary -- --out output/entity-phase-2/boundary-release-gate/THE-94`; `cd packages/server && npx vitest run src/swarm/routes.test.ts src/swarm/e2e-integration.test.ts`
- [x] Step 4: Run required repo proof.
  - **Files:** none
  - **Verify:** `cd packages/server && npm run build && npx vitest run`; `npm run build`; `bash scripts/proof/entity-phase-2-smoke.sh`
- [ ] Step 5: Run CLI Tester request/run/book-review/verify flow.
  - **Files:** ignored `output/entity-phase-2/test-gate/THE-94.json`, `output/entity-phase-2/book-review/THE-94.json`
  - **Verify:** `/Users/enterprise/Code/cli-tester/bin/project-test-gate --root /Users/enterprise/Code/entity --config /Users/enterprise/Code/entity/.project-gate.json verify THE-94 THE-94-security-privacy-boundary-release-gate`
- [ ] Step 6: Inspect final status and report.
  - **Files:** none
  - **Verify:** `git status --short --branch`, proof receipt paths, Book gate status

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 18:00Z | Setup | COMPLETE | Read required repo context, THE-94 local live-verified packet, THE-20 parent excerpt, spec `E15.T4`, current gap matrix, and existing proof/scanner surfaces. |
| 18:00Z | Branch | COMPLETE | Created `THE-94-security-privacy-boundary-release-gate` from clean THE-93 commit `734384c`. |
| 18:00Z | Plan | COMPLETE | Created compaction-survivable THE-94 plan before implementation. |
| 17:56Z | Steps 1-3 | COMPLETE | Added boundary gate script/runbook/npm command; removed stale Paperclip provider slot and Curacel repo defaults; focused gate PASS with 11 checks. |
| 18:57Z | Focused tests | COMPLETE | Node 26 caused `better-sqlite3` ABI/build failure; switched to Node 22.22.2, rebuilt `better-sqlite3`, and focused swarm tests passed: 2 files / 25 tests. |
| 18:59Z | Step 4 | COMPLETE | Required proof passed on Node 22.22.2: server build + 74 files / 552 Vitest tests, root build, and Phase 2 smoke. Git diff check passed; GitNexus route impact/detect_changes reported low risk. |

## Files Touched

- `docs/plans/2026-06-24T180000Z-entity-phase-2-the-94-security-privacy-boundary-release-gate-plan.md` - created - compaction-survivable THE-94 plan.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution pointer for THE-94.
- `scripts/proof/entity-phase-2-boundary-release-gate.mjs` - created - deterministic boundary release gate.
- `package.json` - modified - local npm proof command.
- `docs/runbooks/entity-phase-2-boundary-release-gate.md` - created - gate scope and proof documentation.
- `packages/server/src/swarm/providers/paperclip.ts` - deleted - removes stale internal Paperclip provider slot.
- `packages/server/src/swarm/dispatcher.ts` - modified - removes Paperclip provider registration.
- `packages/server/src/swarm/providers/interface.ts` - modified - removes business-control-plane provider category.
- `packages/server/src/swarm/ARCHITECTURE.md` - modified - removes stale Paperclip registry-slot wording.
- `packages/server/src/swarm/routes.ts` - modified - replaces Curacel-specific default repo URL with neutral example URL.
- `packages/server/src/swarm/e2e-integration.test.ts` - modified - replaces Curacel-specific repo/PR fixtures with neutral example URLs.

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Confirm branch is `THE-94-security-privacy-boundary-release-gate`.
4. Find the first unchecked step above.
5. Continue from the first unchecked step; do not redo completed proof unless changed files affect it.
6. If Book review returns packet-only `REQUESTED`, stop at the Book gate and wait for supervisor review.

## Done

- [ ] All steps complete
- [ ] Focused THE-94 proof passes
- [x] Full repo proof passes
- [ ] Proof artifacts generated
- [ ] Book review completed or stopped at requested Book gate
