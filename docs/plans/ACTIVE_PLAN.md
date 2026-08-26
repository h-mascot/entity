# Plan: REC-010 P2 close-fail-create-b descriptor accounting

**Run:** entity-deploy-reconciliation-20260824 / REC-010 / Luna generation 43
**Base:** c9e1786c86003862bdbddd4768a5519edcac5a76
**Status:** IN PROGRESS

## Constraints
- Work only in this checkout and branch `fix/clean-checkout-broker-build`.
- No runtime, production, push, PR, merge, or deploy actions.
- Preserve REC-010 and merged main features.

## Plan
- [ ] Step 1: Add deterministic descriptor-accounting RED regression for `close-fail-create-b`; verify it fails at base.
  - **Files:** `packages/server/native/managed-storage-broker/fs_guard.c`, `scripts/entity-build-broker-transaction.test.mjs`
  - **Verify:** focused native transaction test fails specifically on leaked `fb`.
- [ ] Step 2: Commit isolated RED save-point.
  - **Verify:** `git status`, commit SHA.
- [ ] Step 3: Fix descriptor preservation/close propagation and strengthen token fail-closed coverage.
  - **Files:** same source/test files
  - **Verify:** focused native tests pass.
- [ ] Step 4: Run required serial proof suite under Node 22.
  - **Verify:** focused tests, release-deploy, build, ctrl:gate.
- [ ] Step 5: Refresh/commit OpenWiki generated output and run docs/private-default/diff checks.
  - **Verify:** docs fingerprint, wiki HTML, scan, diff check, clean status.

## Files Touched
- `packages/server/native/managed-storage-broker/fs_guard.c`
- `scripts/entity-build-broker-transaction.test.mjs`
- generated `openwiki/` output as required
- this plan

## Resume
Read this plan, inspect `git status`/`git diff`, and continue from first unchecked step.
