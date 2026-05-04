# Branch Merge Safety Plan

## Task
Determine whether all unmerged Entity branches can be safely merged into `main`, and merge only after clean conflict and verification evidence.

**MC Task:** N/A
**Created:** 2026-04-25
**Agent:** Codex
**Status:** IN PROGRESS

## Context
- User asked whether all current branches can be safely merged into one `main`.
- The primary worktree at `/Users/henrymascot/Code/entity` is dirty, so merge testing must happen in an isolated worktree.
- Entity repo rules require server tests after changes under `packages/server/`.
- Prior required gate for this repo is `PATH=/opt/homebrew/bin:$PATH npm run ctrl:full` when claiming full integration safety.

## Dependencies
- [x] Step 1 has no dependencies.
- [ ] Step 2 depends on an isolated clean worktree.
- [ ] Step 3 depends on branch inventory from Step 1.
- [ ] Step 4 depends on conflict-free merge simulation.
- [ ] Step 5 depends on resolved merge candidate and verification results.

## Plan
- [x] Step 1: Inventory unmerged local and remote branches.
  - **Files:** None
  - **Verify:** `git branch --no-merged main` and `git branch -r --no-merged main`
- [x] Step 2: Create an isolated audit worktree from `origin/main`.
  - **Files:** `/tmp/entity-merge-audit`
  - **Verify:** `git status --short --branch`
- [x] Step 3: Classify each unmerged branch as unique, duplicate, stale, or unsafe.
  - **Files:** None
  - **Verify:** `git cherry -v main <branch>` and `git diff --stat main...<branch>`
- [x] Step 4: Simulate merging unique branches together in the audit worktree.
  - **Files:** `/tmp/entity-merge-audit`
  - **Verify:** `git merge --no-commit --no-ff <branch>`
- [x] Step 5: Run verification on the merged candidate and report whether merging to `main` is safe.
  - **Files:** `/tmp/entity-merge-audit`
  - **Verify:** `cd packages/server && npx vitest run`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 21:40 | Step 1 | Done | Found unique candidates plus duplicate fork refs and patch-equivalent `origin/p0-features`. |
| 21:44 | Step 2 | Done | Created `/tmp/entity-merge-audit` from `origin/main`. |
| 21:45 | Step 3 | Done | Unique candidates touch TaskDetailPanel, large swarm/docs/artifacts set, and review-policy. |
| 22:18 | Step 4 | Done | Small branches merged in audit worktree; large codex branch conflicts in 17 files. |
| 22:20 | Step 5 | Done | Baseline already fails build/tests; merged candidate adds review-policy test failure. |

## Files Touched
- `docs/plans/2026-04-25-branch-merge-safety-plan.md` — created — merge safety plan.
- `docs/plans/ACTIVE_PLAN.md` — modified — points current work to this plan.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Use `/tmp/entity-merge-audit` for merge tests; do not merge in the dirty primary worktree.
5. Continue from there without redoing completed checks unless refs changed.

## Done
- [x] All steps complete.
- [x] Tests pass or failures are reported with exact blockers.
- [x] Safe branches are identified.
- [x] Unsafe/stale branches are identified.
