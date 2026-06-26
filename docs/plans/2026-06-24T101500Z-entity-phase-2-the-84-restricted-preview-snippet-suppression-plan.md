## Task

**MC Task:** THE-84  
**Created:** 2026-06-24T10:15:00Z  
**Agent:** gpt-5.5  
**Status:** IN PROGRESS

## Context

Implement THE-18.4 from the Google Docs/Drive V1 read-only parent. Google external connector access does not grant Entity visibility: Entity permission checks must run before external snippets/previews are returned by APIs, search/index output, or task-detail rendering. Users without Entity access see restricted/degraded placeholders, and revoked/deleted external docs must not remove Entity-native proof.

Branch: `THE-84-enforce-restricted-preview-snippet-suppression`  
Linear: `THE-84` / parent `THE-18`

## Dependencies

- [x] Run-state pointer is `THE-84`.
- [x] Live Linear child and parent bodies were read.
- [x] Branch `THE-84-enforce-restricted-preview-snippet-suppression` was created from `333c111`.
- [x] API work depends on current `document-objects` permission envelopes and THE-82 metadata helpers.
- [x] UI work depends on THE-83 external preview view-model.
- [ ] Proof and Linear updates depend on focused and full tests passing.

## Plan

- [x] Step 1: Harden external document API output so restricted users never receive snippets/previews/open URLs.
  - **Files:** `packages/server/src/document-objects.ts`, `packages/server/src/document-objects.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/document-objects.test.ts`
- [x] Step 2: Harden task-detail external preview rendering for restricted/revoked/deleted payloads.
  - **Files:** `packages/app/src/components/mission-control/utils/externalDocumentPreview.ts`, `packages/app/src/components/mission-control/utils/__tests__/externalDocumentPreview.test.ts`, `packages/app/src/components/mission-control/TaskDetailPanel.tsx`
  - **Verify:** `node --test packages/app/src/components/mission-control/utils/__tests__/externalDocumentPreview.test.ts`
- [x] Step 3: Run focused server/app checks and update this plan with results.
  - **Files:** `docs/plans/2026-06-24T101500Z-entity-phase-2-the-84-restricted-preview-snippet-suppression-plan.md`, `docs/plans/ACTIVE_PLAN.md`
  - **Verify:** `cd packages/server && npx vitest run src/document-objects.test.ts`; `node --test packages/app/src/components/mission-control/utils/__tests__/externalDocumentPreview.test.ts`
- [ ] Step 4: Run gates/proof, commit scoped files, update Linear, and advance run-state to THE-85.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, `output/entity-phase-2/test-gate/THE-84.proof.txt`, `output/entity-phase-2/book-review/THE-84.json`
  - **Verify:** `/Users/enterprise/Code/cli-tester/bin/project-test-gate \`request THE-84\``, `/Users/enterprise/Code/cli-tester/bin/project-test-gate \`run THE-84\``, `/Users/enterprise/Code/cli-tester/bin/project-test-gate \`book-review THE-84\``, `/Users/enterprise/Code/cli-tester/bin/project-test-gate \`verify THE-84\``, `cd packages/server && npm run build && npx vitest run`, `npm run build`, `bash scripts/proof/entity-phase-2-smoke.sh`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 10:15 | Setup | DONE | Run-state confirmed THE-84; Linear child/parent read; branch created from `333c111`. |
| 10:18 | Steps 1-3 | DONE | External routes now use search/preview permission before metadata/open output; UI view-model suppresses restricted/revoked/deleted previews; focused tests passed. |
| 10:25 | Proof | DONE | CLI Tester request/run/book-review/verify PASS after Node 22 rebuild; full proof commands saved to `output/entity-phase-2/test-gate/THE-84.proof.txt`; THE-84 DOM proof passed. |

## Files Touched

- `docs/plans/2026-06-24T101500Z-entity-phase-2-the-84-restricted-preview-snippet-suppression-plan.md` - created - compaction-survivable THE-84 plan.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution pointer for THE-84.
- `packages/server/src/document-objects.ts` - modified - restricted external preview/open suppression.
- `packages/server/src/google-docs-metadata.ts` - modified - revoked/deleted/unauthorized refs cannot open external URLs.
- `packages/server/src/document-objects.test.ts` - modified - restricted snippet and revoked/deleted fixture coverage.
- `packages/app/src/components/mission-control/utils/externalDocumentPreview.ts` - modified - restricted/revoked/deleted preview view-model.
- `packages/app/src/components/mission-control/utils/__tests__/externalDocumentPreview.test.ts` - modified - focused preview suppression tests.
- `packages/app/src/components/mission-control/TaskDetailPanel.tsx` - modified - treats preview-denied external refs as restricted placeholders.
- `.cursor/run-state/entity-phase-2.json` - planned - local pointer advanced after Linear closeout, not committed.

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Confirm branch is `THE-84-enforce-restricted-preview-snippet-suppression` and run-state still has `currentIssue=THE-84` unless Step 4 is complete.
4. Find the first unchecked step above and continue there.
5. Preserve Google Docs/Drive V1 read/link/index/preview-only posture; do not add mutation routes or controls.

## Done

- [ ] All steps complete.
- [x] Focused tests pass.
- [x] Full proof commands pass.
- [x] CLI Tester request/run/book-review/verify receipts captured.
- [ ] THE-84 committed locally.
- [ ] Linear THE-84 proof comment posted and issue moved to Done.
- [ ] Run-state advanced to THE-85.
