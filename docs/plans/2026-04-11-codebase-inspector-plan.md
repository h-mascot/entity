# Task Plan — Whole Codebase Inspector

## Task
Run a full-repo inspection to identify how Entity can work substantially better through simplification, deletion, consolidation, and safer defaults without adding new code paths or causing regressions.

**MC Task:** #___  
**Created:** 2026-04-11  
**Agent:** Codex  
**Status:** IN PROGRESS

## Context
- The user explicitly requested an inspector agent to review the whole codebase.
- The repo currently has local modifications and untracked files, so this inspection must avoid destructive cleanup and must separate observations from edits.
- The goal is improvement through less code, less duplication, fewer failure points, and safer behavior rather than feature expansion.

## Dependencies
- [x] Step 1 has no dependencies
- [ ] Step 2 depends on Step 1 output (repo state and inspection brief)
- [ ] Step 3 depends on Step 2 output (agent findings returned)
- [ ] Step 4 depends on Step 3 output (findings triaged into actionable recommendations)

## Plan

- [x] Step 1: Capture repo state, constraints, and inspection goal
  - **Files:** `docs/plans/2026-04-11-codebase-inspector-plan.md`, `docs/plans/ACTIVE_PLAN.md`
  - **Verify:** `git status -sb`
- [x] Step 2: Spawn inspector agent for whole-codebase review
  - **Files:** none
  - **Verify:** inspector agent created and assigned repo-wide review brief
- [x] Step 3: Collect and review findings from the inspector
  - **Files:** none
  - **Verify:** inspector response contains concrete low-risk simplification opportunities
- [x] Step 4: Summarize prioritized recommendations and next-step options for the user
  - **Files:** `docs/plans/2026-04-11-codebase-inspector-plan.md`, `docs/plans/ACTIVE_PLAN.md`
  - **Verify:** response delivered with prioritized actions and explicit assumptions

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 22:11 | Step 1 | ✅ | Created inspection plan and replaced stale active plan |
| 22:12 | Step 2 | ✅ | Spawned inspector agent `Zeno` for repo-wide read-only review |
| 22:15 | Step 3 | ✅ | Inspector returned prioritized simplification and risk-reduction findings |
| 22:16 | Step 4 | ✅ | Validated top runtime drift findings locally and prepared recommendations |

## Files Touched
- `docs/plans/2026-04-11-codebase-inspector-plan.md` — created — durable plan for repo-wide inspection request
- `docs/plans/ACTIVE_PLAN.md` — modified — active recovery pointer for this inspection task

## Resume Instructions
1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections
5. Continue from there — do NOT redo completed steps

## Done
- [x] All steps complete
- [x] Findings delivered to user
- [ ] ACTIVE_PLAN.md cleared or updated for next task
