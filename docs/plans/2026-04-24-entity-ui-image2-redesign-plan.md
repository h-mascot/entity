# Task Plan — Entity UI Screenshot And Image 2.0 Redesign

## Task
Capture actual Entity desktop screenshots and generate two Image 2.0 redesign concept sets.

**MC Task:** #___  
**Created:** 2026-04-24  
**Agent:** Codex  
**Status:** COMPLETE

## Context
The user wants design artifacts only: actual screenshots, two generated redesign sets, prompts, and a concise recommendation report. Entity is an operational workspace, so concepts must stay dense, utilitarian, and execution-focused. Use `OPENAI_API_KEY` from the local environment and call the Images API with explicit `model: "gpt-image-2"`. If that model is rejected, stop instead of falling back.

## Dependencies
- [ ] Step 1 has no dependencies.
- [ ] Step 2 depends on `OPENAI_API_KEY` being present without printing it.
- [ ] Step 3 depends on a reachable local Entity app.
- [ ] Step 4 depends on actual screenshots being captured.
- [ ] Step 5 depends on Image 2.0 API success.

## Plan

- [x] Step 1: Prepare artifact folder and confirm context/routes.
  - **Files:** `docs/design-reviews/2026-04-24-entity-ui-upgrade/`
  - **Verify:** `test -d docs/design-reviews/2026-04-24-entity-ui-upgrade`
- [x] Step 2: Verify API key and local tool prerequisites without exposing secrets.
  - **Files:** none
  - **Verify:** `test -n "$OPENAI_API_KEY" && command -v npx`
- [x] Step 3: Start or reuse local server and verify the app loads.
  - **Files:** none
  - **Verify:** `curl -I http://localhost:<port>`
- [x] Step 4: Capture actual screenshots for first- and second-level views.
  - **Files:** `docs/design-reviews/2026-04-24-entity-ui-upgrade/actual/`
  - **Verify:** `find docs/design-reviews/2026-04-24-entity-ui-upgrade/actual -type f -size +0`
- [x] Step 5: Generate two `gpt-image-2` redesign sets and save prompts/API metadata.
  - **Files:** `docs/design-reviews/2026-04-24-entity-ui-upgrade/set-1/`, `docs/design-reviews/2026-04-24-entity-ui-upgrade/set-2/`, `prompts/`
  - **Verify:** `find docs/design-reviews/2026-04-24-entity-ui-upgrade -path '*set-*/*.png' -size +0`
- [x] Step 6: Write concise recommendation report and final verification summary.
  - **Files:** `docs/design-reviews/2026-04-24-entity-ui-upgrade/report.md`
  - **Verify:** `test -s docs/design-reviews/2026-04-24-entity-ui-upgrade/report.md`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 06:55 | Setup | Started | `OPENAI_API_KEY` and `npx` are present. |
| 07:00 | Actual capture | Complete | 9 screenshots captured and baseline validated. |
| 07:03 | Pilot generation | Complete | `set-1/01-files.png` generated with `gpt-image-2` and validated. |
| 07:25 | Parallel review | Complete | 20 review passes completed within 6-thread concurrency cap. |
| 07:40 | Image generation | Complete | 18 generated concepts completed across Set 1 and Set 2. |
| 07:42 | Final validation | Complete | 27 PNG artifacts validated with zero failures. |
| 07:43 | Report | Complete | `manifest.json` and `report.md` written. |

## Files Touched
- `docs/plans/2026-04-24-entity-ui-image2-redesign-plan.md` — created — compaction-safe plan.
- `docs/plans/ACTIVE_PLAN.md` — updated — current active plan.
- `docs/design-reviews/2026-04-24-entity-ui-upgrade/` — created — screenshots, prompts, generated images, and report.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. If a step is partially done, check the artifact folder and checkpoints.
5. Continue from there. Do not redo completed steps unless an artifact is missing or empty.

## Done
- [x] All steps complete.
- [x] Actual screenshots captured.
- [x] `gpt-image-2` API path verified or exact rejection reported.
- [x] Report written.
