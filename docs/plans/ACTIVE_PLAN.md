# Entity Geordi remediation active plan

Date: 2026-08-26
Base: `777b20f77dc85b2cf62cdc17067a0e526ef14ae6`
Branch: `fix/geordi-qa-remediation-20260826`
Worktree: `/Users/enterprise/Code/entity-geordi-remediation-20260826`
Runtime: `/Users/enterprise/Library/Application Support/EntityRunner/entity-geordi-remediation-20260826`

## Invariants

- No production edits or promotion.
- Strict RED → GREEN → REFACTOR for every behavior change.
- Use Node 22.22.3 for proof.
- Do not patch working UI paths merely because native Safari clicks failed.
- Source/Back, Users & Access, task detail/Handoffs, Operations Center, and module visibility currently have independent passing proof.
- No external provider writes or credentials.
- Commit each accepted queue item separately.
- Implementation: Pi `citadel/glm5.3` medium.
- Review: Pi `citadel/azure-openai-responses/gpt-5.6-luna` high.

## Approved queue

### GQR-001: Safari OpenWiki preview — COMPLETE at `08726f9`

- [x] Added Safari, Playwright WebKit, and Chromium failing regression using the production CSP.
- [x] Proved Safari/WebKit block blob iframe navigation while Chromium renders it.
- [x] Replaced static blob preview with `srcDoc`; removed route-hash carry and timed iframe reset.
- [x] Preserved the scriptless opaque sandbox and Chromium behavior.
- [x] Proved preview, Source toggle, second Wiki page, and browser Back in real Safari.

Evidence:
- RED: Safari/WebKit component cases false; Chromium control true; `GQR-001-evidence/gqr001-RED.log`
- GREEN: Safari/WebKit/Chromium cases true; `GQR-001-evidence/gqr001-GREEN.log`
- real Safari app proof screenshots: `GQR-001-evidence/safari-app/`
- app tests 526/526; Wiki HTML 16/16; server Vitest 2574/2574; app/server builds clean under Node 22.22.3
- worker receipt: `receipts/GQR-001-worker-summary.json`

Known accepted delta for review: a top-level fragment no longer auto-scrolls a freshly opened preview; in-frame anchor links still work. Luna-high must independently decide whether this is acceptable.

### GQR-002: Truthful unavailable File Sources — COMPLETE (repaired after Luna CHANGES_REQUESTED)

Depends on: GQR-001

Luna-high review of `8c5f702` returned CHANGES_REQUESTED with three actionable findings. Bounded repair (single save-point atop `8c5f702`, strict RED→GREEN per finding):

- [x] Sync truthfulness: failing server test first (`POST /api/sources/:id/sync` on unimplemented connector expected typed 501, observed 200 envelope); route now rejects unimplemented connectors with typed 501 `{error, code: CONNECTOR_NOT_IMPLEMENTED, connectorType}` before dispatch/indexing; supported sources keep the normal envelope; diagnostic `/test` 200/error preserved.
- [x] Failing UI test first (`FileSourcesSettings.test.ts`, new); Admin `Sync now` extracted as exported `SourceSyncButton` and disabled for unavailable sources (busy/disabled/unavailable), supported sources stay actionable.
- [x] Availability fail closed: failing regression for `{ type: 'github', implemented: true }` first; `sourceIsAvailableInBuild` now requires local build support AND `implemented !== false` — server metadata can only veto, never enable.
- [x] Search exclusion: failing server regressions first; `routes-search` filters unimplemented connectors from indexed results (stale rows can't surface) and never creates adapters/dispatches fallback listing for them (explicit `sourceId` on unavailable → empty, no dispatch). Supported connector search preserved.
- [x] Failing app regression first; `SourceFileTree` exports `sourcesEligibleForSearch` (enabled + available) used by search auto-expansion and per-source search dispatch, so unavailable sources are never expanded or queried.

Repair evidence: `receipts/gqr002-repair-sync-server-RED.log` (+GREEN), `gqr002-repair-sync-app-RED.log` (+GREEN), `gqr002-repair-availability-RED.log` (+GREEN), `gqr002-repair-search-server-RED.log` (+GREEN), `gqr002-repair-search-app-RED.log` (+GREEN), focused `gqr002-repair-server-focused-GREEN.log` (45/45) + `gqr002-repair-app-focused-GREEN.log` (15/15), full `gqr002-repair-server-full-GREEN.log` (2592/2592, isolated reruns after one concurrent-load flake), `gqr002-repair-app-full-GREEN.log` (537/537), live API `gqr002-repair-live-api.log`, browser `receipts/GQR-002-repair-evidence/browser/` (8/8 PASS: search never dispatches to unavailable source; supported search returns results; unavailable not auto-expanded; Sync now disabled + forced click dispatches nothing; supported Sync stays enabled). App/server builds clean under Node 22.22.3. Worker receipt: `receipts/GQR-002-repair-worker-summary.json`.

Original GQR-002 evidence:

- [x] Add failing server tests for typed `CONNECTOR_NOT_IMPLEMENTED` and non-500 mapping.
- [x] Add failing app tests proving unavailable sources are not expandable/actionable.
- [x] Set placeholder capabilities false.
- [x] Return typed 501 or typed 503, never generic 500.
- [x] Show `Not available in this build`; preserve Admin diagnostics.
- [x] Hide unsupported source types from Add Source or label Coming soon.

Verify:
- [x] FS adapter/route/hook/tree/settings focused tests (server 35/35 focused, app focused green)
- [x] 401/403 cache protections remain green (useFileSources + fileCacheFallback)
- [ ] live sandbox Files proof after deployment (deferred to deploy phase; local browser proof captured)

Evidence: `receipts/gqr002-server-RED.log` (15 expected failures), `receipts/gqr002-app-RED.log` (6 expected failures + caret addendum), `receipts/gqr002-server-GREEN.log`, `receipts/gqr002-app-GREEN.log`, `receipts/gqr002-live-api.log` (typed 501s against a live local server), `receipts/GQR-002-evidence/browser/` (15/15 Chromium checks PASS: tree badge/disabled/no-request/neutral caret; Admin coming-soon options; badge; fail-closed Test diagnostics). Full suites: app 532/532, server 2589/2589; app+server builds clean under Node 22.22.3. Known behavior change: writes on unimplemented connectors now return typed 501 instead of the misleading 403 `Source is read-only.` (existing expectation updated in `routes-files.test.ts`).

### GQR-003: Supported server-test entry point and broker startup race

Depends on: GQR-002

- [ ] Add failing entry-point ordering regression from absent generated broker outputs.
- [ ] Add supported root `test:server` command that builds before server tests; wire Geordi/CI docs to use it.
- [ ] Add repeated missing-root startup regression where typed `not_found` must beat stdin EPIPE.
- [ ] Fix the client race without weakening fail-closed behavior.

Verify:
- smallest red loop then green
- `npm run test:server`
- release packaging/build tests
- broker absent still fails closed in real release verification

### GQR-004: Provider runtime composition and administration

Depends on: GQR-002, GQR-003

- [ ] Add a test/sandbox-only deterministic provider bootstrap that refuses production startup.
- [ ] Exercise fake provider through the real mounted `/api/document-integrations` composition.
- [ ] Persist/load authoritative connection state, policies, and destinations for sandbox fixtures.
- [ ] Add redacted provider-admin status endpoint.
- [ ] Make DocsSettings API-backed.
- [ ] Add Microsoft 365 card and capability-honest unsupported mutation states.
- [ ] Keep Google/Local/Microsoft write gates fail closed.

Verify:
- runtime-composition integration suite
- DocsSettings/ProviderSettings UI suites
- no network, secrets, or external writes
- production fake-provider guard test

### GQR-005: GitHub and S3 connector contracts

Depends on: GQR-002, GQR-004

- [ ] Introduce injectable clients and shared adapter contract tests.
- [ ] GitHub: tree/read, pagination, path bounds, bearer redaction, typed auth/rate/5xx behavior, cache policy.
- [ ] S3: URI parsing, ListObjectsV2 pagination, bounded GetObject, traversal rejection, ETag/version normalization, typed auth/not-found/throttle behavior.
- [ ] Decide from source authority whether live connectors ship now or remain truthful Coming soon. If no authority exists, stop at complete synthetic contracts and surface the exact product decision.

Verify:
- deterministic fake client suites
- no credentials or live network
- unavailable/ready UI truthfulness

### GQR-006: QA harness correction and final closure

Depends on: GQR-001..GQR-005

- [ ] Add deterministic browser fixtures for admin navigation, task/Handoffs, provider preview, refresh, mobile viewport, and external document metadata.
- [ ] Correct Geordi I2 from contract FAIL to invalid prerequisite/setup classification in the superseding report.
- [ ] Make progress state live and watchdog self-pause at terminal.
- [ ] Verify source cleanliness from the source cwd.
- [ ] Make compact-index payload checks semantic, not substring checks against metadata.
- [ ] Run focused tests, full tests, build, private scan, OpenWiki freshness, `ctrl:full`/`ctrl:gate` as available.
- [ ] Luna-high review to APPROVED.
- [ ] Commit/push/open PR, CI, merge to main when green.
- [ ] Deploy merged SHA to sandbox using approved deploy profile.
- [ ] Run focused Geordi reruns, then full 62-row rerun.
- [ ] Stop before production.

## External authority boundaries

Real Google/Microsoft live writes require approved isolated synthetic tenants, destinations, cleanup rules, and explicit write authorization. Local Office native certification requires a disposable desktop/OS matrix and installed bridge. Until those exist, deterministic synthetic runtime/UI proof may pass while live vendor certification remains explicitly blocked.

## Checkpoints

- [x] Exact audit complete.
- [x] Worktree created clean at approved main.
- [x] GLM-5.3 and Luna-high PTY smokes pass.
- [x] Governed manager active with exactly one owner or terminal state.
- [x] GQR-001 implementation complete at `08726f9`; independent Luna-high review pending.

## Files touched

Update as work proceeds.

- GQR-002: `packages/server/src/fs/errors.ts`, `packages/server/src/fs/adapters/registry.ts` (+ `registry.test.ts`), `packages/server/src/fs/routes-files.ts` (+ test), `packages/server/src/fs/routes-sources.ts` (+ test), `packages/app/src/types/filesystem.ts`, `packages/app/src/lib/sourceAvailability.ts` (+ test), `packages/app/src/components/SourceUnavailableBadge.tsx` (new), `packages/app/src/components/SourceFileTree.tsx` (+ test), `packages/app/src/components/settings/FileSourcesSettings.tsx`, `packages/app/scripts/gqr002-file-sources-ui-proof.mjs` (new)

- GQR-002 repair: `packages/server/src/fs/routes-sources.ts` (+test), `packages/server/src/fs/routes-search.ts` (+test), `packages/app/src/lib/sourceAvailability.ts` (+test), `packages/app/src/components/settings/FileSourcesSettings.tsx` (+ `FileSourcesSettings.test.ts` new), `packages/app/src/components/SourceFileTree.tsx` (+test), `packages/app/scripts/gqr002-repair-ui-proof.mjs` (new)

## Resume

Read this file, runtime `state.json`, exact process tree/log tail, `git status`, and the first unchecked queue item. Never relaunch if one matching owner exists.
