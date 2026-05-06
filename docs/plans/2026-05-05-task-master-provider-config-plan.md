# Plan Template — Compaction-Survivable Execution

<!--
  HOW TO USE:
  1. Copy this template to docs/plans/YYYY-MM-DD-<slug>-plan.md
  2. Fill in the plan
  3. Copy/overwrite docs/plans/ACTIVE_PLAN.md with the same content
  4. Execute from ACTIVE_PLAN.md — check items as you go
  5. After compaction, re-read ACTIVE_PLAN.md, inspect state, continue from first [ ]
-->

## Task
Add Admin Task Master controls for provider, model, and API key configuration.

**MC Task:** n/a
**Created:** 2026-05-05
**Agent:** Codex
**Status:** IN PROGRESS

## Context
Task Master currently exposes status/log/trigger controls in Admin but provider/model/key setup is env-only and hard-coded in the UI copy. The new UI must let the user select providers/models and add/update an API key without echoing secrets back.

## Dependencies
- [ ] Step 1 has no dependencies
- [ ] Step 2 depends on finding the current agent config/status route
- [ ] Step 3 depends on backend save/load API
- [ ] Step 4 depends on UI and backend wiring

## Plan

- [x] Step 1: Trace Task Master status/trigger configuration.
  - **Files:** `packages/server/src/agent/*`, `packages/app/src/components/TaskMasterSettings.tsx`
  - **Verify:** `rg -n "ENTITY_AGENT|agent/status|agent/trigger" packages/server/src packages/app/src`
- [x] Step 2: Add backend settings API with masked key reads and provider/model persistence.
  - **Files:** `packages/server/src/agent/*`, `packages/server/src/index.ts`
  - **Verify:** `npm --prefix packages/server run build`
- [x] Step 3: Update Admin Task Master UI controls.
  - **Files:** `packages/app/src/components/TaskMasterSettings.tsx`
  - **Verify:** `npm --prefix packages/app run build`
- [x] Step 4: Run full verification and browser proof.
  - **Files:** n/a
  - **Verify:** `npm run ctrl:full`, Browser Use/Admin UI screenshot

## Checkpoints
<!-- Update as you complete steps — this is your resume point after compaction -->
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 20:-- | Step 1 | ✅ | Traced `/api/agent/status`, `/api/agent/trigger`, logs, and Admin Task Master settings surface |
| 22:23 | Step 2 | ✅ | Added DB-backed provider/model/key settings with masked reads and Gateway/Gemini language model selection |
| 22:24 | Step 3 | ✅ | Added Admin provider, model, custom model, API key save, and clear-key controls |
| 22:35 | Step 4 | ⚠️ | Builds/tests/browser passed; `ctrl:full` still fails at deploy-path check: production DB count was not numeric `<empty>` |
| 22:43 | Follow-up | ✅ | Added native OpenAI, Anthropic, and xAI providers plus configurable stale thresholds and max scan actions |

## Files Touched
<!-- Track every file created/modified — helps recovery inspect state -->
- `docs/plans/2026-05-05-task-master-provider-config-plan.md` — created — compaction-safe plan
- `docs/plans/ACTIVE_PLAN.md` — updated — current task pointer
- `packages/server/src/agent/settings.ts` — created — Task Master provider/model/key settings
- `packages/server/src/agent/settings.test.ts` — created — settings normalization and secret masking tests
- `packages/server/src/agent/index.ts` — updated — Task Master uses selected language model
- `packages/server/src/agent/log.ts` — updated — status reflects selected provider/model/key source
- `packages/server/src/index.ts` — updated — settings read/update API routes
- `packages/app/src/components/TaskMasterSettings.tsx` — updated — Admin controls for provider/model/key
- `packages/server/package.json` — updated — Gateway provider dependency
- `package-lock.json` — updated — Gateway provider dependency lock
- `artifacts/task-master-provider-settings.png` — created — browser verification screenshot
- `artifacts/task-master-provider-threshold-settings.png` — created — browser verification screenshot for expanded providers and thresholds

## Resume Instructions
<!-- For the agent that picks this up after compaction -->
1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections
5. Continue from there — do NOT redo completed steps

## Done
- [x] All implementation steps complete
- [x] Tests pass (change-specific, app/server build, full server suite)
- [ ] MC task moved to review
- [ ] `ctrl:full` passes end-to-end (blocked by deploy-path check outside this change)
- [ ] ACTIVE_PLAN.md cleared or updated for next task
