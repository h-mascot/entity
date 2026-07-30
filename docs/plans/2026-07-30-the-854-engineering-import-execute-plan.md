# THE-854 / EE-B-06 — Approved import execute (fail-closed)

**Linear issue:** THE-854 / EE-B-06
**Created:** 2026-07-30
**Agent:** Cursor Grok 4.5
**Status:** COMPLETE — FAIL-CLOSED / UNSAFE CHARACTERIZED

## Context

EE-B-05 dry-run proved seven candidates with zero execution-ready rows because the inspected Entity task DB lacks `projects.project_key` / `projects.work_domain` and the `task_import_keys` ledger. Henry approved THE-854 with backup gate first. Backup gate PASS receipt SHA-256 `34093f24d012ea36931b739e1c3b5a735c1eb13691a5f874da52585affcb5388`. Production promotion remains forbidden. Current evidence remains unsafe; import writes were refused.

## Dependencies

- [x] Step 1 depends on isolated worktree + backup gate PASS receipt.
- [x] Step 2 depends on THE-853 Done (linear-reconciled receipt + live Linear Done).
- [x] Step 3 depends on revalidated dry-run against current DB.
- [x] Step 4 depends on execute fail-closed implementation + focused tests.
- [x] Step 5 depends on external EE-B-06 receipt under runner proof dir.
- [x] Step 6 depends on server build + full vitest gate.
- [x] Step 7 depends on scoped commit + Linear proof when key available.

## Plan

- [x] Step 1: Verify cwd/worktree, backup gate SHA, EE-B-04/05 receipts, THE-853 Done.
- [x] Step 2: Implement backup-gate validation, execute planner/writer, execute-cli, colocated tests.
- [x] Step 3: Run execute-cli against entityprivate DB; fail-closed unsafe receipt written; DB unchanged.
- [x] Step 4: Server gate + `git diff --check` + scoped commit.
- [x] Step 5: Linear proof comment; Done after honest fail-closed proof.

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 20:15 | Step 1 | ✅ | Backup gate SHA matched; THE-853 Done; cwd isolated |
| 20:19 | Steps 2-3 | ✅ | Focused tests pass; import-fail-closed receipt; 0 ready; DB unchanged |
| 20:20 | Steps 4-5 | ✅ | Server 116/841 green; scoped commit + Linear reconciliation |

## Files Touched

- `packages/server/src/engineering-import/backup-gate.ts`
- `packages/server/src/engineering-import/backup-gate.test.ts`
- `packages/server/src/engineering-import/execute.ts`
- `packages/server/src/engineering-import/execute.test.ts`
- `packages/server/src/engineering-import/execute-cli.ts`
- `docs/plans/2026-07-30-the-854-engineering-import-execute-plan.md`
- `docs/plans/ACTIVE_PLAN.md`

## Resume Instructions

1. Import was not executed; do not force writes.
2. EE-B-07 stays blocked until schema/ledger readiness + fresh backup matching live DB.
3. Do not push/merge/deploy/promote production from this worker.
