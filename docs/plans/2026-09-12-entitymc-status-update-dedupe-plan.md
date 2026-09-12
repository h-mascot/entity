## Task

Allow task state and metadata updates to bypass title deduplication while preserving dedupe for actual title changes.

**Created:** 2026-09-12
**Agent:** Geordi E
**Status:** COMPLETE

## Context

The shared PUT/PATCH `/api/tasks/:id` handler substitutes the existing task name when `name` is absent, so unrelated state updates can return 409 when a pre-existing fuzzy title match exists. Work is isolated on `codex/entitymc-status-repair-20260912` at base `d90052f`. The prior `ACTIVE_PLAN.md` is preserved at `/Users/enterprise/output/entitymc-fix-20260912/ACTIVE_PLAN.before-product-fix.md`.

## Dependencies

- [x] Diagnosis and repository engineering guidance read.
- [x] Regression implementation depends on confirming the shared route test seam.
- [x] Source fix depends on a red regression receipt.
- [x] Handoff depends on focused green tests and diff review.

## Plan

- [x] Step 1: Add route regressions for PUT/PATCH state-only updates and conflicting renames.
  - **Files:** `packages/server/src/routes/tasks-update-dedupe.test.ts`
  - **Verify:** `npm run test:server -- src/routes/tasks-update-dedupe.test.ts` fails on state-only update assertions before the source fix.
- [x] Step 2: Gate update dedupe on an actually changed submitted title.
  - **Files:** `packages/server/src/routes/tasks.ts`
  - **Verify:** `npm run test:server -- src/routes/tasks-update-dedupe.test.ts`
- [x] Step 3: Inspect the public Entity MC helper for the same unchecked HTTP failure and make only a directly supported repair if needed.
  - **Files:** `skills/entity-mc/source-scripts/mc.sh` only if affected, plus focused tests if changed.
  - **Verify:** source inspection and relevant fixture tests.
- [x] Step 4: Record evidence and hand the isolated diff to the root coordinator.
  - **Files:** `/Users/enterprise/output/entitymc-fix-20260912/product-fix.md`
  - **Verify:** `git diff --check && git status --short`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 2026-09-12 | Setup | ✅ | Engineering guide and diagnosis read; prior active plan backed up externally. |
| 2026-09-12 | Regression | ✅ | Unfixed handler returned 409 for PUT and PATCH state-only cases; rename controls passed. |
| 2026-09-12 | Fix | ✅ | Six route regressions and 14 related tests pass; server TypeScript build passes. |
| 2026-09-12 | Helper inspection | ✅ | Public helper uses dedicated move endpoint and curl `-f`; no equivalent change required. |
| 2026-09-12 | Full gates | ✅ | Full server suite passed 2938/2938 after one transient native-broker fixture rerun; CTRL gate passed all builds and workspace tests. |

## Files Touched

- `docs/plans/2026-09-12-entitymc-status-update-dedupe-plan.md` — created — durable task plan.
- `docs/plans/ACTIVE_PLAN.md` — replaced for this isolated checkout; prior content backed up externally.
- `packages/server/src/routes/tasks.ts` — modified — dedupe only when the submitted normalized title changes.
- `packages/server/src/routes/tasks-update-dedupe.test.ts` — created — PUT/PATCH state and rename regression coverage.

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff` in `/Users/enterprise/Code/entitymc-status-repair-20260912`.
3. Continue at the first unchecked step and preserve the external prior-plan backup.
4. Do not push, merge, deploy, or write to the production API; the root coordinator owns delivery.

## Done

- [x] All steps complete
- [x] Focused tests pass
- [x] Evidence report written
- [x] Root coordinator notified
