## Task

Audit Doc Hub interactive document features, fix the document-comment agent response gap, and verify the key workflows in Cursor Cloud.

**MC Task:** ad hoc user request
**Created:** 2026-06-30
**Agent:** GPT-5.5
**Status:** IN PROGRESS

## Context

The user wants to understand what already exists in Doc Hub beyond document viewing, then make the most important workflow work: select text in a document, comment with an agent mention, and have the agent respond with the right document context. Repo guidance requires browser verification for user-facing document work and server build/Vitest proof for server changes.

Relevant Phase 2 docs and Linear context read:
- `AGENTS.md`
- `docs/context/entity-phase-2-build-context.md`
- `docs/specs/entity-phase-2-prd-canonical-20260620.md`
- Linear `THE-10` parent docs/files/artifacts epic
- Linear `THE-43` native markdown storage/versioning child issue

## Dependencies

- [x] Branch exists: `cursor/doc-hub-agent-comments-8a39`
- [x] Existing Doc Hub UI/API/storage audit completed with read-only exploration.
- [ ] Server implementation depends on current editor routes/service and task comment responder patterns.
- [ ] Browser proof depends on `npm run setup -- --defaults --skip-clickclack`, `npm run build`, and server on port 3000.

## Plan

- [x] Step 1: Inventory existing Doc Hub interactive features and gaps.
  - **Files:** app/server/db doc and comment code, Linear context
  - **Verify:** read-only explore agent summaries and direct source reads
- [x] Step 2: Add document-comment agent responder with document id, selected text, anchor range, thread, and source excerpt context.
  - **Files:** `packages/server/src/agent/document-comment-responder.ts`, `packages/server/src/editor/service.ts`, `packages/server/src/editor/routes.ts`
  - **Verify:** focused Vitest for document comment mention prompt/reply/degraded paths
- [x] Step 3: Add tests for document collaboration comments and agent mention behavior.
  - **Files:** `packages/server/src/agent/document-comment-responder.test.ts`, optional editor service/route tests
  - **Verify:** `cd packages/server && npx vitest run src/agent/document-comment-responder.test.ts`
- [x] Step 4: Run required server proof and full affected builds.
  - **Files:** none
  - **Verify:** `cd packages/server && npm run build && npx vitest run`; `npm run build`
- [ ] Step 5: Manually verify Doc Hub in browser, including success and degraded paths.
  - **Files:** `/opt/cursor/artifacts/*`
  - **Verify:** browser demo video showing selected-text comment with `@assistant` reply and document context
- [ ] Step 6: Commit, push, open/update PR, and summarize audit findings plus proof.
  - **Files:** git/PR metadata
  - **Verify:** `git status --short --branch`, pushed branch, PR created/updated

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 22:15Z | Setup | COMPLETE | Branch created from `main`; async install absent. |
| 22:25Z | Step 1 | COMPLETE | Found file preview/edit/save, comments/suggestions/reviews, docs read route, and the missing document-comment agent responder. |
| 22:35Z | Steps 2-3 | COMPLETE | Added document-comment responder, editor route wiring, and focused responder tests; focused Vitest passed. |
| 22:45Z | Step 4 | COMPLETE | Server build + 76 Vitest files / 561 tests passed; root build passed with Vite chunk-size warning only. |

## Files Touched

- `docs/plans/2026-06-30-doc-hub-agent-comments-plan.md` - created - compaction-survivable plan for this audit/fix/test workflow.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution pointer for this workflow.
- `packages/server/src/agent/document-comment-responder.ts` - created - responds to document comment @mentions with selected text, thread, and excerpt context.
- `packages/server/src/agent/document-comment-responder.test.ts` - created - focused coverage for document comment mention behavior.
- `packages/server/src/editor/service.ts` - modified - exposes document comment context and created/replied thread ids.
- `packages/server/src/editor/routes.ts` - modified - fires document comment mention responder after comment/reply creation.
- `packages/server/src/editor/index.ts` - modified - wires the document responder into the editor module.
- `packages/server/src/index.ts` - modified - passes the agent registry into the editor module.

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Continue from the first unchecked step.
4. Do not redo completed exploration unless later code changes invalidate an audit finding.
5. For UI proof, leave the dev server running when finished.

## Done

- [ ] All steps complete
- [x] Server tests pass
- [x] Root build passes
- [ ] Browser proof video saved
- [ ] Changes committed, pushed, and PR created/updated
