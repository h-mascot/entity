## Task
Implement `THE-45` / `THE-10.5`: migrate existing docs/artifacts and add permission tests.

**MC Task:** Entity Phase 2 approved queue  
**Created:** 2026-06-23  
**Agent:** Cursor  
**Status:** IN PROGRESS

## Context
Live Linear `THE-45` is a child issue under parent `THE-10`, source `THE-10.5`. Scope is to safely map current docs, output artifacts, review packets, and task links into the NativeDocument / ExternalDocumentRef / EvidenceArtifact object model, with explicit preview/snippet permission tests. The live issue requires an idempotent, non-destructive migration dry-run sample and permission/leakage tests.

Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, `docs/context/entity-phase-2-build-context.md`, canonical PRD, Oracle spec, `.project-gate.json`, execution-pack plan.

## Dependencies
- [x] Required repo rules, context, canonical PRD, Oracle spec, gate config, package scripts, issue map, and run-state read.
- [x] Live Linear `THE-45` read and confirmed as child `THE-10.5` under parent `THE-10`.
- [x] Live Linear parent `THE-10` read and confirms docs/files/artifacts object-model scope.
- [x] Slice 0 dependency is satisfied by completed `THE-21` through `THE-25`.
- [x] Prior `THE-44` gate receipts checked: machine gate `PASS`, Book review `APPROVED`, verify `PASS`, `nextChildBlocked=false`.
- [x] Current branch created: `THE-45-migrate-existing-docs-artifacts-and-add-permission-tests`.

## Plan
- [x] Step 1: Inspect existing document object, artifact, review packet, search/snippet, and migration/backfill seams.
  - **Files:** `packages/server/src/**`, `packages/db/src/**`, `packages/app/src/**`
  - **Verify:** identify the smallest non-destructive migration/test surface matching live `THE-45`.
- [x] Step 2: Implement idempotent dry-run classification of existing docs/artifacts/review packets into target object types or cleanup warnings.
  - **Files:** likely `packages/server/src/**`
  - **Verify:** dry-run returns stable samples without mutating persisted data.
- [x] Step 3: Add permission/leakage enforcement tests for previews/snippets across document object types.
  - **Files:** colocated server tests
  - **Verify:** allowed previews render safe metadata; restricted previews/snippets suppress content.
- [x] Step 4: Emit a `THE-45` migration dry-run receipt artifact.
  - **Files:** `output/entity-phase-2/**`
  - **Verify:** sample includes classified objects and cleanup warnings, no secrets or private defaults.
- [x] Step 5: Run focused tests and required proof commands under Node 22.
  - **Files:** command receipts only
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, `cd packages/server && npm run build && npx vitest run` pass.
- [ ] Step 6: Run CLI Tester four-step for `THE-45`.
  - **Files:** `output/entity-phase-2/test-gate/THE-45.*`, `output/entity-phase-2/book-review/THE-45.*`
  - **Verify:** request, run, book-review, and verify pass; verify reports `nextChildBlocked=false`.
- [ ] Step 7: Comment Linear, update run-state, commit, and advance only if gates pass.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-45`
  - **Verify:** Linear proof comment includes branch, files changed, commands/exit codes, proof paths, gate receipt, Book review receipt, and blockers if any.

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 20:23 | Setup | done | Live `THE-45` and parent `THE-10` read. `THE-44` verified after Book approval. Branch created. |
| 20:29 | Steps 1-4 | done | Added DB dry-run migration report and preview envelope helpers, focused tests, Vitest source alias, and deterministic dry-run sample at `output/entity-phase-2/migrations/THE-45-document-artifact-dry-run.{md,json}`. |
| 20:31 | Step 5 | done | Focused `db-repositories.test.ts`, `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, and `cd packages/server && npm run build && npx vitest run` passed under Node v22.22.3. |
| 20:34 | Step 6 | blocked | CLI Tester request and run passed; Book review receipt is `REQUESTED` / `safeToContinue=false`; `verify` exited non-zero with `reviewGateStatus=BLOCKED` and `nextChildBlocked=true`. Do not start `THE-46` until Book approval plus verify PASS, or explicit waiver. |

## Files Touched
- `docs/plans/2026-06-23-entity-phase-2-the-45-docs-artifacts-migration-permission-tests-plan.md` - created - compaction-safe plan for `THE-45`.
- `docs/plans/ACTIVE_PLAN.md` - modified - active resume plan for `THE-45`.
- `packages/db/src/index.ts` - modified - document/artifact migration dry-run report and preview permission envelope helpers.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - migration idempotence and preview leakage tests.
- `packages/server/vitest.config.ts` - modified - resolves DB source for Vitest so repository tests do not use stale built shims.
- `output/entity-phase-2/migrations/THE-45-document-artifact-dry-run.md` - created - migration dry-run sample.
- `output/entity-phase-2/migrations/THE-45-document-artifact-dry-run.json` - created - structured migration dry-run sample.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Continue from Step 6 after `output/entity-phase-2/book-review/THE-45.json` is `APPROVED` and `safeToContinue=true`; then re-run `project-test-gate verify THE-45`.
5. Use Node v22.22.x for proof/gate commands unless native dependencies are rebuilt for another Node.
6. Do not start `THE-46` until `THE-45` proof commands, CLI Tester run, Book review, and verify pass.

## Done
- [ ] `THE-45` implementation complete.
- [x] Focused tests pass.
- [x] Migration dry-run sample captured.
- [x] Required proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass with `nextChildBlocked=false`.
- [ ] Linear proof comment posted.
- [ ] Scoped commit created.
- [ ] Run-state advanced to `THE-46`.
