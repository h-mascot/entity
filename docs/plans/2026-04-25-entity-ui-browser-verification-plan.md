# Entity UI Browser Verification Plan

## Task
Use browser/computer-use testing to verify the UI built in the selected UI session, fix any remaining mismatches, and rerun the gates.

## Context
- Current app URL: `http://127.0.0.1:5174/`
- Selected reference comparison notes live at `packages/app/artifacts/visual-smoke/comparisons/comparison-notes.md`
- Known remaining visual concerns from the previous comparison:
  - Agents and Agent Detail are less faithful to the selected concepts.
  - Chat is conservative only because the generated concept was rejected.

## Dependencies
- Entity app dev server must be reachable on `127.0.0.1:5174`.
- Browser inspection should use Browser Use or Computer Use.
- Repeatable validation uses `npm --prefix packages/app run build` and `npm --prefix packages/app run test:visual`.

## Plan
- [x] Verify dev server and browser state.
  - Verify: browser shows Entity shell at `http://127.0.0.1:5174/` with the API on `127.0.0.1:3000`
- [x] Run current automated gates.
  - Verify: `npm --prefix packages/app run build && npm --prefix packages/app run test:visual`
- [x] Inspect Files, Agents, Tasks, Services, Chat, Admin, Docs View, Agent Detail, and Task Detail in browser/computer-use.
  - Verify: no blank views, request-error views, layout overflow, or obviously broken controls.
- [x] Patch remaining UI/test issues.
  - Verify: affected view screenshot no longer shows the issue.
- [x] Rerun automated gates and update notes.
  - Verify: build and visual smoke pass.

## Files Touched
- `docs/plans/2026-04-25-entity-ui-browser-verification-plan.md`
- `docs/plans/ACTIVE_PLAN.md`
- `packages/server/src/agent-metrics.ts`
- `packages/server/src/agent-metrics.test.ts`
- `packages/server/src/index.ts`
- `packages/app/src/components/AgentDashboardV2.tsx`

## Resume Instructions
1. Read this plan.
2. Run `git status --short`.
3. Continue from the first unchecked item.
