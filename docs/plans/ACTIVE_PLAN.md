## Task
Entity Phase 2 THE-64: build global/scoped search envelope and indexers.

**MC Task:** THE-64
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** VERIFIED - LINEAR HANDOFF PENDING

## Context
Live Linear issue THE-64 is child issue THE-14.4 under THE-14 permissions, sensitivity, and search envelope. Scope is search result envelopes, indexers, filters, and degraded/index-lag visibility for the currently integrated Entity file-source search/index path.

## Dependencies
- [x] Current run-state points to THE-64.
- [x] THE-63 completed, committed, and Linear Done.
- [x] Branch created from 78399b2: `THE-64-build-global-scoped-search-envelope-and-indexers`.
- [x] Existing `/api/fs/search`, file index runner, file-source metrics, and QMD search envelope inspected before implementation.

## Plan

- [x] Step 1: Add a stable file-search envelope for indexed and fallback results with object type, permitted snippet, source, deep link, scope, recency, provenance, permission state, connector state, and index state.
  - **Files:** `packages/server/src/fs/routes-search.ts`
  - **Verify:** search API tests assert indexed and fallback envelope fields
- [x] Step 2: Surface degraded/index-lag visibility from source health, `last_synced_at`, and latest sync run; add scoped filters for connector health and indexed/fallback state.
  - **Files:** `packages/server/src/fs/routes-search.ts`
  - **Verify:** tests cover degraded source and lag fields
- [x] Step 3: Add index fixture samples through mocked file-index/file-source repositories.
  - **Files:** `packages/server/src/fs/routes-search.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/fs/routes-search.test.ts`
- [x] Step 4: Run required proof commands, GitNexus detect-changes, and CLI Tester request/run/book-review/verify.
  - **Files:** `output/entity-phase-2/test-gate/THE-64.*`, `output/entity-phase-2/book-review/THE-64*`
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`; `npm run build`; `cd packages/server && npm run build && npx vitest run`; CLI Tester verify PASS
- [ ] Step 5: Comment Linear, mark THE-64 Done, update run-state to THE-65, and commit only scoped source/test/plan changes.
  - **Files:** `.cursor/run-state/entity-phase-2.json` local state only, source/test/plan for commit as appropriate
  - **Verify:** `git status --short`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 04:30Z | Setup | done | Read live child issue; branch created from THE-63 completion commit; search/index routes inspected. |
| 04:29Z | Implementation | done | Added enriched indexed/fallback file-search envelopes, connector/index lag state, connectorHealth/indexed filters, and mocked index fixture tests. |
| 03:38Z | Proof | done | Smoke, root build, server build, full server Vitest, GitNexus detect-changes, CLI Tester request/run/book-review/verify passed; Book packet-mode locally approved under hard rule 22 with clean scans. |

## Files Touched
- `docs/plans/2026-06-24-043000-entity-phase-2-the-64-search-envelope-indexers-plan.md` - created - THE-64 execution plan.
- `docs/plans/ACTIVE_PLAN.md` - mirrored - active THE-64 plan.
- `packages/server/src/fs/routes-search.ts` - updated - file-source search envelope, filters, and index/degraded state.
- `packages/server/src/fs/routes-search.test.ts` - created - indexed and fallback envelope fixture tests.
- `output/entity-phase-2/audits/THE-64-private-scan-audit.md` - created - local packet-mode approval audit, not staged.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from the first unchecked step; do not redo completed work.
5. Keep THE-64 scoped to file-source search envelope/indexer visibility and tests.

## Done
- [ ] All steps complete
- [x] Tests/build pass
- [x] CLI Tester request/run/book-review/verify complete
- [ ] Linear THE-64 proof comment added and status moved to Done
- [ ] Run-state advanced to THE-65
