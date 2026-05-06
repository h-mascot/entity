# Entity Onboarding Flow Plan

## Task
Integrate first-run onboarding into the existing Entity app flow.

**MC Task:** n/a
**Created:** 2026-05-06
**Agent:** Codex
**Status:** IN PROGRESS

## Context
Entity needs a simple onboarding flow that avoids Admin settings overload. The full app menu should stay hidden until onboarding is complete. Agent-assisted setup should expose the existing `skills/entity-mc` bundle as the agent operating skill.

## Dependencies
- [x] Context/spec exists from product discussion
- [x] `skills/entity-mc` bundle exists
- [x] Feature branch created

## Plan

- [x] Step 1: Add server-backed onboarding state and agent session APIs
  - **Files:** `packages/server/src/config/schema.ts`, `packages/server/src/config/routes.ts`, `packages/server/src/config/routes.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/config/routes.test.ts`
- [x] Step 2: Add dedicated onboarding UI and route gate
  - **Files:** `packages/app/src/App.tsx`, `packages/app/src/index.css`
  - **Verify:** `npm --prefix packages/app run build`
- [x] Step 3: Wire skill bundle download/manifest into agent setup branch
  - **Files:** `packages/server/src/config/routes.ts`, `packages/app/src/App.tsx`
  - **Verify:** `curl http://localhost:3000/api/onboarding/agent-session/<token>/manifest` during browser smoke if server available
- [x] Step 4: Run project verification and browser check
  - **Files:** n/a
  - **Verify:** `cd packages/server && npx vitest run`, `npm --prefix packages/app run build`, Browser Use onboarding smoke

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 01:20 | Setup | done | Branch created; plan created |
| 01:43 | Steps 1-3 | done | Server APIs, onboarding UI gate, and entity-mc bundle endpoint implemented |
| 02:10 | Step 4 | done | App/server builds, full server tests, browser smoke, and ctrl:full passed |

## Files Touched
- `docs/plans/2026-05-06-onboarding-flow-plan.md` - created - compaction-safe implementation plan
- `docs/plans/ACTIVE_PLAN.md` - will mirror this plan
- `packages/server/src/config/schema.ts` - modified - onboarding state/session schemas
- `packages/server/src/config/routes.ts` - modified - onboarding state/session/manifest/bundle APIs
- `packages/server/src/config/routes.test.ts` - modified - onboarding route coverage
- `packages/app/src/components/OnboardingFlow.tsx` - created - dedicated onboarding UI shell and screens
- `packages/app/src/App.tsx` - modified - onboarding route/state gate
- `packages/app/src/index.css` - modified - onboarding theme previews
- `artifacts/onboarding-step1.png` - created - browser verification screenshot
- `artifacts/onboarding-finish.png` - created - browser verification screenshot
- `artifacts/onboarding-agent-link.png` - created - browser verification screenshot

## Resume Instructions
1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections
5. Continue from there - do NOT redo completed steps

## Done
- [x] All steps complete
- [x] Tests pass
- [x] Browser verification complete
- [ ] ACTIVE_PLAN.md cleared or updated for next task
