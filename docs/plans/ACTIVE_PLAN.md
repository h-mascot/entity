# ACTIVE PLAN — Unify document and media viewing in Doc Hub

## Task

Make the original Doc Hub viewer the single canonical view for all document and media routes, including source-backed `/docs/source/*` links with `file` and `source` query parameters.

**Created:** 2026-07-10
**Agent:** Codex
**Status:** COMPLETE

## Context

- Production URL `/docs/source/ada-gateway/output/herald-labs-beta-engine/ritesh-nero-onboarding.html?file=cron/output/...md&source=book` does not display its target in view mode.
- Opening from Doc Hub currently reaches a different viewer from direct document/media routes.
- The original Doc Hub viewer is the canonical UI; every document/media entry point must resolve into it.
- Preserve source identity, file path, media type, history state, and browser-visible error/loading behavior.

## Dependencies

- [x] Step 1 has no dependencies
- [x] Step 2 depends on the route/view inventory from Step 1
- [x] Step 3 depends on a failing behavior test and confirmed canonical route contract
- [x] Step 4 depends on implementation passing focused tests
- [x] Step 5 depends on all verification and review gates passing

## Plan

- [x] Step 1: Reproduce the production URL shape and inventory all document/media route entry points
  - **Files:** read-only route, navigation, and viewer investigation
  - **Verify:** browser/route trace plus GitNexus context
- [x] Step 2: Define the canonical Doc Hub target resolver and add failing route behavior tests
  - **Files:** app routing/view helpers and colocated tests
  - **Verify:** tests fail for the reported nested source URL and competing viewer paths
- [x] Step 3: Route every document/media entry point through the original Doc Hub viewer
  - **Files:** app route parsing/navigation and viewer wiring identified in Step 1
  - **Verify:** focused tests pass for local, source-backed, document, and media inputs
- [x] Step 4: Run builds, suites, CTRL, GitNexus impact analysis, and mandatory reviews
  - **Files:** no additional production scope expected
  - **Verify:** server/app/db tests, builds, `npm run ctrl:full`, Codex and thermo reviews
- [x] Step 5: Verify exact production-shaped and Doc Hub workflows in the browser with screenshot evidence
  - **Files:** browser evidence only
  - **Verify:** both entry points render the same canonical shell and target content/media
- [x] Step 6: Correct remote HTML MIME misclassification and re-verify Viewing mode in production
  - **Files:** Markdown-vs-HTML viewer selection helper and regression test
  - **Verify:** exact production URL renders its HTML inside the sandboxed Doc Hub viewer

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 13:25 | Plan | ✅ | Created compaction-safe execution plan; worktree clean and main synced |
| 14:06 | Step 1 | ✅ | Pathname activated standalone viewer while stale query initialized hidden Doc Hub state; media routes redirected raw |
| 14:08 | Step 2 | ✅ | Added public route target tests covering exact hybrid URL, legacy roots, media, and query aliases |
| 14:20 | Step 3 | ✅ | Removed standalone viewer, unified navigation into Doc Hub, kept raw endpoint as byte transport; focused tests/build pass |
| 14:40 | Step 4 | ✅ | App 39, server 702, DB 5; builds and CTRL gate passed; live smoke passed; GitNexus impact reviewed; correctness and thermo approved |
| 14:42 | Step 5 | ✅ | Browser proved canonical query cleanup, Doc Hub rendering, tab reload/back/forward, and cold-load route authority; screenshot captured |
| 15:01 | Step 6 | ✅ | Added path-authority regression/fix; app 41, server 702, DB 5 and CTRL gate pass; correctness and thermo reviews approved |

## Files Touched

- `docs/plans/2026-07-10-unify-doc-media-viewer-plan.md` — created — task plan
- `docs/plans/ACTIVE_PLAN.md` — modified — active resume state
- `packages/app/src/App.tsx` — modified — resolves all document/media routes into Doc Hub state
- `packages/app/src/lib/docHubRoute.ts` — created — canonical route-to-target module
- `packages/app/src/lib/docHubRoute.test.ts` — created — route compatibility and precedence tests
- `packages/app/src/views/DocsRouteView.tsx` — deleted — removed competing standalone viewer
- `packages/app/src/components/DocumentViewerChrome.tsx` — deleted — removed standalone viewer chrome
- `packages/app/src/lib/markdownFile.ts` — modified — keeps HTML paths out of Markdown reading mode despite misleading remote MIME
- `packages/app/src/lib/markdownFile.test.ts` — created — regression coverage for remote HTML reported as Markdown
- `packages/server/src/routes/docs.ts` — modified — serves the Doc Hub SPA for source media and resolves frontend dist robustly
- `packages/server/src/__tests__/routes-docs.test.ts` — modified — verifies media remains in Doc Hub

## Resume Instructions

1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the “Files Touched” and “Checkpoints” sections
5. Continue from there — do not redo completed steps

## Done

- [x] All steps complete
- [x] Tests pass
- [x] Exact browser workflows verified
- [x] Reviews pass with zero unresolved blockers
