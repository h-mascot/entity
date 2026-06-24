## Task
Entity Phase 2 THE-65: harden restricted snippet suppression and search UI.

**MC Task:** THE-65
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** VERIFIED - LINEAR HANDOFF PENDING

## Context
Live Linear issue THE-65 is child issue THE-14.5 under THE-14 permissions, sensitivity, and search envelope. Scope is proving and hardening that permission filtering happens before snippets/previews render, including indexed restricted content after permission changes, and that search UI explains restricted results without leaking content.

## Dependencies
- [x] Current run-state points to THE-65.
- [x] THE-64 completed, verified, committed, and Linear Done.
- [x] Branch created from THE-64 completion commit: `THE-65-harden-restricted-snippet-suppression-and-search-ui`.
- [x] Existing search API, file-source API, search UI, and permission envelope behavior inspected before implementation.

## Plan

- [x] Step 1: Inspect search API/UI consumers and existing restricted-placeholder rendering.
  - **Files:** `packages/server/src/routes/search.ts`, `packages/server/src/fs/routes-search.ts`, `packages/app/src/**`
  - **Verify:** identify exact API fields rendered as snippets/previews
- [x] Step 2: Harden API responses so restricted indexed/fallback snippets and previews cannot leak after permission or connector state changes.
  - **Files:** server search routes/tests as needed
  - **Verify:** leakage attempt tests cover restricted content and permission-change suppression
- [x] Step 3: Update search UI to render explicit restricted-access placeholders without snippet/preview content.
  - **Files:** app search components/tests as needed
  - **Verify:** DOM/browser proof shows restricted explanation and no leaked content
- [x] Step 4: Run required proof commands, browser/DOM proof, GitNexus detect-changes, and CLI Tester request/run/book-review/verify.
  - **Files:** `output/entity-phase-2/test-gate/THE-65.*`, `output/entity-phase-2/book-review/THE-65*`
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`; `npm run build`; `cd packages/server && npm run build && npx vitest run`; UI proof attached
- [ ] Step 5: Comment Linear, mark THE-65 Done, update run-state to THE-66, and commit scoped changes.
  - **Files:** `.cursor/run-state/entity-phase-2.json` local state only, source/test/plan for commit as appropriate
  - **Verify:** `git status --short`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 03:40Z | Setup | done | Read live child issue; branch created after THE-64 completion. |
| 03:45Z | Implementation | done | Added file-index permission metadata, propagated adapter metadata, suppressed restricted indexed/fallback previews, and rendered non-clickable restricted UI placeholders. |
| 03:51Z | Proof | done | Focused tests, smoke, root build, server build, full server Vitest, DOM source proof, GitNexus detect-changes, and CLI Tester request/run/book-review/verify passed; Book packet-mode locally approved under hard rule 22 with clean scans. |

## Files Touched
- `docs/plans/2026-06-24-044000-entity-phase-2-the-65-restricted-snippet-search-ui-plan.md` - created - THE-65 execution plan.
- `docs/plans/ACTIVE_PLAN.md` - mirrored - active THE-65 plan.
- `packages/db/src/file-index.ts` - updated - optional indexed permission metadata.
- `packages/server/src/fs/adapters/types.ts` - updated - optional source permission metadata.
- `packages/server/src/fs/index-runner.ts` - updated - propagate source permission metadata into file index records.
- `packages/server/src/fs/routes-search.ts` - updated - permission-safe restricted indexed/fallback search results.
- `packages/server/src/fs/routes-search.test.ts` - updated - leakage tests for source policy, indexed metadata, and fallback metadata.
- `packages/app/src/types/filesystem.ts` - updated - search permission metadata types.
- `packages/app/src/components/UnifiedFileDashboard.tsx` - updated - restricted placeholder rendering.
- `packages/app/src/components/QuickSwitcher.tsx` - updated - restricted quick switcher placeholders.
- `packages/app/src/components/SourceFileTree.tsx` - updated - restricted source-tree search placeholders.
- `output/entity-phase-2/browser-proof/THE-65-dom-proof.json` - created - DOM source proof receipt, not staged.
- `output/entity-phase-2/audits/THE-65-private-scan-audit.md` - created - local packet-mode approval audit, not staged.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from the first unchecked step; do not redo completed work.
5. Keep THE-65 scoped to restricted search snippet/preview suppression and UI placeholder proof.

## Done
- [ ] All steps complete
- [x] Tests/build pass
- [x] CLI Tester request/run/book-review/verify complete
- [ ] Linear THE-65 proof comment added and status moved to Done
- [ ] Run-state advanced to THE-66
