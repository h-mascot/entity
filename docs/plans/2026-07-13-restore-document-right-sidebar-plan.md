# Restore document right sidebar

## Task

Restore the Comments and Intelligence rail for document pages when document collaboration is unavailable or still initializing.

**Created:** 2026-07-13
**Agent:** Codex
**Status:** COMPLETE

## Context

Focused document mode intentionally collapses both sidebars on load, but the right rail must remain visible so Comments and Intelligence can be opened. The current document editor conditionally removes the entire right panel whenever `documentsReady` is false, even though the panel itself supports unavailable/disabled states.

## Dependencies

- [x] Step 1 has no dependencies
- [x] Step 2 depends on a red-capable reproduction from Step 1
- [x] Step 3 depends on the focused fix and regression test passing
- [x] Step 4 depends on all local and review gates passing

## Plan

- [x] Step 1: Reproduce and isolate the missing right rail
  - **Files:** `packages/app/src/views/DocumentEditorView.tsx`, app tests
  - **Verify:** focused Vitest or browser assertion fails when a document is open but collaboration is unavailable
- [x] Step 2: Keep the document rail mounted with honest unavailable states
  - **Files:** `packages/app/src/views/DocumentEditorView.tsx`, focused regression test
  - **Verify:** focused test passes and both rail controls remain accessible
- [x] Step 3: Run app tests, build, Codex review, and CTRL
  - **Files:** no additional files expected
  - **Verify:** app test/build commands, Codex review, `npm run ctrl:gate`, `npm run ctrl:full`
- [x] Step 4: Browser-verify locally and in production, deploy through the guarded pipeline, and land on `main`
  - **Files:** production screenshot evidence
  - **Verify:** Comments and Intelligence controls are visible and interactive on the real document route

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 13:50 | Step 1 | in progress | Current render gate removes the entire panel when `documentsReady` is false. |
| 13:56 | Step 1 | complete | Node 22 focused test reproduced `false !== true` for a collaboration-unavailable document. |
| 13:58 | Step 2 | complete | Rail now mounts independently of collaboration readiness and Comments explains unavailable collaboration. |
| 14:14 | Step 3 | complete | App tests/build, 752-test CTRL gate, production live smoke, and guarded deploy-path check passed. |
| 14:15 | Step 4 | in progress | Local browser loaded the document and exercised both Intelligence and Comments controls. |
| 14:18 | Step 3 | complete | Codex review rerun after wording cleanup: clean, with no accepted or actionable findings. |
| 14:22 | Step 4 | complete | CI passed, `deploy.sh --frontend-only` preserved 1,013 tasks, and production browser verification exercised Intelligence and Comments. |

## Files Touched

- `docs/plans/2026-07-13-restore-document-right-sidebar-plan.md` — created — resumable execution plan
- `docs/plans/ACTIVE_PLAN.md` — modified — points at this active repair
- `packages/app/src/App.tsx` — modified — stops forcing the document rail permanently collapsed
- `packages/app/src/views/DocumentEditorView.tsx` — modified — mounts the rail for open documents when the feature is enabled
- `packages/app/src/components/doc-intelligence/DocIntelligencePanel.tsx` — modified — adds an honest Comments unavailable state
- `packages/app/src/lib/documentShellState.ts` — modified — centralizes rail visibility policy
- `packages/app/src/lib/documentShellState.test.ts` — modified — covers collaboration-unavailable documents

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff`.
3. Continue from the first unchecked step.
4. Do not deploy until focused UI proof, review, and CTRL are green.

## Done

- [x] All steps complete
- [x] Tests pass
- [x] Browser proof captured locally
- [x] Changes committed and pushed to `main`
- [x] Production verified
