# Entity Docs Listen And Task Detail Functionality Plan

## Task
Fix the selected docs/detail UI so document links open in the docs workbench, Listen is functional and configurable, and task-detail controls are wired rather than inert.

**MC Task:** N/A  
**Created:** 2026-04-25  
**Agent:** Codex  
**Status:** IN PROGRESS

## Context
- User wants the current docs workbench visual direction preserved.
- Clicking output/document links must open the docs workbench and successfully load the document.
- Listen needs configurable providers: browser TTS, Kokoro/local, and OpenAI TTS.
- Task detail rail/tabs/comments should perform real navigation/actions, not decorative UI only.
- Server changes require colocated/targeted tests and `cd packages/server && npx vitest run` before reporting complete.

## Dependencies
- [x] Step 1 has no dependencies.
- [ ] Step 2 depends on tracing current docs route and server docs root resolution.
- [ ] Step 3 depends on Step 2.
- [ ] Step 4 depends on tracing task-detail state/actions.
- [ ] Step 5 depends on all implementation changes.

## Plan

- [x] Step 1: Trace the existing docs route, listen button, and task detail behavior.
  - **Files:** `packages/app/src/App.tsx`, `packages/app/src/components/mission-control/TaskDetailPanel.tsx`, `packages/server/src/routes/docs.ts`
  - **Verify:** `rg` and targeted source reads
- [x] Step 2: Fix docs route resolution and output-doc link loading without changing the selected docs visual direction.
  - **Files:** `packages/server/src/routes/docs.ts`, `packages/app/src/App.tsx`
  - **Verify:** visual smoke docs route and output docs route load content
- [x] Step 3: Implement Listen providers and Admin configuration.
  - **Files:** `packages/app/src/App.tsx`, `packages/server/src/routes/docs.ts`
  - **Verify:** browser TTS path works without server; Kokoro/OpenAI paths call explicit provider endpoints and surface errors
- [x] Step 4: Wire task-detail rail/tabs/actions to real state or endpoints.
  - **Files:** `packages/app/src/components/mission-control/TaskDetailPanel.tsx`
  - **Verify:** visual test checks Activity, Logs, Comments, Subtasks, Links rail behavior
- [x] Step 5: Run build, server tests, and visual smoke.
  - **Files:** `packages/app/scripts/visual-smoke.cjs`, server tests if added
  - **Verify:** `npm --prefix packages/app run build`, `cd packages/server && npx vitest run`, `ENTITY_VISUAL_BASE_URL=http://localhost:5173 npm --prefix packages/app run test:visual`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 22:36 | Step 1 | In progress | Found docs server roots are using repo WORKSPACE for clawd docs and task detail has inert rail buttons plus console-only follow-up/continue actions. |
| 22:57 | Step 2 | Done | Output docs route now loads `2026-04-13-bird-cli-fix-report.md` in the docs workbench; outline is generated from actual markdown headings. |
| 22:57 | Step 3 | Done | Listen supports browser, Kokoro, and OpenAI provider config in Admin; OpenAI probe was not run because it would transmit document text externally. |
| 22:57 | Step 4 | Done | Task detail rail switches Activity, Logs, Comments, Subtasks, and Links; Follow-up and Continue work call task APIs. |
| 22:57 | Step 5 | Done | App build, server build, targeted docs tests, visual smoke, and live output docs route check completed. Full server suite still has unrelated `src/swarm/routes.test.ts` failures. |

## Files Touched
- `docs/plans/2026-04-25-docs-listen-task-detail-plan.md` — created — compaction-safe plan.
- `docs/plans/ACTIVE_PLAN.md` — modified — points current work to this plan.
- `packages/server/src/routes/docs.ts` — modified — fixes docs roots and TTS providers.
- `packages/server/src/routes/docs.test.ts` — created — verifies docs root and OpenAI TTS missing-key behavior.
- `packages/app/src/App.tsx` — modified — routes output markdown to docs view, adds TTS admin settings, dynamic docs outline.
- `packages/app/src/components/MarkdownAudioControls.tsx` — modified — implements Browser/Kokoro/OpenAI listen behavior.
- `packages/app/src/components/mission-control/TaskDetailPanel.tsx` — modified — wires task detail tabs/rail and task actions.
- `packages/app/scripts/visual-smoke.cjs` — modified — validates task detail tab interactions.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from there without redoing completed checks unless files changed externally.

## Done
- [x] All steps complete.
- [ ] Tests pass.
- [x] Visual smoke covers the fixed docs/listen/task-detail behavior.
