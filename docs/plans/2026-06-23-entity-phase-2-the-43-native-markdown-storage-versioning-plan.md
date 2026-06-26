## Task
Implement `THE-43` / `THE-10.3`: native markdown storage and versioning seams for Entity docs and artifacts.

**MC Task:** Entity Phase 2 approved queue
**Created:** 2026-06-23
**Agent:** Cursor
**Status:** BLOCKED_ON_BOOK_REVIEW

## Context
`THE-42` is complete and verified locally: machine gate `PASS`, Book review `APPROVED`, `nextChildBlocked=false`, and live Linear state `Done`. `THE-43` is the next child under parent `THE-10`, source `THE-10.3`, with no children. Scope is storage/versioning behavior for Entity-native markdown docs, editable curated reports, and immutable raw evidence receipts.

Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, `docs/context/entity-phase-2-build-context.md`, canonical PRD, SuperSpec, `.project-gate.json`, execution-pack plan.

## Dependencies
- [x] Required repo rules, context, canonical PRD, Oracle spec, gate config, package scripts, and run-state read.
- [x] Live Linear `THE-42` rechecked as Done with approved Book review and PASS verify gate.
- [x] Live Linear `THE-43` read and confirmed as child `THE-10.3` under parent `THE-10`.
- [x] Live Linear parent `THE-10` read and confirms docs/files/artifacts object-model scope.
- [x] Current branch `THE-43-implement-native-markdown-storage-and-versioning-seams` created from verified `THE-42` HEAD.

## Plan
- [x] Step 1: Preflight run-state, mapping, live Linear child and parent, and git base.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-43`, Linear `THE-10`, mapping table.
  - **Verify:** Source is `THE-10.3`, parent is `THE-10`, branch base includes verified `THE-42`.
- [x] Step 2: Inspect current NativeDocument/EvidenceArtifact schema, link services, storage patterns, and test coverage.
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/document-objects.ts`, `packages/server/src/document-objects.test.ts`, related storage/docs helpers.
  - **Verify:** Identify smallest additive storage/versioning seam without UI work.
- [x] Step 3: Implement only `THE-43` storage/versioning behavior.
  - **Files:** likely `packages/db/src/index.ts`, `packages/server/src/document-objects.ts`, focused docs/ADR note.
  - **Verify:** Editable docs/reports create version history; immutable raw artifacts reject overwrite and remain append-only; storage backend choice documented without overcommitting.
- [x] Step 4: Add/update focused tests and fixtures.
  - **Files:** colocated `*.test.ts` files.
  - **Verify:** Versioning success path and immutable/degraded negative path pass.
- [x] Step 5: Run focused tests and required proof commands.
  - **Files:** command output receipts only.
  - **Verify:** focused tests, `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, `cd packages/server && npm run build && npx vitest run` pass.
- [ ] Step 6: Run CLI Tester four-step for `THE-43`.
  - **Files:** `output/entity-phase-2/test-gate/THE-43.*`, `output/entity-phase-2/book-review/THE-43.*`.
  - **Verify:** request, run, book-review, and verify pass; verify reports `nextChildBlocked=false`.
- [ ] Step 7: Comment Linear, update run-state, commit, push if needed, and advance to `THE-44`.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-43`.
  - **Verify:** Linear proof comment includes branch, files changed, commands/exit codes, proof paths, gate receipt, Book review receipt; branch/commit recorded.

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 19:05 | Step 1 | done | `THE-42` receipts and live Linear allow continuation; live Linear confirms `THE-43` / `THE-10.3`; branch created from verified `THE-42` HEAD. |
| 19:54 | Steps 2-4 | done | Added DB version tables/repository methods, API update/history routes, route and SQLite tests, and storage/versioning note. Focused DB build plus 49 tests passed. |
| 19:57 | Steps 5-6 | blocked | Required proof commands and machine gate passed under Node 22. `book-review` wrote packet-mode receipt `output/entity-phase-2/book-review/THE-43.json` with `decision=REQUESTED`, `safeToContinue=false`; continuation to `THE-44` is blocked until Book approval or explicit waiver. |
| 19:58 | Step 7 | blocked | Linear blocker/proof comment posted: `ef2171e2-8cba-45c6-8836-38b616aa671e`. Issue status not advanced because Book approval is missing. |

## Files Touched
- `docs/plans/2026-06-23-entity-phase-2-the-43-native-markdown-storage-versioning-plan.md` - created - compaction-safe plan for `THE-43`.
- `docs/plans/ACTIVE_PLAN.md` - modified - active resume plan for `THE-43`.
- `packages/db/src/index.ts` - modified - version history tables and repository update/list methods for native documents and evidence artifacts.
- `packages/server/src/document-objects.ts` - modified - version update/history API routes and immutable overwrite conflicts.
- `packages/server/src/document-objects.test.ts` - modified - API tests for versioning and immutable overwrite rejection.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - SQLite repository tests for version histories and append-only raw artifacts.
- `docs/context/entity-phase-2-native-markdown-storage-versioning.md` - created - storage/versioning seam note.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Continue at Step 6 after an approved Book receipt exists; then run `project-test-gate verify THE-43`.
5. Use Node v22.22.x for proof/gate commands unless native dependencies are rebuilt for another Node.
6. Continue from `THE-43`; do not restart earlier issues.

## Done
- [x] `THE-43` implementation complete.
- [x] Focused tests pass.
- [x] Required proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass with `nextChildBlocked=false`.
- [ ] Linear proof comment posted and issue status updated.
- [ ] Scoped save-point commit created.
- [ ] Run-state advanced to `THE-44`.
