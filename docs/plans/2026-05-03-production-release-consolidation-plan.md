# Entity Production Release Consolidation Plan

## Task
Push the current Entity work to GitHub and production while preserving all unmerged features and cleaning dirty worktrees.

**MC Task:** n/a  
**Created:** 2026-05-03  
**Agent:** Codex  
**Status:** IN PROGRESS

## Context
Local `main` is dirty and diverged from `origin/main` after chat work. The user wants production release, branch consolidation, and no feature loss. Prior memory says branch merge questions in Entity should be treated as fresh merge-safety audits, not blind merges.

## Dependencies
- [x] Step 1 has no dependencies
- [ ] Step 2 depends on fresh `git fetch --all --prune`
- [ ] Step 3 depends on preserving dirty work in a commit/branch
- [ ] Step 4 depends on branch-audit results
- [ ] Step 5 depends on tests and Browser Use verification

## Plan

- [ ] Step 1: Inventory current repo, remotes, branches, dirty files
  - **Files:** n/a
  - **Verify:** `git status --short --branch`, `git branch -r`, `git rev-list --left-right --count`
- [ ] Step 2: Commit current dirty work to a release branch
  - **Files:** all current dirty feature work
  - **Verify:** `git status --short --branch`
- [ ] Step 3: Merge/rebase release branch onto current `origin/main`
  - **Files:** conflict files if any
  - **Verify:** `git rev-list --left-right --count HEAD...origin/main`
- [ ] Step 4: Audit local-only branch commits and integrate any non-duplicated features
  - **Files:** branches with ahead commits
  - **Verify:** `git branch --contains` / `git cherry` / targeted diffs
- [ ] Step 5: Run full validation and push/deploy through pipeline
  - **Files:** n/a
  - **Verify:** `npm --prefix packages/app run build`, targeted server tests, Browser Use, `npm run ctrl:full`, git push

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 14:42 | Step 1 | ✅ | Fetched remotes; `main` was dirty, ahead 1 and behind 49; most remote feature branches are behind `origin/main` |

## Files Touched
- `docs/plans/ACTIVE_PLAN.md` — updated — release consolidation resume plan
- `docs/plans/2026-05-03-production-release-consolidation-plan.md` — created — durable release plan

## Resume Instructions
1. Re-read this file fully
2. Run `git status --short --branch`
3. Run `git branch -r --sort=committerdate`
4. Continue at the first unchecked step above

## Done
- [ ] All steps complete
- [ ] Dirty worktree cleaned
- [ ] Branch features audited or merged
- [ ] Tests pass
- [ ] Pushed to GitHub
- [ ] Production pipeline/deploy verified
