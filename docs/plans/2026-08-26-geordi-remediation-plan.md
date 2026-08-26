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

### GQR-002: Truthful unavailable File Sources

Depends on: GQR-001

- [ ] Add failing server tests for typed `CONNECTOR_NOT_IMPLEMENTED` and non-500 mapping.
- [ ] Add failing app tests proving unavailable sources are not expandable/actionable.
- [ ] Set placeholder capabilities false.
- [ ] Return typed 501 or typed 503, never generic 500.
- [ ] Show `Not available in this build`; preserve Admin diagnostics.
- [ ] Hide unsupported source types from Add Source or label Coming soon.

Verify:
- FS adapter/route/hook/tree/settings focused tests
- 401/403 cache protections remain green
- live sandbox Files proof after deployment

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

## Resume

Read this file, runtime `state.json`, exact process tree/log tail, `git status`, and the first unchecked queue item. Never relaunch if one matching owner exists.
