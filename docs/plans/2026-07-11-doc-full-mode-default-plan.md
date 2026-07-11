# ACTIVE PLAN — Default documents to focused full mode

## Task

Open document pages with both the left workspace sidebar and right intelligence sidebar collapsed, while keeping non-document workspace pages open by default.

**Created:** 2026-07-11
**Agent:** Codex
**Status:** IN PROGRESS

## Plan

- [x] Step 1: Inspect route-specific sidebar initialization and transitions
  - **Verify:** identify persisted state and document open/close paths
- [x] Step 2: Implement document-only focused defaults
  - **Verify:** opening or switching documents collapses both rails; leaving documents opens both rails
- [x] Step 3: Run tests, build, browser verification, GitNexus, and reviews
  - **Verify:** app suite/build and desktop browser workflows pass with screenshot evidence
- [ ] Step 4: Commit, push, deploy, and verify production
  - **Verify:** exact production document route opens focused; Tasks/Agents remain open

## Files Touched

- `docs/plans/2026-07-11-doc-full-mode-default-plan.md` — created — task plan
- `docs/plans/ACTIVE_PLAN.md` — modified — active resume state
- `packages/app/src/App.tsx` — modified — route-scoped document focus transitions
- `packages/app/src/lib/documentShellState.ts` — created — focused/open shell default contract
- `packages/app/src/lib/documentShellState.test.ts` — created — document and non-document default coverage

## Checkpoints

- 05:01 — App 43, DB 5, server 702; CTRL gate and live smoke pass under Node 22
- 05:01 — Browser verified document focused mode and Tasks open sidebar; correctness/UI reviews approved

## Resume Instructions

1. Read this file and `git status`
2. Continue from the first unchecked step
3. Preserve document manual expand controls; apply defaults only on document transitions

## Done

- [ ] All steps complete
- [ ] Browser workflows verified
- [ ] Reviews approved
- [ ] Production verified
