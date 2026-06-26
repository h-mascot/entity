## Task

**MC Task:** THE-85  
**Created:** 2026-06-24T10:50:00Z  
**Agent:** gpt-5.5  
**Status:** IN PROGRESS

## Context

Implement THE-18.5 from the Google Docs/Drive V1 read-only parent. THE-85 is docs-only plus a tiny no-mutation proof test: document the V1 read-only posture, explicitly defer writes/export/sync behind later permission gates and audit trails, and prove the public Google metadata module does not expose mutation defaults.

Branch: `THE-85-document-connector-posture-and-future-write-gates`  
Linear: `THE-85` / parent `THE-18`

## Dependencies

- [x] Run-state pointer is `THE-85`.
- [x] Live Linear child and parent bodies were read.
- [x] Branch `THE-85-document-connector-posture-and-future-write-gates` was created from `acec704`.
- [x] Prior Google connector slices THE-81, THE-82, THE-83, and THE-84 are complete.
- [x] Proof and Linear updates depend on focused and full tests passing.

## Plan

- [x] Step 1: Add Google V1 posture documentation.
  - **Files:** `docs/context/entity-phase-2-google-connector-posture-and-future-write-gates.md`
  - **Verify:** `rg "not canonical low-level proof|writes/export/sync|minimal scopes|no mutation proof" docs/context/entity-phase-2-google-connector-posture-and-future-write-gates.md`
- [x] Step 2: Link the posture doc from the THE-18 parent entry point.
  - **Files:** `docs/specs/entity-phase-2-prd-canonical-20260620.md`
  - **Verify:** `rg "google-connector-posture-and-future-write-gates" docs/specs/entity-phase-2-prd-canonical-20260620.md`
- [x] Step 3: Add no-mutation proof test for the public Google metadata module.
  - **Files:** `packages/server/src/google-docs-metadata.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/google-docs-metadata.test.ts`
- [ ] Step 4: Run gates/proof, commit scoped files, update Linear, and advance run-state to THE-86.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, `output/entity-phase-2/test-gate/THE-85.proof.txt`, `output/entity-phase-2/book-review/THE-85.json`
  - **Verify:** `/Users/enterprise/Code/cli-tester/bin/project-test-gate --root /Users/enterprise/Code/entity --config /Users/enterprise/Code/entity/.project-gate.json \`request THE-85\``, `/Users/enterprise/Code/cli-tester/bin/project-test-gate --root /Users/enterprise/Code/entity --config /Users/enterprise/Code/entity/.project-gate.json \`run THE-85\``, `/Users/enterprise/Code/cli-tester/bin/project-test-gate --root /Users/enterprise/Code/entity --config /Users/enterprise/Code/entity/.project-gate.json \`book-review THE-85\``, `/Users/enterprise/Code/cli-tester/bin/project-test-gate --root /Users/enterprise/Code/entity --config /Users/enterprise/Code/entity/.project-gate.json \`verify THE-85\``, `cd packages/server && npm run build && npx vitest run`, `npm run build`, `bash scripts/proof/entity-phase-2-smoke.sh`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 10:50 | Setup | DONE | Run-state confirmed THE-85; Linear child/parent read; branch created from `acec704`. |
| 10:52 | Steps 1-3 | DONE | Posture doc added, canonical PRD linked, and `src/google-docs-metadata.test.ts` passed with 3 tests. |
| 10:57 | Proof | DONE | CLI Tester request/run/book-review/verify PASS after switching to Node 22; full proof commands saved to `output/entity-phase-2/test-gate/THE-85.proof.txt`. |

## Files Touched

- `docs/plans/2026-06-24T105000Z-entity-phase-2-the-85-document-connector-posture-and-future-write-gates-plan.md` - created - compaction-survivable THE-85 plan.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution pointer for THE-85.
- `docs/context/entity-phase-2-google-connector-posture-and-future-write-gates.md` - planned - connector posture docs.
- `docs/specs/entity-phase-2-prd-canonical-20260620.md` - planned - parent THE-18 entry-point link.
- `packages/server/src/google-docs-metadata.test.ts` - planned - no-mutation public module proof.
- `.cursor/run-state/entity-phase-2.json` - planned - local pointer advanced after Linear closeout, not committed.

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Confirm branch is `THE-85-document-connector-posture-and-future-write-gates` and run-state still has `currentIssue=THE-85` unless Step 4 is complete.
4. Find the first unchecked step above and continue there.
5. Preserve Google Docs/Drive V1 read/link/index/preview-only posture; do not add mutation routes or controls.

## Done

- [ ] All steps complete.
- [x] Focused no-mutation test passes.
- [x] Full proof commands pass.
- [x] CLI Tester request/run/book-review/verify receipts captured.
- [ ] THE-85 committed locally.
- [ ] Linear THE-85 proof comment posted and issue moved to Done.
- [ ] Run-state advanced to THE-86.
