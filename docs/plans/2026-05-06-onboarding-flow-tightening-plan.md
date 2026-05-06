# Entity Onboarding Flow Tightening Plan

## Task
Fix the first-run onboarding flow so it clicks through reliably, only shows setup Entity can actually perform now, and reuses the existing model list source.

**MC Task:** n/a
**Created:** 2026-05-06
**Agent:** Codex
**Status:** COMPLETE

## Context
The current onboarding UI is visually close, but manual clicking can bounce back to the first step. Several controls imply unsupported setup work. The default AI picker should use the same backend model registry as the existing chat/Admin model selector.

## Plan

- [x] Step 1: Fix onboarding state progression and remove unsupported choices
  - **Files:** `packages/app/src/components/OnboardingFlow.tsx`
  - **Verify:** Browser click-through from setup mode to finish without resetting
- [x] Step 2: Reuse `/api/chat/models` for the default AI model picker
  - **Files:** `packages/app/src/components/OnboardingFlow.tsx`
  - **Verify:** Default AI step shows backend-provided model options
- [x] Step 3: Tighten onboarding visuals and hide unfinished previews/actions
  - **Files:** `packages/app/src/components/OnboardingFlow.tsx`, `packages/app/src/index.css`
  - **Verify:** Browser screenshot of workspace, theme, AI, preset, and finish screens
- [x] Step 4: Run build, browser verification, and project gate
  - **Files:** n/a
  - **Verify:** `npm --prefix packages/app run build`, Browser Use flow smoke, `npm run ctrl:full`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 13:05 | Context | in progress | Loaded onboarding component, CSS, existing model registry route, and prior plan |
| 14:16 | Backend | done | Fixed partial onboarding PATCH default reset and added regression coverage |
| 14:45 | Browser | done | Browser click-through reached finish and entered workspace without resetting |
| 14:50 | Gate | done with deploy note | App build and server tests pass; `ctrl:full` reaches deploy check and stops on existing remote DB symlink guardrail |

## Files Touched
- `docs/plans/2026-05-06-onboarding-flow-tightening-plan.md` - created - compaction-safe implementation plan
- `docs/plans/ACTIVE_PLAN.md` - update pending - mirror current plan
- `packages/server/src/config/routes.ts` - modified - preserve explicit onboarding patch fields only
- `packages/server/src/config/routes.test.ts` - modified - regression for model-only patches preserving current step
- `packages/app/src/components/OnboardingFlow.tsx` - modified - simpler supported onboarding choices and backend model picker
- `packages/app/src/index.css` - modified - tightened check placement, disabled states, and scrollable model menu
- `artifacts/onboarding-tightened-workspace.png` - created - browser evidence
- `artifacts/onboarding-tightened-theme.png` - created - browser evidence
- `artifacts/onboarding-tightened-ai-final.png` - created - browser evidence
- `artifacts/onboarding-tightened-source-final.png` - created - browser evidence
- `artifacts/onboarding-tightened-finish-final-top.png` - created - browser evidence

## Done
- [x] Implementation complete
- [x] Server route test passes
- [x] Full server Vitest suite passes
- [x] App build passes
- [x] Browser Use click-through passes
- [x] `ctrl:full` run; deploy path check still blocks on pre-existing remote DB symlink guardrail

## Resume Instructions
1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. Continue from that step without redoing completed work
