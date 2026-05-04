# Task Plan — Share Link and Audio UX

## Task
Fix share-link UX in the app, add visible TTS controls for docs-compatible markdown previews, make docs route roots cross-platform, add low-cost tests, verify locally, and push the branch.

**MC Task:** #___  
**Created:** 2026-04-02  
**Agent:** Codex  
**Status:** IN PROGRESS

## Context
- Work must stay on branch `fix/entity-share-audio-ux-20260402`.
- There are unrelated modified files already in the worktree; avoid touching them.
- Server edits require colocated tests when there is an obvious low-cost fit, then `cd packages/server && npx vitest run`.
- Need a durable doc/file share URL, lightweight in-app TTS controls for docs-compatible markdown, and cross-platform docs root handling without weakening traversal protections.

## Dependencies
- [x] Step 1 has no dependencies
- [x] Step 2 depends on Step 1 output (current code paths and existing route conventions understood)
- [x] Step 3 depends on Step 2 output (app UX changes implemented)
- [x] Step 4 depends on Step 2 output (server root/path handling updated and tested)
- [ ] Step 5 depends on Steps 3 and 4 output (verification, commit, push, and notify)

## Plan

- [x] Step 1: Create plan, confirm branch/worktree state, and audit relevant app/server code paths
  - **Files:** `docs/plans/2026-04-02-share-audio-ux-plan.md`, `docs/plans/ACTIVE_PLAN.md`, `packages/app/src/App.tsx`, `packages/app/src/components/**/*`, `packages/server/src/routes/docs.ts`
  - **Verify:** `git branch --show-current && git status --short && rg -n "MarkdownPreview|clipboard|share|tts|/docs/|ALLOWED_ROOTS" packages/app/src packages/server/src -S`
- [x] Step 2: Design durable doc URL mapping and docs-compatible TTS gating from existing app conventions
  - **Files:** `packages/app/src/App.tsx`, relevant markdown preview helpers/components
  - **Verify:** `rg -n "/docs/|MarkdownPreview|FilePreview|preview" packages/app/src -S`
- [x] Step 3: Implement app-side share fallback UX and visible markdown/audio controls with loading and error states
  - **Files:** `packages/app/src/App.tsx`, `packages/app/src/components/**/*`, supporting helpers/tests as needed
  - **Verify:** `npm --prefix packages/app run build`
- [x] Step 4: Make docs route roots cross-platform and add/update server tests without weakening traversal protection
  - **Files:** `packages/server/src/routes/docs.ts`, colocated test files as needed
  - **Verify:** `cd packages/server && npx vitest run src/__tests__/routes-docs.test.ts`
- [ ] Step 5: Run final verification, commit, push, update plan, and send completion event
  - **Files:** `docs/plans/2026-04-02-share-audio-ux-plan.md`, `docs/plans/ACTIVE_PLAN.md`
  - **Verify:** `cd packages/server && npm run build && npx vitest run && npm --prefix packages/app run build`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 16:32 | Step 1 | ⏳ | Plan created, branch confirmed, starting code audit |
| 16:41 | Step 1 | ✅ | Audited share button, markdown preview reuse points, and docs/TTS server split |
| 16:48 | Step 3 | ✅ | App build passed after share-link mapping, clipboard fallback, and markdown audio controls |
| 16:49 | Step 4 | ✅ | Server build passed; targeted docs-route Vitest passed; full suite still fails in unrelated environment/pre-existing areas |
| 16:51 | Step 5 | ⏸️ | Git commit/push blocked by sandbox: `.git/index.lock` and `.git/*` writes return `Operation not permitted` |

## Files Touched
- `docs/plans/2026-04-02-share-audio-ux-plan.md` — created — execution plan for share/audio UX task
- `docs/plans/ACTIVE_PLAN.md` — modified — active execution pointer for compaction recovery
- `packages/app/src/App.tsx` — modified — durable share URLs, clipboard fallbacks, docs-path mapping, and markdown preview action shell
- `packages/app/src/components/MarkdownAudioControls.tsx` — created — lightweight TTS trigger and inline audio playback for docs-compatible markdown
- `packages/app/src/components/MarkdownPreview.tsx` — modified — expanded docs-link recognition for projects/workspace/docs-style paths
- `packages/server/src/routes/docs.ts` — modified — cross-platform docs roots, shared API handlers, markdown validation, and traversal-safe resolution
- `packages/server/src/index.ts` — modified — live server now registers the shared docs API routes, including TTS
- `packages/server/src/__tests__/routes-docs.test.ts` — modified — root resolution, traversal, markdown extension, and content-route coverage

## Resume Instructions
1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections
5. Continue from there — do NOT redo completed steps

## Done
- [ ] All steps complete
- [ ] Tests pass (if applicable) — app build, server build, and targeted docs-route tests pass; full server suite is blocked by unrelated ABI/socket/timeouts
- [ ] Branch committed and pushed — blocked by sandbox `.git` write restrictions
- [ ] ACTIVE_PLAN.md cleared or updated for next task
