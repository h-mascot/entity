# Entity Doc Hub Governed Runner Plan

## Task

Run the approved Entity Doc Hub Daily Use Fix Pack queue from THE-650 through THE-672.

**Created:** 2026-07-28
**Agent:** Geordi / Codex Runner Governed
**Status:** BLOCKED — LOCAL QUEUE CLEAN / DELIVERY AUTHORITY

## Context

- Queue authority: `.runner/approved-queue.json`
- Base: `origin/main`
- Branch: `runner/dochub-governed-20260728`
- THE-648 and THE-649 were completed before this run; begin at THE-650.
- This run must not push or merge. If source changes remain at queue closure, terminate run-state as blocked pending explicit Henry delivery approval and Book/SuperAda verification.
- Every issue needs durable proof and a clean governed review before advancing.

## Dependencies

- [x] THE-650 depends on the earlier THE-649 LaunchAgent inventory.
- [x] THE-652 depends on THE-650 and THE-651.
- [x] THE-653 depends on THE-652.
- [x] Milestone A runs in approved dependency order from THE-654 through THE-672.

## Plan

- [x] Step 1: Complete THE-650 deploy-profile versus running-path characterization.
  - **Files:** `.runner/run-state.json`, `output/entity-dochub-governed/proof/THE-650/`, `output/entity-dochub-governed/review/THE-650.md`
  - **Verify:** repo-real profile/LaunchAgent inspection commands plus governed review
- [x] Step 2: Complete Milestone 0 issues THE-651 through THE-653.
  - **Files:** issue-scoped source changes if required, proof and review receipts
  - **Verify:** relevant package scripts, sandbox/API/browser proof
- [x] Step 3: Complete Milestone A issues THE-654 through THE-671.
  - **Files:** issue-scoped app/server code and colocated tests, proof and review receipts
  - **Verify:** targeted tests, relevant builds, sandbox/API/browser proof, governed review
- [x] Step 4: Complete THE-672 end-to-end and UI proof gate.
  - **Files:** final proof/review receipts and `.runner/run-state.json`
  - **Verify:** full relevant gate plus browser proof
- [x] Step 5: Close the local run at the delivery authority boundary.
  - **Files:** `.runner/run-state.json`, this plan
  - **Verify:** if source changes remain, run-state is blocked with the exact Henry + Book/SuperAda decision needed; no push or merge occurs in this run

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 21:58 | Step 1 | In progress | Branch/base clean; queue and source authority loaded |
| 22:04 | Step 1 | Blocked | Previous review slug was misspelled as gpt-5.6-tera; corrected to gpt-5.6-terra |
| 22:34 | Step 1 | In progress | Resumed corrected governed review with no positional prompt |
| 22:36 | Step 1 | Complete | Corrected gpt-5.6-terra high review exited 0 with no blockers |
| 22:36 | Step 2 | In progress | Advanced run-state to THE-651 |
| 22:44 | Step 2 | Complete | THE-651 runtime/database receipt clean; local save-point a9e6020 |
| 22:49 | Step 2 | Blocked | THE-652 SHA/static fingerprint passes; browser discovery returned no sessions |
| 22:20 | Step 2 | In progress | THE-652 rendered Chrome fallback proof supplied; closing governed review |
| 22:22 | Step 2 | In progress | THE-652 proof and governed review clean; advanced to THE-653 |
| 22:28 | Step 2 | Complete | THE-653 tests/build/API/browser characterization and governed review clean |
| 22:29 | Step 3 | In progress | Advanced to THE-654 route-state characterization |
| 22:43 | Step 3 | In progress | THE-654 route restoration characterization and governed review clean; advanced to THE-655 |
| 23:40 | Step 3 | In progress | THE-655 red/green route adapter proof, app gate, and governed review clean; advanced to THE-656 |
| 23:45 | Step 3 | In progress | THE-656 content-class canonical-link proof, app gate, and governed review clean; advanced to THE-657 |
| 23:23 | Step 3 | In progress | THE-657/THE-658 adapter, fallback, route-alignment, browser proof, full gates, and governed review clean; advanced to THE-659 |
| 23:34 | Step 3 | In progress | THE-659 native-share branches and shared-tool restoration are unit/browser proved; corrected governed review clean; advanced to THE-660 |
| 23:54 | Step 3 | In progress | THE-660 mobile Tools shell and wired Share are red/green/browser proved; two review blockers fixed; closure clean; advanced to THE-661 |
| 02:05 | Step 3 | In progress | THE-661 active-tool, navigation authority, traversal, sheet lifecycle, 58 app tests, 704 server tests, responsive browser proof, and governed review clean; advanced to THE-662 |
| 02:28 | Step 3 | In progress | THE-662 full-screen Convert shell, route hydration, nested Back/focus behavior, 45 focused tests, app build, three-viewport browser proof, and governed review clean; advanced to THE-663 |
| 03:03 | Step 3 | In progress | THE-663 first-look clarity plus three governed-review closure rounds are unit/build/browser proved; final review clean; advanced to THE-664 comments capability characterization |
| 03:33 | Step 3 | In progress | THE-664 READ/WRITE capability, auth-scope proof, navigation closure, focused test split, 103-test Node 22 suite, build/browser proof, and final governed review clean; advanced to THE-665 |
| 03:47 | Step 3 | In progress | THE-665 mobile Comments state/submission/auth/stale-document behavior, 110-test Node 22 suite, app/server gates, responsive Chrome proof, and governed review clean; advanced to THE-666 |
| 04:11 | Step 3 | In progress | THE-666 audio controller, request identity/deduplication/cleanup, fragment-only review closure, 117-test Node 22 suite, build/Chrome proof, and final governed review clean; advanced to THE-667 |
| 04:40 | Step 3 | In progress | THE-667 explicit audio state UX, provider recovery, rendered Chrome proof, stale-comment RED-first review closure, 127-test app suite, app/server gates, and final governed review clean; advanced to THE-668 |
| 05:24 | Step 3 | In progress | THE-668 persistence characterization and artifact identity complete; four cumulative review findings closed RED-first, Round 5 clean, 131 app tests/build/browser proof pass; advanced to THE-669 |
| 05:48 | Step 3 | In progress | THE-669 bounded security-scoped cache and mounted stale-artifact invalidation are proved by 133 app tests, server/app builds, 716 server tests, Chrome proof, and clean governed review; advanced to THE-670 |
| 06:08 | Step 3 | In progress | THE-670 current-document mobile mini-player is RED/green proved by 136 app tests, app build, 320px Chrome layout/interaction/document-switch proof, 716 server tests, and clean governed review; advanced to THE-671 |
| 07:05 | Step 3 | Complete | THE-671 allowlisted telemetry, privacy canaries, required-property RED/green closure, 139 app tests, builds, 736 server tests, and corrected governed review clean; advanced to THE-672 |
| 07:05 | Step 4 | In progress | Began Milestone A end-to-end and responsive UI proof gate |
| 07:08 | Step 4 | Complete | THE-672 Gate A passes 142 app tests, app/server builds, 736 server tests, refreshed 320px Chrome proof, and three-round governed review closure |
| 07:08 | Step 5 | Blocked | All 23 approved local issues are clean; push/merge/deploy requires explicit Henry delivery authority and Book/SuperAda verification |

## Files Touched

- `.runner/run-state.json` — runner control state; never commit
- `docs/plans/2026-07-28-entity-dochub-governed-run-plan.md` — durable execution plan
- `docs/plans/ACTIVE_PLAN.md` — current recovery pointer
- `tasks/todo.md` — local task checklist
- `output/entity-dochub-governed/` — issue proof/review receipts; never commit
- `packages/app/src/lib/docHubRoute.ts` — shared logical route-state parser/serializer
- `packages/app/src/lib/docHubRoute.test.ts` — route-state contract tests
- `packages/app/src/lib/docHubRouteState.test.ts` — focused route serialization and synchronization tests
- `packages/app/src/lib/docHubMobileState.test.ts` — focused mobile route/surface lifecycle tests
- `packages/app/src/lib/docHubNavigation.test.ts` — focused Markdown and split-pane navigation tests
- `packages/app/src/lib/docHubCanonicalLink.test.ts` — canonical document-class link tests
- `packages/app/src/lib/shareAdapter.ts` — clipboard/share environment adapter
- `packages/app/src/lib/shareAdapter.test.ts` — adapter degradation tests
- `packages/app/src/lib/markdownFile.ts` — safe Markdown-to-Doc-Hub navigation candidate classification
- `packages/app/src/lib/markdownFile.test.ts` — relative/external link classification regressions
- `packages/app/src/components/MarkdownPreview.tsx` — relative document links wired through Doc Hub navigation
- `packages/app/src/components/doc-hub/DocHubWorkspaceChrome.tsx` — canonical Copy link and manual fallback
- `packages/server/src/routes/docs.ts` — source-route traversal guard aligned with canonical route validation
- `packages/server/src/routes/docs.test.ts` — route validation regression proof
- `packages/app/src/views/MobileView.tsx` — mobile Doc Hub Tools entry and tool surfaces
- `packages/server/src/routes/tts.ts` — bounded security-scoped generated-audio cache
- `packages/server/src/routes/tts.test.ts` — cache identity, reuse, invalidation, and eviction proof
- `packages/app/src/lib/documentAudioRequest.ts` — document identity and cache-hit request contract
- `packages/app/src/lib/documentAudioRequest.test.ts` — audio request contract proof
- `packages/app/src/lib/documentAudioState.ts` — generation identity and stale-artifact reconciliation
- `packages/app/src/lib/documentAudioState.test.ts` — mounted invalidation regression proof
- `packages/app/src/components/MarkdownAudioControls.tsx` — cache status and mounted generation reconciliation
- `packages/app/src/lib/documentShellState.ts` — enabled mobile Audio tool contract
- `packages/app/src/lib/documentShellState.test.ts` — Audio action handler proof
- `packages/app/src/views/MobileView.tsx` — supported-document Audio wiring and player clearance
- `packages/app/src/lib/docHubTelemetry.ts` — client event allowlist and redaction boundary
- `packages/app/src/lib/docHubTelemetry.test.ts` — client privacy canaries and schema tests
- `packages/server/src/doc-hub-telemetry.ts` — authoritative validation, release context, and API route
- `packages/server/src/doc-hub-telemetry.test.ts` — complete contracts, redaction, and API receipt tests

## Resume Instructions

1. Read this file and `.runner/run-state.json`.
2. Run `git status --short --branch` and inspect the issue-scoped diff.
3. Read `.runner/approved-queue.json`; work only its IDs.
4. Continue from the first unchecked step and current issue.
5. Never redo THE-648/THE-649, push, merge, or promote production in this run.
6. After the queue is locally clean, mark run-state blocked pending explicit Henry delivery approval and Book/SuperAda verification if source changes remain.

## Done

- [x] All approved issues from THE-650 are completed or explicitly blocked
- [x] Required tests/builds/browser proof pass
- [x] Every completed issue has a clean governed review
- [x] Run-state is terminal: blocked pending delivery authority when source changes remain
- [x] No proof/control artifacts are committed
