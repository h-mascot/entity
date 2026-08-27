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

### GQR-003: Supported server-test entry point and broker startup race — COMPLETE (repaired after Luna CHANGES_REQUESTED)

Depends on: GQR-002

Luna-high review of `6501da3` returned CHANGES_REQUESTED with exactly one actionable blocker: the deferred arbitration only protected requests already in `pending`; a request issued between child `exit` and stdout delivery of the buffered typed diagnostic still received the generic `closed` rejection. Bounded repair (single save-point atop `6501da3`, strict RED→GREEN):

- [x] Added deterministic failing regression emitting `exit` first, issuing a request in the intervening window, then delivering the buffered typed `not_found`; expected RED preserved (`gqr003-repair-postdeath-RED.log`: observed generic `managed storage broker is closed`, expected typed `not_found`).
- [x] Extended the response-drain grace to cover post-death requests: while a drain arbitration is pending, `request()` parks the caller and the drain settle rejects it with the recorded terminal typed error (`failPostDeath`), so the buffered typed diagnostic wins. Spawn-failure (`failed` checked first), genuinely-closed-after-drain (immediate `terminalError ?? closed`), and absent-broker fail-closed behavior are unchanged (all pre-existing broker/race tests pass unmodified).

Repair evidence (Node 22.22.3, `receipts/`): RED `gqr003-repair-postdeath-RED.log`; focused GREEN `gqr003-repair-postdeath-GREEN.log` (21/21); repeated determinism `gqr003-repair-postdeath-repeated-GREEN.log` (10 consecutive runs, 21/21 each); neighbors `gqr003-repair-neighbors-GREEN.log` (broker + local adapter + integration, 36/36); root entry point from absent outputs `gqr003-repair-root-test-server-full-GREEN.log` (2596/2596, exit 0, broker rebuilt by the script); server build `gqr003-repair-server-build-GREEN.log` (tsc clean); hygiene `gqr003-repair-git-diff-check.log` (exactly the broker client + colocated test), `gqr003-repair-git-status-check.log`. Worker receipt: `receipts/GQR-003-repair-worker-summary.json`.

Original GQR-003 work:

- [x] Add failing entry-point ordering regression from absent generated broker outputs.
- [x] Add supported root `test:server` command that builds before server tests; wire Geordi/CI docs to use it.
- [x] Add repeated missing-root startup regression where typed `not_found` must beat stdin EPIPE.
- [x] Fix the client race without weakening fail-closed behavior.

Verify:
- [x] smallest red loop then green
- [x] `npm run test:server`
- [x] release packaging/build tests
- [x] broker absent still fails closed in real release verification

Evidence (all under Node 22.22.3, `receipts/`):
- Race reproduced before fix: `gqr003-race-probe-RED.log` — 200 repeated missing-root startups → 47 typed `not_found`, 127 `closed`, 19 `exited`, 7 stdin EPIPE `input failed` (canonical outcome won only 24%).
- Entry point RED: `gqr003-entrypoint-RED.log` (no supported `test:server`; direct server tests fail from absent broker outputs) → GREEN `gqr003-entrypoint-GREEN.log` (4/4).
- Broker race RED: `gqr003-broker-race-RED.log` (3 new regressions fail: EPIPE beat typed answer; post-death request `input failed`; repeated startup `closed`) → GREEN `gqr003-broker-race-GREEN.log` (20/20).
- Determinism: `gqr003-broker-race-repeated-GREEN.log` (10 consecutive full-file runs, 20/20 each) and `gqr003-race-probe-GREEN.log` (200/200 repeated missing-root startups all typed `not_found`).
- Focused neighbors: `gqr003-focused-neighbors-GREEN.log` (broker client + local adapter + integration, 35/35).
- Root entry point from absent outputs: `gqr003-root-test-server-full-GREEN.log` (2595/2595, exit 0, broker rebuilt by the script itself).
- Release gates: `gqr003-release-deploy-GREEN.log` (133/133 incl. new entry-point suite, wiring/transaction fail-closed, deploy live-verify fail-closed); `gqr003-server-build-GREEN.log` (tsc clean).
- Hygiene: `gqr003-git-diff-check.log` (clean), `gqr003-git-status-final.log`; worker receipt `GQR-003-worker-summary.json`.

Implementation notes: `test:server` = `node scripts/build-managed-storage-broker.mjs && npm --prefix packages/server run test` (explicit prerequisite ordering; `--` filters forward to vitest). Client arbitration defers stdin-EPIPE/exit pending-rejections one macrotask so the broker's buffered typed response wins, records unsolicited protocol error lines as the terminal typed diagnostic (missing-root startup), and maps post-death request rejections to it; spawn failures, closed rejections, and absent-broker behavior stay fail-closed.

### GQR-004: Provider runtime composition and administration — COMPLETE

Depends on: GQR-002, GQR-003

- [x] Add a test/sandbox-only deterministic provider bootstrap that refuses production startup.
- [x] Exercise fake provider through the real mounted `/api/document-integrations` composition.
- [x] Persist/load authoritative connection state, policies, and destinations for sandbox fixtures.
- [x] Add redacted provider-admin status endpoint.
- [x] Make DocsSettings API-backed.
- [x] Add Microsoft 365 card and capability-honest unsupported mutation states.
- [x] Keep Google/Local/Microsoft write gates fail closed.

Implementation (four scoped commits, strict RED→GREEN each):

- `b77ce59` — fixture store (`document_provider_{connections,policies,destinations}`, idempotent additive tables, typed rejection of invalid fixture values) + `sandbox-runtime.ts` (mode resolution: production / sandbox-active via NODE_ENV=test or non-production `ENTITY_DOCUMENT_PROVIDER_SANDBOX=1` / inactive; `activateSandboxDocumentProviders` throws typed `SandboxProviderRuntimeRefusedError` in production — even with the flag set — and in non-opted dev; `composeDocumentProviderRuntime` stays fail closed and reports `sandboxBootstrap: refused` for a production sandbox request). Fake adapters boot per provider with an enabled connection fixture; providers without fixtures stay undefined (fail closed).
- `564914b` — `GET /api/document-integrations/admin/status`: workspace-scoped, structurally redacted per-provider status (adapter registration, connection state, fail-closed effective write mode via the exact `resolvedWriteMode` predicate, approved destinations as display metadata with `externalId` omitted, capability-honest mutation lanes from the active adapter; `unknown` when no adapter — health never fabricated). Redaction proven by recursive key allowlist; fail-closed modes never touch the fixture store; unresolvable workspace → typed `WORKSPACE_REQUIRED`.
- `4600b2d` — `mountDocumentIntegrations` helper (migration + registry + composed runtime + admin status router + T-008 router) now used by `index.ts` AND the integration suite, so the tested mount is literally the production mount. Composition suite: create→get→mutate→versions + idempotent replay over HTTP with persisted fixtures; write gates fail closed per provider (google: 409 DESTINATION_REQUIRED / 403 WRITE_DISABLED; microsoft: typed 503 without fixture, 403 without admin authorization; local: create_only blocks mutation; unapproved destination → 422 with no fallback). Live dev-server proof on localhost (isolated temp DB): sandbox status active, HTTP 201 create / 200 mutation, typed 503 microsoft, and NODE_ENV=production + flag → `sandboxBootstrap: refused` + typed 503.
- `cc84e87d` + refactor `dccb411` — DocsSettings API-backed: new `docsProviderStatus` pure mapper + `ProviderAdminCards`; staged local-only write-gate state removed; Microsoft 365 card added; `ProviderSettings` gains `unknown` connection state and an Agent-mutation-support section (Supported / Not supported / Degraded (connection impaired) / Unavailable (no capability evidence) — never upgraded); unreachable status API → honest fail-closed defaults + diagnostic. Browser proof (real Chromium, sandbox server, seeded fixtures): 10/10 PASS with screenshot.

Verify:
- [x] runtime-composition integration suite (`runtime-composition.test.ts` 9/9)
- [x] DocsSettings/ProviderSettings UI suites (app 553/553 incl. new docsProviderStatus 9, DocsSettings 4, ProviderSettings +4)
- [x] no network, secrets, or external writes (fixtures carry no secret columns; structural redaction tested)
- [x] production fake-provider guard test (typed refusal + fail-closed compose + live production posture)

Evidence (Node 22.22.3, `receipts/`): RED `gqr004-bootstrap-RED.log`, `gqr004-admin-status-RED.log`, `gqr004-composition-RED.log`, `gqr004-app-RED.log`; GREEN `gqr004-bootstrap-GREEN.log` (10/10), `gqr004-bootstrap-neighbors-GREEN.log` (62/62), `gqr004-admin-status-GREEN.log` (6/6), `gqr004-composition-live-api.log` (live HTTP), `gqr004-app-GREEN.log` (15/15), `gqr004-app-full-final-GREEN.log` (551/551), `gqr004-docs-settings-browser.log` + `GQR-004-evidence/browser/` (Chromium 10/10 PASS + screenshot); full gates `gqr004-A-full-server-GREEN.log` (2615), `gqr004-B-full-server-GREEN.log` (2621), `gqr004-C-full-server-GREEN.log` (2630), `gqr004-full-server-FINAL-GREEN.log` (2630/2630), `gqr004-refactor-full-server-GREEN.log` (2630/2630) `gqr004-release-deploy-GREEN.log` (133/133), `gqr004-server-build-FINAL-GREEN.log`, `gqr004-app-build-final-GREEN.log`. Worker receipt: `receipts/GQR-004-worker-summary.json`.

### GQR-005: GitHub and S3 connector contracts

Depends on: GQR-002, GQR-004

- [x] Introduce injectable clients and shared adapter contract tests. (`adapter-contract.ts` harness: capabilities truthfulness, root/subtree path bounds, traversal rejection, exact known-file reads, unknown-file rejection, read-only enforcement, secret-redaction scanning; self-test proves every violation class.)
- [x] GitHub: tree/read, pagination, path bounds, bearer redaction, typed auth/rate/5xx behavior, cache policy. (`github.ts` + `github-client.ts` over injectable `GitHubClient`: paged tree walks with typed pagination guard, subtree scoping, defense-in-depth bearer redaction, canonical `githubErrorFromStatus` auth/rate/5xx/404 mapping, bounded reads, explicit opt-in memory cache policy — default none.)
- [x] S3: URI parsing, ListObjectsV2 pagination, bounded GetObject, traversal rejection, ETag/version normalization, typed auth/not-found/throttle behavior. (`s3.ts` + `s3-client.ts` over injectable `S3Client`: `s3://` prefix normalization, continuation-token pagination with typed guard and out-of-scope key filtering, bounded GetObject via shared limiter, ETag/version-id normalization, canonical `interpretS3Response` auth/not-found/throttle mapping from status + XML `<Code>`.)
- [x] Decide from source authority whether live connectors ship now or remain truthful Coming soon. Decision: **remain Coming soon.** No repository authority requires live connectors (MC-FILE-SYSTEM-IMPROVEMENT.md lists "GitHub/S3 connectors beyond basic stubs" as deferred connector expansion; entity-phase-2-integration-boundary-inventory.md records them as placeholder adapters). Boundary recorded in `registry.ts`: complete synthetic contracts exist (`github.ts`, `s3.ts` + injectable clients), no networked client ships, registry keeps the fail-closed 501 `CONNECTOR_NOT_IMPLEMENTED` placeholder, and the UI keeps the truthful "Not available in this build" badge. Shipping a live client later requires: a real transport implementation behind the existing client interfaces, credential handling authority, and re-review of the GQR-002 truthful-availability contract.

Verify:
- [x] deterministic fake client suites (github.contract 27/27, s3.contract 24/24, adapter-contract 11/11; fakes only — zero live network)
- [x] no credentials or live network (synthetic tokens exist only as test literals; redaction proven; no fetch/network code shipped in client modules)
- [x] unavailable/ready UI truthfulness (registry placeholders unchanged; registry.test.ts + GQR-002 app availability suites still green — no app changes needed)

Commits: `ae41ced` (contract harness), `46f6276` (GitHub), `c34222f` (S3). Evidence in `receipts/gqr005-*`.

### GQR-006: QA harness correction and final closure

Depends on: GQR-001..GQR-005

Local implementation/artifact-gate subphase COMPLETE at `032750a` (five scoped commits, strict RED→GREEN each). Remaining items are manager-controlled (review → PR/CI/merge → sandbox deploy → Geordi reruns).

Luna-high review of `dd35dcf` returned CHANGES_REQUESTED with exactly one actionable blocker: `assertEvidenceQuote` accepted any fabricated quote that merely matched two shape regexes, and the CLI hardcoded the quote without proving it appears in the loaded historical report. Bounded repair (single save-point atop `dd35dcf`, strict RED→GREEN):

- [x] Added failing regressions first (`receipts/gqr006-repair-evidence-provenance-RED.log`, Node 22.22.3, HEAD `dd35dcf`, 4 expected failures / 10 pre-existing passing): a regex-matching but unrecorded quote must be refused; missing cited evidence content must fail closed; the quote must bind to the evidence file the corrected row itself cites; the CLI must refuse to write a superseding report when the hardcoded quote is not recorded in the cited evidence file.
- [x] Enforced quote provenance in `buildSupersedingReport`: the loaded content of the cited evidence file is required (fail closed) and the quote must occur — exact or whitespace-normalized, in raw text or parsed JSON string values — before any FAIL→`INVALID_PREREQUISITE` reclassification. The CLI now loads every cited evidence file from the historical report's own run directory (path-contained; unreadable or escaping citations refuse) and passes the content for proof. Grading is not weakened: shape regexes remain, the non-FAIL guard remains, and no PASS can be claimed.
- [x] Regeneration check: committed artifact regenerated from the untouched historical report and verified byte-identical (json+md), so no committed output change; historical report sha256 `70490b77…c1f51` preserved verbatim before/after (`receipts/gqr006-repair-artifact-regeneration-check.log`).

Repair evidence: `receipts/gqr006-repair-evidence-provenance-RED.log` → `-GREEN.log` (14/14), full harness `receipts/gqr006-repair-geordi-qa-full-GREEN.log` (58/58, exit 0). Worker receipt updated in `receipts/GQR-006-worker-summary.json` (repair subphase entry).

Luna-high rereview of `4776914` returned CHANGES_REQUESTED with exactly one actionable blocker: `loadCitedEvidenceContent` enforced only lexical path containment, so an in-run symlink could resolve outside the historical run before `readFile`. Bounded repair2 (single save-point atop `4776914`, strict RED→GREEN):

- [x] Added failing CLI regression first (`receipts/gqr006-repair2-symlink-RED.log`, Node 22.22.3, HEAD `4776914`, 1 expected failure / 14 pre-existing passing): a cited evidence path that is lexically inside the run but is a symlink to an outside file that genuinely records the hardcoded quote must be refused with no superseding output. The RED log records the vulnerability exactly: the CLI exited 0 and wrote the superseding report from outside-the-run evidence.
- [x] Enforced realpath containment in `loadCitedEvidenceContent`: the run directory is realpath'd once and every citation's realpath must stay inside it before `readFile` (which reads the proven realpath); missing/unreadable citations still fail closed with the same messages, lexical escape rejection unchanged. `buildSupersedingReport` and its pure builder contract are untouched; grading not weakened.

Repair2 evidence: `receipts/gqr006-repair2-symlink-RED.log` → `-GREEN.log` (15/15), full harness `receipts/gqr006-repair2-geordi-qa-full-GREEN.log` (59/59, exit 0), artifact regeneration `receipts/gqr006-repair2-artifact-regeneration-check.log` (CLI exit 0 against the real historical run; regenerated json+md byte-identical to the committed artifact, no committed output change; historical report sha256 `70490b77…c1f51` preserved verbatim before/after). Worker receipt updated in `receipts/GQR-006-worker-summary.json` (repair2 entry).

- [x] Add deterministic browser fixtures for admin navigation, task/Handoffs, provider preview, refresh, mobile viewport, and external document metadata. (`scripts/geordi-qa/fixtures.mjs` + `fixtures/*.json`: closed id set, complete-shape validation, secret-like-key and base64 rejection, deterministic JSON; Users & Access activation, GEORDI-QA synthetic task with mandatory cleanup, honest provider-state vocabulary, reload-unavailable recovery path, 390px BLOCKED fallback, pinned metadata with `matchMode: semantic`.)
- [x] Correct Geordi I2 from contract FAIL to invalid prerequisite/setup classification in the superseding report. (`supersede-report.mjs`: FAIL → `INVALID_PREREQUISITE`, guarded by the recorded broker-absence evidence quote; refuses non-FAIL rows and out-of-directory writes; counts recomputed without ever claiming a pass. Committed artifact `docs/reports/geordi-qa/20260826T103159Z-rerun1/superseding-report.{json,md}` generated from the untouched historical report, sha256 `70490b77…c1f51` — historical evidence preserved, no receipts rewritten.)
- [x] Make progress state live and watchdog self-pause at terminal. (`progress-state.mjs`: atomic tmp+rename writes stamping `lastProgressTime` on every transition, idempotent lanes, monotonic percent, final terminal states, `complete` requires 100%. `watchdog.mjs`: observes/stalls-only, self-pauses with a structured receipt at terminal.)
- [x] Verify source cleanliness from the source cwd. (`source-cleanliness.mjs`: realpath checkout, every git invocation with cwd = source path, refuses non-root paths. Live proof `gqr006-source-cleanliness-live.log`: this worktree clean at `7d97b6e` from its own cwd.)
- [x] Make compact-index payload checks semantic, not substring checks against metadata. (`compact-index.mjs`: structural field equality, prefix-path trap diagnosis, lane allowlist, base64-free; historical rerun1 index 159/159 entries self-consistent with zero violations.)
- [x] Run focused tests, full tests, build, private scan, OpenWiki freshness, `ctrl:full`/`ctrl:gate` as available. (Focused `test:geordi-qa` 54/54; server 2699/2699; app 553 suite + build; db 214/214; release-deploy 133/133; wiki-html 16/16; `ctrl:gate` PASS; private scan exit 0 errors 0 — 273 warnings incl. 13 new `enterprise-agent-name` warns from the mandated Geordi harness naming, none suppressed; OpenWiki regenerated at the final integration gate — verify PASS at fingerprint `816b1263…c15c12`, 24 HTML pages.)
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

- GQR-003 repair: `packages/server/src/fs/managed-storage-broker.ts` (+ `managed-storage-broker.test.ts`)
- GQR-004: `packages/server/src/document-providers/fixture-store.ts` (+ `fixture-store.test.ts`), `packages/server/src/document-providers/sandbox-runtime.ts` (+ `sandbox-runtime.test.ts`), `packages/server/src/routes/provider-admin-status.ts` (+ `provider-admin-status.test.ts`), `packages/server/src/routes/document-integrations-mount.ts`, `packages/server/src/document-providers/runtime-composition.test.ts`, `packages/server/src/index.ts`, `packages/app/src/components/settings/docsProviderStatus.ts` (+ test), `packages/app/src/components/settings/DocsSettings.tsx` (+ `DocsSettings.test.ts`), `packages/app/src/components/document-integrations/ProviderSettings.tsx` (+ test), `packages/app/scripts/gqr004-docs-settings-ui-proof.mjs` (new)
- GQR-003: `package.json` (root `test:server` + `test:release-deploy` wiring), `scripts/entity-test-server-entrypoint.test.mjs` (new), `packages/server/src/fs/managed-storage-broker.ts` (+ `managed-storage-broker.test.ts`), `AGENTS.md`, `CONTEXT.md`, `docs/plans/ACTIVE_PLAN.md`

- GQR-002: `packages/server/src/fs/errors.ts`, `packages/server/src/fs/adapters/registry.ts` (+ `registry.test.ts`), `packages/server/src/fs/routes-files.ts` (+ test), `packages/server/src/fs/routes-sources.ts` (+ test), `packages/app/src/types/filesystem.ts`, `packages/app/src/lib/sourceAvailability.ts` (+ test), `packages/app/src/components/SourceUnavailableBadge.tsx` (new), `packages/app/src/components/SourceFileTree.tsx` (+ test), `packages/app/src/components/settings/FileSourcesSettings.tsx`, `packages/app/scripts/gqr002-file-sources-ui-proof.mjs` (new)

- GQR-002 repair: `packages/server/src/fs/routes-sources.ts` (+test), `packages/server/src/fs/routes-search.ts` (+test), `packages/app/src/lib/sourceAvailability.ts` (+test), `packages/app/src/components/settings/FileSourcesSettings.tsx` (+ `FileSourcesSettings.test.ts` new), `packages/app/src/components/SourceFileTree.tsx` (+test), `packages/app/scripts/gqr002-repair-ui-proof.mjs` (new)
- GQR-005: `packages/server/src/fs/adapters/adapter-contract.ts` (+ `adapter-contract.test.ts`), `packages/server/src/fs/adapters/github-client.ts`, `packages/server/src/fs/adapters/github.ts` (+ `github.contract.test.ts`), `packages/server/src/fs/adapters/s3-client.ts`, `packages/server/src/fs/adapters/s3.ts` (+ `s3.contract.test.ts`), `packages/server/src/fs/adapters/types.ts` (additive optional etag/versionId), `packages/server/src/fs/adapters/registry.ts` (boundary comment only; placeholder behavior unchanged)
- GQR-006: `scripts/geordi-qa/` (new: `fixtures.mjs` + `fixtures.test.mjs` + six `fixtures/*.json`, `progress-state.mjs` (+test), `watchdog.mjs` (+test), `source-cleanliness.mjs` (+test), `compact-index.mjs` (+test), `supersede-report.mjs` (+test), `README.md`), `docs/reports/geordi-qa/20260826T103159Z-rerun1/superseding-report.{json,md}` (new generated artifact), `package.json` (`test:geordi-qa` script), `openwiki/` + `openwiki-html/` (final-gate regeneration), `docs/plans/ACTIVE_PLAN.md` + `docs/plans/2026-08-26-geordi-remediation-plan.md`
- GQR-006 repair: `scripts/geordi-qa/supersede-report.mjs` (+ `supersede-report.test.mjs`, `README.md` provenance note), `docs/plans/ACTIVE_PLAN.md`; committed superseding artifact unchanged (regenerated byte-identical)
- GQR-006 repair2: `scripts/geordi-qa/supersede-report.mjs` (realpath containment in `loadCitedEvidenceContent`; + `supersede-report.test.mjs` escaping-symlink CLI regression, `README.md` containment note), `docs/plans/ACTIVE_PLAN.md`; committed superseding artifact unchanged (regenerated byte-identical)

## Resume

Read this file, runtime `state.json`, exact process tree/log tail, `git status`, and the first unchecked queue item. Never relaunch if one matching owner exists.
