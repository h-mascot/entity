# Entity Server Errors And GitHub Push Plan

## Goal
Fix the failing server gate, verify the app still builds, then push the validated code to GitHub.

## Steps
- [x] Identify current failing server tests.
  - Verify: `cd packages/server && npx vitest run src/swarm/routes.test.ts --reporter verbose`
- [x] Patch swarm route behavior for summary aliases, spec-only create payloads, and nonblocking auto-dispatch.
  - Verify: targeted swarm route test
- [x] Patch eforge queue mode so dispatch works without `EFORGE_API_URL`.
  - Verify: targeted swarm route test
- [x] Run full server test gate.
  - Verify: `cd packages/server && npx vitest run`
- [x] Run server build.
  - Verify: `cd packages/server && npm run build`
- [x] Run app build and visual smoke.
  - Verify: `npm --prefix packages/app run build`
  - Verify: `npm --prefix packages/app run test:visual`
- [x] Review git diff, stage only intended changes, commit, and push.
  - Verify: `git status --short --branch`

## Files Touched
- `packages/server/src/swarm/routes.ts`
- `packages/server/src/swarm/providers/eforge.ts`
- `packages/server/src/routes/docs.ts`
- `packages/server/src/routes/docs.test.ts`
- `packages/app/src/App.tsx`
- `packages/app/src/components/MarkdownAudioControls.tsx`
- `packages/app/src/components/mission-control/TaskDetailPanel.tsx`
- `packages/app/scripts/visual-smoke.cjs`
- `docs/plans/ACTIVE_PLAN.md`
- `docs/plans/2026-04-25-server-errors-github-push-plan.md`

## Resume Notes
Continue from the first unchecked step. Do not revert unrelated dirty files in the worktree.
