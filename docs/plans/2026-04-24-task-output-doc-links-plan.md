# Task Plan — Task Output Doc Links Validation

## Task
Validate and, if needed, fix task output links so Entity/file/doc URLs render as usable docs links in task UI.

**MC Task:** #___
**Created:** 2026-04-24
**Agent:** Codex
**Status:** COMPLETE

## Context
- The user asked to check the task code handling Entity URLs/docs links, cover all scenarios, and test via UI.
- Existing local changes already touch `TaskDetailPanel.tsx` and `task-output-links.test.ts`; preserve and build on them.
- Server source/test changes require Vitest before reporting done.
- Existing unrelated dirty files must not be reverted.

## Dependencies
- [x] Step 1 has no dependencies
- [x] Step 2 depends on Step 1 identifying the exact normalization/rendering paths
- [x] Step 3 depends on Step 2 finding missing or weak scenarios
- [x] Step 4 depends on implementation/tests passing

## Plan

- [x] Step 1: Trace task output URL normalization in server and UI
  - **Files:** `packages/server/src/task-output-links.ts`, `packages/server/src/index.ts`, `packages/app/src/components/mission-control/TaskDetailPanel.tsx`
  - **Verify:** `rg -n "normalizeTaskOutputLinks|renderLinkedText|normalizeTaskOutputHref|TASK_OUTPUT_LINK_PATTERN" packages/server/src packages/app/src`
- [x] Step 2: Add focused coverage for Entity/docs URL scenarios
  - **Files:** `packages/server/src/__tests__/task-output-links.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/__tests__/task-output-links.test.ts`
- [x] Step 3: Patch normalization/rendering if coverage exposes gaps
  - **Files:** `packages/server/src/task-output-links.ts`, `packages/app/src/components/mission-control/TaskDetailPanel.tsx`
  - **Verify:** `cd packages/server && npx vitest run src/__tests__/task-output-links.test.ts`
- [x] Step 4: Run UI verification for task detail output links
  - **Files:** app/server runtime
  - **Verify:** browser/dev-server smoke with task detail output link scenarios

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 03:43 | Step 1 | ✅ | Found server task-output normalizer and task detail link renderer; server normalizer was not wired into task create/update |
| 04:25 | Step 2 | ✅ | Added coverage for legacy 3000/8788 URLs, all docs roots, already-normalized docs links, macOS/Linux local paths, home-relative paths, and relative docs paths |
| 04:26 | Step 3 | ✅ | Wired server normalization into create/update; fixed server roots; fixed UI handling for home-relative paths, punctuation, and already-normalized absolute docs URLs |
| 04:31 | Step 4 | ✅ | Verified task detail UI with Puppeteer against local app/server; created and deleted temporary task #491 |
| 04:31 | Gate | ⚠️ | Targeted task-output test and app build pass; full server Vitest still has existing swarm route failures |
| 04:35 | Gate | ✅ | `PATH=/opt/homebrew/bin:$PATH npm run ctrl:full` passed after aligning the swarm provider dispatch type contract |

## Files Touched
- `docs/plans/2026-04-24-task-output-doc-links-plan.md` — created — durable plan for this validation
- `docs/plans/ACTIVE_PLAN.md` — modified — active execution pointer
- `packages/server/src/task-output-links.ts` — modified — expanded docs-root normalization
- `packages/server/src/index.ts` — modified — task create/update output normalization
- `packages/server/src/__tests__/task-output-links.test.ts` — modified — scenario coverage
- `packages/app/src/components/mission-control/TaskDetailPanel.tsx` — modified — UI docs link rendering fixes
- `packages/server/src/swarm/providers/interface.ts` — modified — declares provider-returned job status used by dispatcher and Symphony provider

## Resume Instructions
1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections
5. Continue from there — do NOT redo completed steps

## Done
- [x] All steps complete
- [x] Targeted tests pass
- [x] UI/browser verification complete
- [x] `ctrl:full` passes
