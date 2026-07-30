## Task

Create a deterministic, reviewable mapping plan for importing eligible coding items from `memory/Projects/entity/todo.md` into the Entity Engineering board without importing or mutating data.

**Linear issue:** THE-852 / EE-B-04
**Created:** 2026-07-30
**Agent:** GPT-5.6 Sol
**Status:** COMPLETE

## Context

THE-851 is Done and merged at `20bc528`, so THE-852 is dependency-safe. The live issue requires a mapping spreadsheet/receipt, not a live import. The source backlog mixes completed work, operational/manual actions, Entity product work, Helm/runtime work, external product discovery, and duplicate descriptions; the plan must classify every source row deterministically and preserve source provenance.

Source authority:
- Source backlog: QMD `memory/Projects/entity/todo.md`
- Source packet SHA-256: `84541727830ef8f4018ad2b9fdf587d653dfbba940b38b279ae3f90ca18ba895`
- Grill authority: Q1-Q61; Q62+ retracted
- Parent: THE-825, Entity Engineering Board Phase B

## Dependencies

- [x] THE-851 is live Linear Done.
- [x] THE-852 and parent THE-825 were reread from live Linear.
- [x] Work is isolated at `/Users/enterprise/Code/entity-the-852-ee-b-04`.
- [x] Source backlog, consolidated packet, grill, Workplanes packet, and invite-kit boundary were reread.
- [x] Mapping inventory depends on a stable source snapshot and deterministic classification rules.
- [x] Proof/review depends on the completed mapping artifacts.
- [x] Linear reconciliation depends on green proof and review.

## Plan

- [x] Capture the source backlog as a normalized, non-secret snapshot and define deterministic eligibility/deduplication rules.
  - **Files:** `docs/plans/entity-engineering-import-mapping-source.md`, mapping generator/validator
  - **Verify:** source item count, source line identity, and SHA-256 checks
- [x] Generate the mapping spreadsheet and human-readable landing plan.
  - **Files:** `docs/plans/entity-engineering-import-mapping.csv`, `docs/plans/entity-engineering-import-mapping.md`
  - **Verify:** every source checklist item has exactly one disposition; eligible keys/titles are unique
- [x] Add repo-real validation for coverage, stable keys, boundaries, and duplicate prevention.
  - **Files:** focused validator/test beside the mapping artifacts
  - **Verify:** run focused proof from `/Users/enterprise/Code/entity-the-852-ee-b-04`
- [x] Write the external proof receipt with cwd, commands, outputs, changed files, and no-mutation statement.
  - **Files:** `/Users/enterprise/clawd/output/entity/remaining-roadmap-runner/receipts/proof/EE-B-04/`
  - **Verify:** receipt hash and command transcript
- [x] Run low-risk packet review to zero blockers, commit scoped source artifacts, and reconcile Linear.
  - **Verify:** `git diff --check`, mapping validator, review approval, Linear proof comment/state
- [x] Update runner state and advance to the next dependency-safe approved issue.
  - **Verify:** run-state/status/manager-state/status.md agree on progress and receipt paths

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 11:36 | Dependency and source preflight | ✅ | Clean isolated branch at `20bc528`; THE-851 live Done; THE-852 Todo |
| 11:45 | Execution plan | ✅ | Deterministic mapping/validation/proof flow defined |
| 11:47 | Mapping and validation | ✅ | 181/181 rows; seven unique candidates; positive and negative paths pass |
| 11:49 | Repository gate | ✅ | Server build; 108 files / 796 tests on CI Node 22 |
| 11:53 | Review | ✅ | Correctness and data-safety re-reviews APPROVED, 0 blockers |

## Files Touched

- `docs/plans/2026-07-30-the-852-engineering-import-mapping-plan.md` — canonical execution plan
- `docs/plans/ACTIVE_PLAN.md` — recovery copy
- `docs/plans/entity-engineering-import-mapping-source.csv` — normalized source identity
- `docs/plans/entity-engineering-import-mapping.csv` — complete disposition spreadsheet
- `docs/plans/entity-engineering-import-mapping.md` — human-readable landing protocol
- `scripts/proof/ee-b-04-import-mapping.py` — fail-closed generator and validator

## Resume Instructions

1. Re-read this file and run `git status`.
2. Continue from the first unchecked plan step.
3. Do not import tasks or mutate any runtime/production database in THE-852.
4. Keep one source checklist row per source line and one disposition per row.
5. Use title-keyed deterministic IDs for eligible import candidates and reject duplicates.
6. Do not place Helm-owned Skill Workshop/runtime-secret/admin work into Entity core.

## Done

- [x] Every source checklist item has one deterministic disposition.
- [x] Eligible Engineering candidates have unique stable keys and landing metadata.
- [x] Mapping validation and review pass with zero blockers.
- [x] Proof is attached to Linear and THE-852 is Done.
- [x] Runner advances without production/data mutation.
