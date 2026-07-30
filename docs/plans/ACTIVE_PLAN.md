## Active Plan

Canonical plan: `docs/plans/2026-07-30-the-853-engineering-import-dry-run-plan.md`

## Task

Implement and prove a deterministic, database-read-only dry run for the seven approved Entity Engineering import candidates.

**Linear issue:** THE-853 / EE-B-05
**Created:** 2026-07-30
**Agent:** GPT-5.6 Sol
**Status:** COMPLETE — LINEAR AUTH BLOCKED

## Context

THE-852 / EE-B-04 is merged at `3141452` and recorded Done. The runner state records THE-853 as Todo with only THE-852 as its dependency. THE-853 may inspect current project/task state but must not create tasks, initialize or mutate a database, replace backups, promote production, use `create_anyway`, or cross the EE-B-06 approval boundary.

The dry run consumes only `disposition=import_candidate` rows from `docs/plans/entity-engineering-import-mapping.csv`, verifies pinned source/mapping identity, resolves the exact Entity Engineering project, checks project-scoped stable keys, exact/fuzzy title matches, prerequisites, and import-ledger readiness, then emits create/link/conflict/stale/refuse decisions.

Live Linear reread is currently limited by the Linear MCP requiring authentication. The previously reconciled runner snapshot records THE-852 Done, THE-853 dependency-safe/Todo, and THE-825 as the parent. No credential action is authorized.

## Dependencies

- [x] Step 1 has no dependencies: isolated worktree is clean at `3141452`.
- [x] Step 2 depends on THE-852 mapping artifacts and runner dependency evidence.
- [x] Step 3 depends on identifying a current Entity SQLite database that can be opened read-only without initialization.
- [x] Step 4 depends on Steps 2-3 and must prove no database bytes or sidecars changed.
- [x] Step 5 depends on completed implementation and focused positive/negative tests.
- [x] Step 6 depends on green required repository gates.
- [x] Step 7 depends on independent reviews reaching zero blockers.
- [x] Step 8 depends on delivery and proof receipt completion; Linear reconciliation must not request credentials.

## Plan

- [x] Step 1: Verify isolated branch/base and reread repo, Phase 2, runner, issue-map, and EE-B-04 authority.
  - **Files:** read-only context
  - **Verify:** `git status --short --branch && git rev-parse HEAD`
- [x] Step 2: Define the no-write dry-run contract and compaction-safe execution plan.
  - **Files:** `docs/plans/2026-07-30-the-853-engineering-import-dry-run-plan.md`, `docs/plans/ACTIVE_PLAN.md`
  - **Verify:** first unchecked step and all mutation boundaries are explicit
- [x] Step 3: Inspect database/schema/query seams and current Entity project/task state using read-only access.
  - **Files:** no database files modified
  - **Verify:** record DB path/identity and before hashes/stat metadata; reject missing/ambiguous project identity
- [x] Step 4: Implement deterministic dry-run logic and colocated tests.
  - **Files:** `packages/server/src/engineering-import/`
  - **Verify:** 20 focused Vitest tests cover create/link/conflict/stale, fail-closed schema/provenance, real WAL visibility, write rejection, sidecar identity, and receipt collisions
- [x] Step 5: Run the real no-write dry run over all seven candidates and write the external proof receipt.
  - **Files:** `/Users/enterprise/clawd/output/entity/remaining-roadmap-runner/receipts/proof/EE-B-05/`
  - **Verify:** seven row decisions, source/mapping hashes, project identity, stable keys, title checks, prerequisites, ledger readiness, DB before/after identity, and no-write declaration
- [x] Step 6: Run required repository gates from this worktree.
  - **Files:** none beyond ignored build/test outputs
  - **Verify:** `nvm use 22 >/dev/null && npm run ctrl:gate`; `cd packages/server && npm run build && npx vitest run`; `git diff --check`
- [x] Step 7: Run independent correctness and data-safety reviews; fix every blocker with regression proof and re-review.
  - **Files:** implementation/test/docs files as required
  - **Verify:** both reviews APPROVED with zero blockers
- [x] Step 8: Commit/deliver scoped source changes, reconcile THE-853 when possible, update runner state, and stop THE-854 at its approval/backup boundary.
  - **Files:** source commit only; no receipts/runtime state/logs/output in git
  - **Verify:** merged main/gates green if delivery proceeds; THE-854 not executed; `wrapperLog` and `cursorSessionLog` remain distinct

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 12:13 | Step 1 | ✅ | Clean `ee-b-05-import-dry-run` at `3141452`; runner records THE-852 Done and THE-853 dependency-safe/Todo |
| 12:25 | Step 2 | ✅ | No-write contract and plan created; live Linear MCP is authentication-blocked without credential action |
| 12:25 | Step 3 | ✅ | Active DB opened `mode=ro`/query-only; 1,144 tasks; project schema lacks key/domain; no Engineering project or import ledger |
| 12:47 | Steps 4-5 | ✅ | 20 focused tests pass; append-only `dry-run-v5.json` records 7 decisions (5 stale, 2 conflict), pinned `origin/main`, and unchanged DB/WAL/SHM identities |
| 12:48 | Step 6 | ✅ | Server build + 112 files/816 tests pass; workspace CTRL gate passes |
| 12:49 | Step 7 | ✅ | Independent correctness and data-safety re-reviews both APPROVED with 0 blockers |
| 12:58 | Step 8 | ✅ | PR #57 merged as `3d67cd2`; merged-main gates pass; runner state records Linear MCP `needsAuth` and holds THE-854 at reconciliation + approval/backup boundary |

## Errors Encountered

- Focused test/build startup failed because this isolated worktree had no installed dependencies (`vitest/config` and `tsc` missing). Resolution: run the locked workspace install here, then rerun.
- Initial `git diff --check` found Markdown hard-break whitespace in the new plan. Resolution: remove the trailing spaces and rerun.
- First focused test exposed a transposed nibble in the pinned source CSV hash constant (`829dba` vs `829bda`). Resolution: correct the constant to the already-proven EE-B-04 hash and retain the regression test.
- Initial correctness/data-safety reviews found ledger-link ordering, provenance/index, ref-pinning, transaction, receipt collision, and real-SQLite proof gaps. Resolution: add failing regression coverage, close every blocker, and re-review to two independent approvals with zero blockers.

## Files Touched

- `docs/plans/2026-07-30-the-853-engineering-import-dry-run-plan.md` — canonical execution plan
- `docs/plans/ACTIVE_PLAN.md` — recovery copy for THE-853
- `packages/server/src/engineering-import/dry-run.ts` — deterministic candidate decisions and fail-closed readiness checks
- `packages/server/src/engineering-import/dry-run.test.ts` — decision/provenance regression coverage
- `packages/server/src/engineering-import/read-only-snapshot.ts` — transactional read-only SQLite snapshot adapter
- `packages/server/src/engineering-import/read-only-snapshot.test.ts` — adapter construction/transaction test
- `packages/server/src/engineering-import/read-only-snapshot.integration.test.ts` — real WAL/read-only/identity/schema tests
- `packages/server/src/engineering-import/repo-prerequisites.ts` — `origin/main`-pinned prerequisite probes
- `packages/server/src/engineering-import/receipt-safety.ts` — DB identity and append-only receipt guards
- `packages/server/src/engineering-import/receipt-safety.test.ts` — receipt/identity safety tests
- `packages/server/src/engineering-import/cli.ts` — no-write runner and external receipt orchestration

## Resume Instructions

1. Re-read this file and `docs/plans/ACTIVE_PLAN.md`.
2. Run `git status --short --branch` and `git diff` only in `/Users/enterprise/Code/entity-the-853-ee-b-05`.
3. Continue from the first unchecked step; do not redo completed steps.
4. Never call repository bootstrap APIs against the inspected current database because they seed/migrate.
5. Open the inspected SQLite database read-only with `query_only=ON`; do not use `immutable=1` because the active database uses WAL and immutable readers can miss uncheckpointed state.
6. Do not create tasks, add an import ledger, use `create_anyway`, replace backups, deploy, or promote production.
7. Do not commit the external receipt, runner state, logs, secrets, `node_modules`, or output.

## Done

- [x] All seven candidates have deterministic decisions and reasons.
- [x] Source, mapping, project identity, keys, exact/fuzzy titles, prerequisites, and ledger readiness are validated.
- [x] Database no-write proof and negative-path tests pass.
- [x] Required gates and independent reviews pass with zero blockers.
- [x] Source changes are delivered to main and THE-853 is reconciled, or an exact external blocker is recorded.
- [x] THE-854 is represented only as a blocked approval/backup boundary; no import executes.
