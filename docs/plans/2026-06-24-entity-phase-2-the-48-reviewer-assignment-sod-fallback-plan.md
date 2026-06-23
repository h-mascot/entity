## Task
Implement `THE-48` / `THE-11.3`: implement reviewer assignment and separation-of-duties fallback.

**MC Task:** Entity Phase 2 approved queue
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** BLOCKED

## Context
Live Linear `THE-48` is a child issue under parent `THE-11`, source `THE-11.3`. Scope is the canonical reviewer assignment chain: initiator, same-team capable reviewer pool, owner if eligible, admin/routing problem when no eligible reviewer exists. Entity remains the work/collaboration/review plane; this issue must not introduce deep runtime/admin controls or generic orchestration.

Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, `docs/context/entity-phase-2-build-context.md`, canonical PRD, Oracle spec, `.project-gate.json`, execution-pack plan.

## Dependencies
- [x] Required repo rules, context, canonical PRD, Oracle spec excerpts, gate config, package scripts, issue map, and run-state read.
- [x] Live Linear `THE-48` read and confirmed as child `THE-11.3` under parent `THE-11`.
- [x] Live Linear parent `THE-11` read and confirms review policy, human gates, and deterministic separation-of-duties fallback scope.
- [x] Prior siblings `THE-46` and `THE-47` are `Done` in live Linear/run-state.
- [x] Current branch created: `THE-48-implement-reviewer-assignment-and-separation-of-duties-fallback`.

## Plan
- [x] Step 1: Inspect existing policy resolver, principal/task fields, and test seams.
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/__tests__/db-repositories.test.ts`
  - **Verify:** identify the smallest reviewer assignment contract that composes with `resolveTaskPolicy`.
- [x] Step 2: Implement deterministic reviewer assignment and SoD fallback.
  - **Files:** likely `packages/db/src/index.ts`
  - **Verify:** initiator is excluded only when also assignee, executor, or submitted_by; skipped candidates preserve reason chain; no eligible reviewer yields a routing problem/admin escalation state.
- [x] Step 3: Add SoD fallback and self-review rejection tests.
  - **Files:** likely `packages/server/src/__tests__/db-repositories.test.ts`
  - **Verify:** success path, skipped-candidate path, owner fallback, and routing problem path pass.
- [x] Step 4: Run focused tests and required proof commands under Node 22.
  - **Files:** command receipts only
  - **Verify:** `cd packages/server && npx vitest run src/__tests__/db-repositories.test.ts`, `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, and `cd packages/server && npm run build && npx vitest run` pass.
- [ ] Step 5: Run CLI Tester four-step for `THE-48`.
  - **Files:** `output/entity-phase-2/test-gate/THE-48.*`, `output/entity-phase-2/book-review/THE-48.*`
  - **Verify:** request and run pass; book-review currently blocks on `decision=REQUESTED`, `safeToContinue=false`; verify exits non-zero, so do not start `THE-49`.
- [ ] Step 6: Comment Linear, update run-state, commit, and advance only if gates pass.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-48`
  - **Verify:** Linear proof comment includes branch, files changed, commands/exit codes, proof paths, gate receipt, Book review receipt, and blockers if any.

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 00:10 | Setup | done | Context reread; `THE-48` and parent `THE-11` live Linear bodies read; branch created. |
| 00:17 | Steps 1-3 | done | Added reviewer assignment result, SoD candidate skipping, owner fallback/routing problem output, and focused tests. `npm --prefix packages/db run build && cd packages/server && npx vitest run src/__tests__/db-repositories.test.ts` passed under Node v22.22.2. |
| 00:19 | Step 4 | done | Required proof commands passed under Node v22.22.2: smoke PASS; root build PASS; server build PASS; full Vitest 59 files / 443 tests PASS. |
| 00:22 | Step 5 | blocked | CLI Tester `request` exit 0; `run` exit 0 with status PASS/blockers []; `book-review` exit 1 with `decision=REQUESTED`, `safeToContinue=false`; `verify` exit 1. |

## Files Touched
- `docs/plans/2026-06-24-entity-phase-2-the-48-reviewer-assignment-sod-fallback-plan.md` - created - compaction-safe plan for `THE-48`.
- `docs/plans/ACTIVE_PLAN.md` - modified - active resume plan for `THE-48`.
- `packages/db/src/index.ts` - modified - reviewer assignment result and deterministic SoD fallback.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - SoD fallback and routing problem tests.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Continue from the first unchecked step above.
5. Use Node v22.22.x for proof/gate commands unless native dependencies are rebuilt for another Node.
6. Do not start `THE-49` until `THE-48` proof commands, CLI Tester run, Book review, and verify pass, or Henry explicitly approves a waiver.

## Done
- [x] `THE-48` implementation complete.
- [x] Focused tests pass.
- [x] Required proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass with `nextChildBlocked=false`.
- [ ] Linear proof comment posted.
- [ ] Scoped commit created.
- [ ] Run-state advanced to `THE-49`.
