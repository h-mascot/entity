## Task
Implement `THE-44` / `THE-10.4`: build docs/files/artifacts UI distinctions for Entity task/object panels.

**MC Task:** Entity Phase 2 approved queue
**Created:** 2026-06-23
**Agent:** Cursor
**Status:** COMPLETE_VERIFIED

## Context
Live Linear `THE-44` is a child issue under parent `THE-10`, source `THE-10.4`. Scope is UI-facing: show ExternalDocumentRef, NativeDocument, raw EvidenceArtifact/proof, and curated reports side by side without blurring ownership, canonicality, mutability, or degraded/restricted states. This follows completed `THE-41` schema, `THE-42` link services, and `THE-43` markdown storage/versioning seams.

Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, `docs/context/entity-phase-2-build-context.md`, canonical PRD, Oracle spec, `.project-gate.json`, execution-pack plan.

## Dependencies
- [x] Required repo rules, context, canonical PRD, Oracle spec, gate config, package scripts, issue map, and run-state read.
- [x] Live Linear `THE-44` read and confirmed as child `THE-10.4` under parent `THE-10`.
- [x] Live Linear parent `THE-10` read and confirms docs/files/artifacts object-model scope.
- [x] Prior issue `THE-43` local gate receipts checked: machine gate `PASS`, Book review `APPROVED`, `safeToContinue=true`, `nextChildBlocked=false`.
- [x] Current branch created: `THE-44-build-docs-files-artifacts-ui-distinctions`.

## Plan
- [x] Step 1: Inspect current docs/artifacts UI, task detail panels, document object API shapes, and available fixtures.
  - **Files:** `packages/app/src/**`, `packages/server/src/document-objects.ts`, `packages/server/src/document-objects.test.ts`
  - **Verify:** identify the smallest UI route/component changes that satisfy the live issue.
- [x] Step 2: Implement distinct UI labels and panels for external docs, native markdown, raw proof artifacts, and curated reports.
  - **Files:** likely `packages/app/src/**`
  - **Verify:** UI visibly distinguishes ownership/source, mutability, canonicality, and artifact kind.
- [x] Step 3: Show ObjectRef link roles and safe restricted/degraded placeholders.
  - **Files:** likely `packages/app/src/**`
  - **Verify:** task/object panel renders link role; restricted/degraded refs avoid snippet/content leakage.
- [x] Step 4: Add focused UI/data tests or fixtures where the repo supports them.
  - **Files:** colocated tests or deterministic fixtures
  - **Verify:** success path and restricted/degraded path are covered.
- [x] Step 5: Capture browser/DOM/screenshot proof for `THE-44`.
  - **Files:** `output/playwright/THE-44-*`
  - **Verify:** screenshot/DOM proof includes all object types, ObjectRef role, and restricted/degraded state.
- [x] Step 6: Run required proof commands and any focused tests.
  - **Files:** command receipts only
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, `cd packages/server && npm run build && npx vitest run` pass under Node 22.
- [x] Step 7: Run CLI Tester four-step for `THE-44`.
  - **Files:** `output/entity-phase-2/test-gate/THE-44.*`, `output/entity-phase-2/book-review/THE-44.*`
  - **Verify:** request, run, book-review, and verify pass; verify reports `nextChildBlocked=false`.
- [x] Step 8: Comment Linear, update run-state, commit, push if needed, and advance to `THE-45`.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-44`
  - **Verify:** Linear proof comment includes branch, files changed, commands/exit codes, proof paths, screenshot/DOM receipt, gate receipt, Book review receipt.

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 19:35 | Step 1 | done | Fresh branch created from verified `THE-43` HEAD; task panel and document object metadata paths inspected. |
| 19:34 | Steps 2-5 | done | Added task panel document-object cards for native markdown, external refs, raw proof, curated interpretation, ObjectRef roles, and restricted/degraded placeholders. Browser proof captured at `output/playwright/THE-44-docs-artifacts-ui-distinctions.png` and `output/playwright/THE-44-docs-artifacts-ui-distinctions-dom.md`. |
| 19:36 | Step 6 | done | `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, and `cd packages/server && npm run build && npx vitest run` passed under Node v22.22.3. GitNexus detect-changes run; shared UI component impact noted. |
| 19:40 | Steps 7-8 | blocked | CLI Tester request and run passed, but Book review returned `REQUESTED` / `safeToContinue=false`; `verify` exited 1 with `reviewGateStatus=BLOCKED`, `nextChildBlocked=true`. Linear proof/blocker comment posted: `9eac52a3-179a-4961-a074-097dabb80532`. Scoped implementation commit: `0b8ed7b`. Do not start `THE-45` until Book approval plus verify PASS, or explicit waiver. |
| 20:22 | Steps 7-8 | done | Book review receipt updated to `APPROVED` / `safeToContinue=true`; reran server proof and `project-test-gate verify THE-44` under Node v22.22.3. Verify PASS with no blockers. Run-state advanced to live `THE-45` (`THE-10.5`: migrate docs/artifacts and add permission tests). |

## Files Touched
- `docs/plans/2026-06-23-entity-phase-2-the-44-docs-artifacts-ui-distinctions-plan.md` - created - compaction-safe plan for `THE-44`.
- `docs/plans/ACTIVE_PLAN.md` - modified - active resume plan for `THE-44`.
- `packages/app/src/components/mission-control/TaskDetailPanel.tsx` - modified - task detail document/artifact distinction panel.
- `output/playwright/THE-44-docs-artifacts-ui-distinctions.png` - created - browser screenshot proof.
- `output/playwright/THE-44-docs-artifacts-ui-distinctions-dom.md` - created - DOM snapshot proof.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. `THE-44` is complete and verified. Continue with live Linear `THE-45` (`THE-10.5`: migrate existing docs/artifacts and add permission tests).
5. Use Node v22.22.x for proof/gate commands unless native dependencies are rebuilt for another Node.
6. Continue from `THE-44`; do not restart earlier issues.

## Done
- [x] `THE-44` implementation complete.
- [x] Focused tests/fixtures pass.
- [x] Screenshot/DOM proof captured.
- [x] Required proof commands pass.
- [x] CLI Tester request/run/book-review/verify pass with `nextChildBlocked=false`.
- [x] Linear proof/blocker comment posted.
- [x] Scoped save-point commit created.
- [x] Run-state advanced to `THE-45`.
