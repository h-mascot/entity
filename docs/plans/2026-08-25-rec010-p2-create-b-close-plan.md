# Plan Template — Compaction-Survivable Execution

<!-- 
  HOW TO USE:
  1. Copy this template to docs/plans/YYYY-MM-DD-<slug>-plan.md
  2. Fill in the plan
  3. Copy/overwrite docs/plans/ACTIVE_PLAN.md with the same content
  4. Execute from ACTIVE_PLAN.md — check items as you go
  5. After compaction, re-read ACTIVE_PLAN.md, inspect state, continue from first [ ]
-->

## Task
<!-- One-line description of what we're building/fixing -->

**MC Task:** #___  
**Created:** YYYY-MM-DD  
**Agent:** ___  
**Status:** IN PROGRESS

## Context
<!-- Why this task exists, key constraints, links to relevant docs/threads -->

## Dependencies
<!-- What must be true before each step can start. Reduces compaction pressure by making "next ready" obvious. -->
- [ ] Step 1 has no dependencies
- [ ] Step 3 depends on Step 1 output (file: ___)
- [ ] Step 5 depends on Steps 2+3

## Plan

- [ ] Step 1: ___
  - **Files:** `path/to/file`
  - **Verify:** `command to verify`
- [ ] Step 2: ___
  - **Files:** `path/to/file`
  - **Verify:** `command to verify`
- [ ] Step 3: ___
  - **Files:** `path/to/file`
  - **Verify:** `command to verify`

## Checkpoints
<!-- Update as you complete steps — this is your resume point after compaction -->
| Time | Step | Status | Notes |
|------|------|--------|-------|
| HH:MM | Step 1 | ✅ | Brief result |
| HH:MM | Step 2 | ⏳ | In progress |

## Files Touched
<!-- Track every file created/modified — helps recovery inspect state -->
- `path/to/file1` — created/modified — what it does
- `path/to/file2` — created/modified — what it does

## Resume Instructions
<!-- For the agent that picks this up after compaction -->
1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections
5. Continue from there — do NOT redo completed steps

## Done
- [ ] All steps complete
- [ ] Tests pass (if applicable)
- [ ] MC task moved to review
- [ ] ACTIVE_PLAN.md cleared or updated for next task
