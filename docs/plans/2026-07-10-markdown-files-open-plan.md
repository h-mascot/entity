# ACTIVE PLAN — Restore Markdown file opening

## Task

Restore Doc Hub Markdown file loading when a non-empty `.md` file currently renders as “Empty file”.

**Created:** 2026-07-10
**Agent:** Codex
**Status:** COMPLETE

## Context

- User-visible regression reported from Doc Hub with `CHANGELOG.draft.md`.
- GitNexus was confirmed reachable, then refreshed from 288 commits behind to current `HEAD` before investigation.
- Preserve the existing UI and fix the root cause with a behavior-level regression test.

## Dependencies

- [x] Step 1 has no dependencies
- [x] Step 2 depends on reproducing and tracing Step 1
- [x] Step 3 depends on a confirmed causal chain and a failing regression test
- [x] Step 4 depends on the implementation passing focused tests
- [x] Step 5 depends on all verification and review gates passing

## Plan

- [x] Step 1: Reproduce the Markdown-open failure and trace the browser-to-filesystem path
  - **Files:** read-only investigation
  - **Verify:** browser reproduction plus GitNexus/code trace
- [x] Step 2: Add one failing behavior-level regression test for non-empty Markdown content
  - **Files:** determined by root cause
  - **Verify:** focused test fails for the observed bug
- [x] Step 3: Implement the minimal root-cause fix
  - **Files:** determined by root cause
  - **Verify:** focused regression test passes
- [x] Step 4: Run app/server tests, builds, CTRL, and mandatory reviews
  - **Files:** no new production scope expected
  - **Verify:** `cd packages/server && npm run build && npx vitest run`; `npm --prefix packages/app run build`; `npm run ctrl:full`; Codex review
- [x] Step 5: Rebuild/restart as needed and verify the exact Doc Hub workflow in the browser with screenshot evidence
  - **Files:** `/tmp/entity-markdown-open-fixed.png`
  - **Verify:** open a known non-empty `.md` file and confirm rendered content

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 12:35 | GitNexus preflight | ✅ | Refreshed index to current HEAD; query returned Doc Hub Markdown flow |
| 12:35 | Step 1 | ✅ | Confirmed normal Markdown opens; stale indexed paths reproduce false Empty file state |
| 12:49 | Steps 2–3 | ✅ | Added stale-path reconciliation, incomplete-scan guard, 404 mapping, and explicit load error |
| 12:52 | Step 5 | ✅ | Browser opened real Markdown and showed Retry state for a missing Markdown path; screenshot API timed out |
| 13:20 | Step 4 | ✅ | 99 server files / 702 tests, 31 app tests, 5 DB tests, builds and CTRL gate pass; correctness + thermo reviews approved with 0 blockers |
| 13:21 | Step 5 | ⚠️ | Final browser reload and screenshot capture timed out; earlier real-Markdown and missing-path browser checks remain the UI evidence |

## Files Touched

- `docs/plans/2026-07-10-markdown-files-open-plan.md` — created — compaction-safe task plan
- `docs/plans/ACTIVE_PLAN.md` — modified — active resume state for this task
- `packages/app/src/App.tsx` — modified — tracks file loading, errors, and retry
- `packages/app/src/hooks/useFileSources.ts` — modified — rejects offline-cache fallback for client errors
- `packages/app/src/lib/fileCacheFallback.ts` — created — defines safe offline fallback policy
- `packages/app/src/lib/fileCacheFallback.test.ts` — created — covers 4xx and 5xx cache behavior
- `packages/app/src/lib/fileLoadIdentity.ts` — created — builds collision-free file identities
- `packages/app/src/lib/fileLoadIdentity.test.ts` — created — covers identity edge cases
- `packages/app/src/views/DocumentEditorView.tsx` — modified — renders honest load/error states
- `packages/db/src/file-index.ts` — modified — reconciles stale indexed paths
- `packages/db/src/file-index.test.ts` — created — covers repository reconciliation
- `packages/server/src/fs/index-runner.ts` — modified — reconciles only complete scans
- `packages/server/src/fs/index-runner.test.ts` — modified — covers complete and capped scans
- `packages/server/src/fs/errors.ts` — created — canonicalizes missing-path errors
- `packages/server/src/fs/errors.test.ts` — created — covers local and remote missing-path forms
- `packages/server/src/fs/routes-files.ts` — modified — maps missing files to 404
- `packages/server/src/fs/routes-files.test.ts` — modified — covers missing-file status
- `packages/server/src/routes/legacy-files.ts` — modified — shares canonical missing-path classification

## Resume Instructions

1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the “Files Touched” and “Checkpoints” sections
5. Continue from there — do not redo completed steps

## Done

- [x] All steps complete
- [x] Tests pass
- [x] Browser verification complete; screenshot capture blocked by repeated browser-control timeouts
- [x] Reviews pass with zero unresolved blockers
