## Task
Implement `THE-28` (`THE-7.3`) by enforcing task initiator, individual owner, assignee, and executor accountability for new task API flows.

**MC Task:** THE-28
**Created:** 2026-06-23
**Agent:** Cursor
**Status:** IN PROGRESS

## Context
Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, Phase 2 context/spec files, `.project-gate.json`, and the execution-pack plan.

`THE-28` is a child of `THE-7`. It is dependency-safe because `THE-26` and `THE-27` are Done in live Linear, `THE-27` has an APPROVED Book review receipt with `safeToContinue=true`, and `THE-27` verify passes under Node v22.22.2 with no blockers.

Scope is task accountability validation only. Do not implement workspace navigation UI (`THE-29`), safe backfill (`THE-30`), unified principal registry (`THE-71`), or review assignment (`THE-48`) beyond minimal additive fields and route validation needed for this issue.

## Dependencies
- [x] Live Linear body confirms `THE-28` maps to `THE-7.3`.
- [x] Parent epic `THE-7` confirms task accountability scope.
- [x] `THE-27` gate, Book review, and verify allow continuation.
- [x] Branch `THE-28-enforce-task-accountability-validation` exists.
- [x] Existing DB repository, task route, and test patterns are inspected.
- [x] Implementation stays scoped to task accountability validation and compatibility notes.
- [ ] Required proof commands and CLI Tester gates pass.

## Plan
- [x] Step 1: Confirm issue mapping, parent, and dependency safety.
  - **Files:** Linear `THE-28`, Linear `THE-7`, `.cursor/run-state/entity-phase-2.json`, `output/entity-phase-2/test-gate/THE-27.json`, `output/entity-phase-2/book-review/THE-27.json`
  - **Verify:** Live Linear fetch plus receipt reads show child/source mapping and `THE-27` continuation is allowed.
- [x] Step 2: Inspect existing task repository/API validation seams before editing.
  - **Files:** `packages/db/src/index.ts`, `packages/db/src/task-sync.ts`, `packages/server/src/index.ts`, colocated tests
  - **Verify:** Targeted reads/searches identify task create/update/move and repository compatibility seams.
- [x] Step 3: Add additive accountability fields and legacy-safe repository mapping.
  - **Files:** `packages/db/src/index.ts`, `packages/db/src/cloud.ts` if remote task mapping needs fields
  - **Verify:** TypeScript build plus DB repository compatibility test.
- [x] Step 4: Enforce new task accountability rules in API create/update/move flows.
  - **Files:** `packages/server/src/index.ts`
  - **Verify:** Focused route tests cover missing initiator, missing owner, team-owner rejection, and Task-Master-drivable unassigned active work.
- [x] Step 5: Add focused tests and compatibility note.
  - **Files:** colocated route/repository tests, `docs/context/entity-phase-2-current-state-gap-matrix.md` if needed for the legacy note
  - **Verify:** `cd packages/server && npx vitest run <focused tests>`
- [ ] Step 6: Run proof and gate commands.
  - **Files:** proof receipts under `output/entity-phase-2/`
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, `cd packages/server && npm run build && npx vitest run`, CLI Tester `request`, `run`, `book-review`, and `verify`.
- [ ] Step 7: Commit scoped work and post Linear proof comment.
  - **Files:** changed implementation/tests/docs; local run-state remains uncommitted
  - **Verify:** `git status --short --branch`, `git log -1 --oneline`, Linear comment response.

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 03:56 | Step 1 | done | Live Linear confirms `THE-28` child/source mapping and `THE-27` is Done. `THE-27` verify initially failed under Node v26 due the known better-sqlite3 ABI mismatch, then passed under Node v22.22.2. |
| 04:02 | Step 2 | done | Existing task API enforces active-task assignee strings; DB has org/team/project seam but lacks initiator/owner/executor/taskmaster-drivable fields. |
| 04:05 | Steps 3-5 | done | Added additive task accountability fields, route validation helpers, focused validation tests, DB compatibility test, and gap-matrix compatibility note. Focused tests and server build pass. |

## Files Touched
- `docs/plans/2026-06-23-entity-phase-2-the-28-task-accountability-plan.md` - created - compaction-safe plan for current issue.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution plan for current issue.
- `packages/db/src/index.ts` - modified - additive task accountability fields and legacy-safe mapping/update support.
- `packages/db/src/cloud.ts` - modified - cloud task mapper includes accountability fields.
- `packages/server/src/index.ts` - modified - task create/update/move accountability validation.
- `packages/server/src/task-accountability.ts` - created - pure accountability parsing/validation helpers.
- `packages/server/src/task-accountability.test.ts` - created - missing initiator/owner, team-owner, executor, and Task-Master-drivable validation coverage.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - legacy task compatibility marker coverage.
- `docs/context/entity-phase-2-current-state-gap-matrix.md` - modified - backward-compatibility note for legacy tasks.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Continue from the first unchecked step above.
5. Use Node v22.22.2 for proof/gate commands unless native dependencies are rebuilt for another Node.
6. Do not start `THE-29` until `THE-28` proof commands pass, CLI Tester `run` passes, Book review is APPROVED with `safeToContinue=true`, and CLI Tester `verify THE-28` passes with `nextChildBlocked=false`, or Henry explicitly waives the gate.

## Done
- [ ] All implementation/proof steps complete.
- [ ] Proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass.
- [ ] Linear proof comment added.
- [ ] `THE-29` identified as next candidate only after verify allows continuation.
