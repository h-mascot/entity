# Entity MC Public Skill Sanitization Plan

## Task
Tailor the bundled `entity-mc` skill for public onboarding without exposing private operator data.

**MC Task:** n/a  
**Created:** 2026-05-06  
**Agent:** Codex  
**Status:** IN PROGRESS

## Context
The onboarding flow exposes `skills/entity-mc` through agent setup links. The copied bundle currently includes private agent manifests, local home paths, execution-tracking task records, and host/operator assumptions. The open-source app should instead ship a generic setup-only skill that talks to Entity through the onboarding manifest and public HTTP APIs.

## Dependencies
- [x] Entity context loaded from `docs/context/entity-context.md`
- [x] Existing onboarding plan loaded from `docs/plans/ACTIVE_PLAN.md`
- [x] Current private bundle audited for local/private data

## Plan

- [x] Step 1: Replace private bundle contents with generic app-facing skill docs and helper scripts
  - **Files:** `skills/entity-mc/**`
  - **Verify:** private string scan over `skills/entity-mc`
- [x] Step 2: Update onboarding API bundle allowlist and manifest payload to avoid local/private paths
  - **Files:** `packages/server/src/config/routes.ts`
  - **Verify:** `cd packages/server && npx vitest run src/config/routes.test.ts`
- [x] Step 3: Add server test coverage that the exposed bundle is sanitized
  - **Files:** `packages/server/src/config/routes.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/config/routes.test.ts`
- [x] Step 4: Run app/server verification and browser spot check if UI text changes
  - **Files:** n/a
  - **Verify:** `npm --prefix packages/app run build`, `npm run ctrl:full`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 11:28 | Context | done | Loaded Entity context and found private data in entity-mc manifests/scripts |
| 11:42 | Step 1 | done | Replaced private manifests/tracking/scripts with generic setup-safe Entity API helper |
| 11:55 | Steps 2-3 | done | Manifest no longer exposes local bundle path; bundle allowlist uses only example manifest; route test covers sanitized payload |
| 12:22 | Step 4 | done with external gate note | App build, route test, full server Vitest rerun, local API bundle scan, and browser screenshot passed. `ctrl:full` still blocks on the pre-existing remote DB symlink guardrail after build/live smoke pass. |

## Files Touched
- `docs/plans/2026-05-06-sanitize-entity-mc-skill-plan.md` - created - compaction-safe implementation plan
- `docs/plans/ACTIVE_PLAN.md` - updated - current active plan mirror
- `skills/entity-mc/**` - modified - public-safe skill docs, helper scripts, and example manifest
- `packages/server/src/config/routes.ts` - modified - sanitized Entity MC manifest and bundle allowlist
- `packages/server/src/config/routes.test.ts` - modified - sanitized bundle contract coverage
- `artifacts/entity-mc-sanitized-onboarding.png` - created - browser evidence after local server refresh

## Resume Instructions
1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections
5. Continue from there - do NOT redo completed steps

## Done
- [x] All steps complete
- [x] Tests pass
- [x] Private-data scan passes
- [ ] ACTIVE_PLAN.md cleared or updated for next task
