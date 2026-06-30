## Task

Audit Doc Hub interactive features, test what works locally, and fix document comment @agent replies with document context.

**MC Task:** N/A
**Created:** 2026-06-30
**Agent:** GPT-5.5
**Status:** IN PROGRESS

## Context

User wants an exhaustive audit of Doc Hub capabilities beyond viewing documents, especially the workflow: open/edit a markdown document, select text, comment, tag an agent, and have the agent respond with the right context. Initial code audit found document comments are persisted and anchored, but @mentions in document comments are not routed to any agent responder.

## Dependencies

- [x] Step 1 has no dependencies
- [x] Step 2 depends on identifying existing UI/API flows
- [x] Step 3 depends on backend doc-comment and task-comment responder context
- [x] Step 4 depends on implementation changes
- [ ] Step 5 depends on automated tests passing
- [ ] Step 6 depends on a local server with built app assets

## Plan

- [x] Step 1: Inventory Doc Hub interactive features and identify broken paths
  - **Files:** read-only audit of `packages/app/src/**`, `packages/server/src/**`, `packages/db/src/**`
  - **Verify:** `rg -i "documents|comments|mention|MarkdownPreview|CodeMirrorEditor" packages`
- [x] Step 2: Establish test strategy and fixtures for document comment agent replies
  - **Files:** `packages/server/src/editor/**`, `packages/server/src/agent/**`
  - **Verify:** Identify existing Vitest setup and injectable dependencies
- [x] Step 3: Implement document-comment @mention responder with selected-text and document context
  - **Files:** `packages/server/src/editor/service.ts`, `packages/server/src/editor/routes.ts`, `packages/server/src/agent/comment-responder.ts`, related tests
  - **Verify:** New/updated Vitest tests cover success and degraded no-model paths
- [x] Step 4: Build and run automated gates
  - **Files:** server/app build output only
  - **Verify:** `cd packages/server && npm run build && npx vitest run`; `npm run build`
- [ ] Step 5: Manually verify Doc Hub workflows in browser
  - **Files:** none
  - **Verify:** Browser proof for open/edit markdown, selected-text comment, agent reply, and a degraded/no-model response
- [ ] Step 6: Commit, push, and create/update PR
  - **Files:** all modified files
  - **Verify:** `git status --short`; `git push -u origin cursor/doc-comment-agent-replies-c07b`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 22:15 | Step 1 | ⏳ | Parallel code audit started; major doc-comment @mention gap found |
| 22:22 | Step 1-3 | ✅ | Added document-comment responder and editor service hook |
| 22:23 | Step 4 | ✅ | `cd packages/server && npm run build && npx vitest run` passed |
| 22:27 | Step 4 | ✅ | Fixed malformed editor bearer auth regex; full server gate and workspace build pass |
| 22:52 | Step 5 | ⏳ | Browser found comment sidebar hidden; made collaboration sidebar visible and auto-expanded when panels load |

## Files Touched

- `docs/plans/2026-06-30-doc-comment-agent-replies-plan.md` — created — compaction-safe plan
- `docs/plans/ACTIVE_PLAN.md` — created/updated — active execution plan
- `packages/server/src/agent/document-comment-responder.ts` — created — document comment @mention reply path
- `packages/server/src/agent/document-comment-responder.test.ts` — created — responder unit tests
- `packages/server/src/editor/service.ts` — modified — invokes document mention responder from comments/replies
- `packages/server/src/editor/service.test.ts` — created — service hook tests
- `packages/server/src/editor/auth.ts` — modified — fixes Documents API bearer token parsing
- `packages/server/src/editor/auth.test.ts` — created — route-level service token auth tests
- `packages/server/src/editor/index.ts` — modified — accepts agent registry dependency
- `packages/server/src/index.ts` — modified — passes agent registry into editor module
- `packages/app/src/App.tsx` — modified — makes document collaboration sidebar visible and auto-expands when threads load

## Resume Instructions

1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections
5. Continue from there — do NOT redo completed steps

## Done

- [ ] All steps complete
- [ ] Tests pass (if applicable)
- [ ] PR created or updated
- [ ] ACTIVE_PLAN.md cleared or updated for next task
