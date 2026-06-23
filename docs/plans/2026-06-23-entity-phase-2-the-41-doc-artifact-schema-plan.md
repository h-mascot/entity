## Task
Implement `THE-41` / `THE-10.1`: define distinct `NativeDocument`, `ExternalDocumentRef`, `EvidenceArtifact`, and `ObjectRef` schema/types.

**MC Task:** Entity Phase 2 approved queue
**Created:** 2026-06-23
**Agent:** Cursor
**Status:** IN_PROGRESS

## Context
Run-state points to `THE-41` after `THE-40` approval. Live Linear and `docs/specs/entity-phase-2-linear_id_to_source_id.json` both confirm `THE-41` is source `THE-10.1`, parent `THE-10`, not the stale `THE-9.6` UI issue mentioned by the previous relaunch pointer.

Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, `docs/context/entity-phase-2-build-context.md`, canonical PRD, SuperSpec, `.project-gate.json`, execution-pack plan.

## Dependencies
- [x] Required repo rules, context, canonical PRD, gate config, package scripts, run-state, and active plan read.
- [x] Live Linear `THE-41` read and confirmed as child `THE-10.1` under parent `THE-10`.
- [x] Live Linear parent `THE-10` read and confirmed docs/files/artifacts object model scope.
- [x] Mapping table confirms `THE-41 -> THE-10.1`, parent `THE-10`.
- [x] Current HEAD before branching is `2445d3d` on `THE-40-harden-receipt-immutability-path-stability-and-protocol-docs`.
- [x] Branch `THE-41-define-nativedocument-externaldocumentref-evidenceartifact-and-objectref-schema` created from current HEAD and pushed to origin.

## Plan
- [x] Step 1: Preflight run-state, mapping, live Linear child and parent, and git base.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-41`, Linear `THE-10`, mapping table.
  - **Verify:** Source is `THE-10.1`, parent is `THE-10`, branch base is `2445d3d`.
- [x] Step 2: Inspect current DB/type/schema surfaces for existing docs, artifact, object reference, and receipt metadata patterns.
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/**/*.ts`, existing tests.
  - **Verify:** Identify smallest additive schema/type/validator slice without UI work.
- [x] Step 3: Implement only `THE-41` schema, TypeScript types, validators, migration path, and ObjectRef fixture.
  - **Files:** likely `packages/db/src/index.ts`, colocated server/db tests, and narrow docs/context note only if needed.
  - **Verify:** Native/external/evidence concepts are distinct; `ObjectRef` is `{ object_type, object_id, link_role }`; migration path for vague file/artifact refs is explicit and non-destructive.
- [x] Step 4: Add/update focused validation tests.
  - **Files:** colocated `*.test.ts` files.
  - **Verify:** Schema/type tests cover success and invalid/degraded paths, including malformed `ObjectRef` and vague legacy reference migration shape.
- [x] Step 5: Run proof commands.
  - **Files:** command output receipts only.
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, `cd packages/server && npm run build && npx vitest run` pass.
- [ ] Step 6: Run CLI Tester four-step for `THE-41`.
  - **Files:** `output/entity-phase-2/test-gate/THE-41.*`, `output/entity-phase-2/book-review/THE-41.*`.
  - **Verify:** request, run, book-review, and verify pass; verify reports `nextChildBlocked=false`.
- [ ] Step 7: Comment Linear, save-point commit, push, and advance run-state to `THE-42`.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-41`.
  - **Verify:** Linear proof comment includes branch, files changed, commands/exit codes, proof paths, gate receipt, Book review receipt; branch pushed.
- [ ] Step 8: Start `THE-42` immediately after `THE-41` verify allows continuation.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-42`, Linear `THE-10`.
  - **Verify:** first preflight for `THE-42` complete before code changes.

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 16:30 | Step 1 | done | Reread required context; live Linear confirms `THE-41` is `THE-10.1` child under `THE-10`; branch created and pushed from `2445d3d`. |
| 16:34 | Steps 2-4 | done | Added DB package types/schema/repository validators for `NativeDocument`, `ExternalDocumentRef`, `EvidenceArtifact`, `ObjectRef`, and legacy-reference migration planning; DB build and focused repository tests passed. |
| 16:36 | Step 5 | done | Required proof commands passed under Node v22.22.3: smoke, root build, and server build + full Vitest (58 files / 423 tests). |
| 16:38 | Step 6 | blocked | CLI Tester request and run passed; Book review receipt is `REQUESTED`/`safeToContinue=false`; verify receipt remains machine `PASS` but `reviewGateStatus=BLOCKED`, `nextChildBlocked=true`. Do not start `THE-42`. |

## Files Touched
- `docs/plans/2026-06-23-entity-phase-2-the-41-doc-artifact-schema-plan.md` - created - compaction-safe plan for `THE-41`.
- `docs/plans/ACTIVE_PLAN.md` - modified - active resume plan for `THE-41`.
- `packages/db/src/index.ts` - modified - additive document/artifact object schema, ObjectRef validation, repositories, and evidence artifact link refs.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - focused THE-41 schema/type/validator/migration-path tests.
- `packages/server/src/receipt-writer.test.ts` - modified - fixture updated for required evidence artifact linked-object refs.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Find the first unchecked step above.
5. Use Node v22.22.x for proof/gate commands unless native dependencies are rebuilt for another Node.
6. Continue from `THE-41`; do not restart earlier issues or use the stale `THE-9.6` pointer.

## Done
- [ ] `THE-41` implementation complete.
- [ ] Focused tests pass.
- [ ] Required proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass with `nextChildBlocked=false`.
- [ ] Linear proof comment posted and issue status updated.
- [ ] Scoped save-point commit pushed.
- [ ] Run-state advanced to `THE-42`.
