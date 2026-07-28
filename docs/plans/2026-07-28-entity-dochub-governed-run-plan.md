# Entity Doc Hub Governed Runner Plan

## Task

Run the approved Entity Doc Hub Daily Use Fix Pack queue from THE-650 through THE-672.

**Created:** 2026-07-28
**Agent:** Geordi / Codex Runner Governed
**Status:** IN PROGRESS

## Context

- Queue authority: `.runner/approved-queue.json`
- Base: `origin/main`
- Branch: `runner/dochub-governed-20260728`
- THE-648 and THE-649 were completed before this run; begin at THE-650.
- This run must not push or merge. If source changes remain at queue closure, terminate run-state as blocked pending explicit Henry delivery approval and Book/SuperAda verification.
- Every issue needs durable proof and a clean governed review before advancing.

## Dependencies

- [x] THE-650 depends on the earlier THE-649 LaunchAgent inventory.
- [ ] THE-652 depends on THE-650 and THE-651.
- [ ] THE-653 depends on THE-652.
- [ ] Milestone A runs in approved dependency order from THE-654 through THE-672.

## Plan

- [x] Step 1: Complete THE-650 deploy-profile versus running-path characterization.
  - **Files:** `.runner/run-state.json`, `output/entity-dochub-governed/proof/THE-650/`, `output/entity-dochub-governed/review/THE-650.md`
  - **Verify:** repo-real profile/LaunchAgent inspection commands plus governed review
- [ ] Step 2: Complete Milestone 0 issues THE-651 through THE-653.
  - **Files:** issue-scoped source changes if required, proof and review receipts
  - **Verify:** relevant package scripts, sandbox/API/browser proof
- [ ] Step 3: Complete Milestone A issues THE-654 through THE-671.
  - **Files:** issue-scoped app/server code and colocated tests, proof and review receipts
  - **Verify:** targeted tests, relevant builds, sandbox/API/browser proof, governed review
- [ ] Step 4: Complete THE-672 end-to-end and UI proof gate.
  - **Files:** final proof/review receipts and `.runner/run-state.json`
  - **Verify:** full relevant gate plus browser proof
- [ ] Step 5: Close the local run at the delivery authority boundary.
  - **Files:** `.runner/run-state.json`, this plan
  - **Verify:** if source changes remain, run-state is blocked with the exact Henry + Book/SuperAda decision needed; no push or merge occurs in this run

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 21:58 | Step 1 | In progress | Branch/base clean; queue and source authority loaded |
| 22:04 | Step 1 | Blocked | Previous review slug was misspelled as gpt-5.6-tera; corrected to gpt-5.6-terra |
| 22:34 | Step 1 | In progress | Resumed corrected governed review with no positional prompt |
| 22:36 | Step 1 | Complete | Corrected gpt-5.6-terra high review exited 0 with no blockers |
| 22:36 | Step 2 | In progress | Advanced run-state to THE-651 |

## Files Touched

- `.runner/run-state.json` — runner control state; never commit
- `docs/plans/2026-07-28-entity-dochub-governed-run-plan.md` — durable execution plan
- `docs/plans/ACTIVE_PLAN.md` — current recovery pointer
- `tasks/todo.md` — local task checklist
- `output/entity-dochub-governed/` — issue proof/review receipts; never commit

## Resume Instructions

1. Read this file and `.runner/run-state.json`.
2. Run `git status --short --branch` and inspect the issue-scoped diff.
3. Read `.runner/approved-queue.json`; work only its IDs.
4. Continue from the first unchecked step and current issue.
5. Never redo THE-648/THE-649, push, merge, or promote production in this run.
6. After the queue is locally clean, mark run-state blocked pending explicit Henry delivery approval and Book/SuperAda verification if source changes remain.

## Done

- [ ] All approved issues from THE-650 are completed or explicitly blocked
- [ ] Required tests/builds/browser proof pass
- [ ] Every completed issue has a clean governed review
- [ ] Run-state is terminal: blocked pending delivery authority when source changes remain
- [ ] No proof/control artifacts are committed
