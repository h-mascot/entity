## Task
Implement `THE-42` / `THE-10.2`: document/artifact link services for NativeDocument, ExternalDocumentRef, and EvidenceArtifact.

**MC Task:** Entity Phase 2 approved queue
**Created:** 2026-06-23
**Agent:** Cursor
**Status:** IN_PROGRESS

## Context
`THE-41` is complete and verified locally: machine gate `PASS`, Book review `APPROVED`, `nextChildBlocked=false`, Linear state `Done`, and branch `THE-41-define-nativedocument-externaldocumentref-evidenceartifact-and-objectref-schema` pushed through commit `4317600`.

Live Linear confirms `THE-42` is source `THE-10.2`, parent `THE-10`, and a child issue with no children. Scope is service/API support to create, read, and link NativeDocuments, ExternalDocumentRefs, and EvidenceArtifacts while preserving ownership and mutability rules.

Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, `docs/context/entity-phase-2-build-context.md`, canonical PRD, SuperSpec, `.project-gate.json`, execution-pack plan.

## Dependencies
- [x] Required repo rules, context, canonical PRD, gate config, package scripts, run-state, and prior active plan read.
- [x] Live Linear `THE-41` rechecked as Done with approved Book review and PASS gate.
- [x] Live Linear `THE-42` read and confirmed as child `THE-10.2` under parent `THE-10`.
- [x] Live Linear parent `THE-10` read and confirms docs/files/artifacts object-model scope.
- [x] Current branch `THE-42-implement-documentartifact-link-services` created from `THE-41` HEAD `4317600`.

## Plan
- [x] Step 1: Preflight run-state, mapping, live Linear child and parent, and git base.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-42`, Linear `THE-10`, mapping table.
  - **Verify:** Source is `THE-10.2`, parent is `THE-10`, branch base includes verified `THE-41`.
- [x] Step 2: Inspect current document/artifact schema and route/service patterns.
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/**/*.ts`, existing document/artifact tests.
  - **Verify:** Identify smallest additive link-service/API slice without UI work.
- [x] Step 3: Implement only `THE-42` create/read/link service support.
  - **Files:** likely `packages/db/src/index.ts`, `packages/server/src/**`, colocated tests.
  - **Verify:** Native docs can be created/read/linked, external refs link without claiming ownership, evidence artifacts enforce raw/curated mutability semantics.
- [x] Step 4: Add/update focused API/service tests and request/response fixtures where useful.
  - **Files:** colocated `*.test.ts` files.
  - **Verify:** Success and explicit degraded/negative paths pass, including raw artifact mutation rejection or equivalent immutable-link protection.
- [x] Step 5: Run proof commands.
  - **Files:** command output receipts only.
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, `cd packages/server && npm run build && npx vitest run` pass.
- [ ] Step 6: Run CLI Tester four-step for `THE-42`. **Blocked on Book review.**
  - **Files:** `output/entity-phase-2/test-gate/THE-42.*`, `output/entity-phase-2/book-review/THE-42.*`.
  - **Verify:** request, run, book-review, and verify pass; verify reports `nextChildBlocked=false`.
- [ ] Step 7: Comment Linear, save-point commit, push, and advance run-state to `THE-43`.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-42`.
  - **Verify:** Linear proof comment includes branch, files changed, commands/exit codes, proof paths, gate receipt, Book review receipt; branch pushed.
- [ ] Step 8: Start `THE-43` only after `THE-42` verify allows continuation.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-43`, Linear `THE-10`.
  - **Verify:** first preflight for `THE-43` complete before code changes.

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 17:18 | Step 1 | done | `THE-41` receipts and Linear state allow continuation; live Linear confirms `THE-42` / `THE-10.2`; branch created from `4317600`. |
| 17:23 | Steps 2-4 | done | Added DB link methods, `document-objects` service/router, route registration, and API/request-response tests. Focused DB build plus route/repository tests passed: 45 tests. Server TypeScript build passed. |
| 17:25 | Step 5 | done | Required proof commands passed under Node v22.22.3: smoke, root build, and server build + full Vitest (59 files / 429 tests). GitNexus detect_changes reported low risk and no affected processes. |
| 17:27 | Step 6 | blocked | CLI Tester request and run passed. Book review is `REQUESTED`/`safeToContinue=false`; verify exited non-zero with `reviewGateStatus=BLOCKED` and `nextChildBlocked=true`. Do not start `THE-43`. |

## Files Touched
- `docs/plans/2026-06-23-entity-phase-2-the-42-document-artifact-link-services-plan.md` - created - compaction-safe plan for `THE-42`.
- `docs/plans/ACTIVE_PLAN.md` - modified - active resume plan for `THE-42`.
- `packages/db/src/index.ts` - modified - idempotent ObjectRef link methods for native documents, external refs, and editable evidence artifacts.
- `packages/server/src/document-objects.ts` - created - create/read/link API router for document objects and evidence artifacts.
- `packages/server/src/document-objects.test.ts` - created - request/response and degraded-path API tests.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - repository link method and immutable evidence negative-path tests.
- `packages/server/src/index.ts` - modified - mounts the document-object service API.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Find the first unchecked step above.
5. Use Node v22.22.x for proof/gate commands unless native dependencies are rebuilt for another Node.
6. Continue from `THE-42`; do not restart earlier issues.

## Done
- [ ] `THE-42` implementation complete.
- [x] Focused tests pass.
- [x] Required proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass with `nextChildBlocked=false` (blocked: Book review `REQUESTED`).
- [ ] Linear proof comment posted and issue status updated.
- [ ] Scoped save-point commit pushed.
- [ ] Run-state advanced to `THE-43`.
