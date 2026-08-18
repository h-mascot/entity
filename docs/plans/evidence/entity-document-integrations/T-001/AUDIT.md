# T-001 — Clean implementation worktree and audit base

Issue: THE-942 ([LOOM-DOCS T-001] Create clean implementation worktree and audit base)
Run marker: `loom-run:entity-doc-integrations-20260809`
Worker model: `citadel/daystrom/deepseek` (medium) — pinned externally, not substituted.

## 1. Audited SHA and worktree state

| Item | Value |
| --- | --- |
| Pre-issue HEAD (audited SHA) | `d052d3c754d0ad84241b7358ddbffe5035ec0778` |
| Branch | `runner/entity-document-integrations-20260818` |
| Current base (`origin/main` at runner creation) | `bdb57421b59bc2739ad5ba9f08a7cc0a57616d83` |
| Working tree | Clean (`git status --short` → empty) at audit time |
| Diff origin/main..HEAD | 8 files, all `docs/loom/…` + `.cursor/rules/…` + `docs/loom/…/*.md` — NO source code changes |

The 2 commits ahead of origin/main are the planning bootstrap doc commits only
(`7e90b83 docs(loom): stage preserved Oracle PRD` and
`d052d3c docs: bootstrap native office loom context`). No implementation code exists yet.
The known dirty operator checkout from the planning run was **not** incorporated — this
worktree is the isolated clean implementation surface.

## 2. Canonical source integrity

| Artifact | SHA-256 | Expected | Match |
| --- | --- | --- | --- |
| `docs/loom/entity-document-integrations/phase2-canonical-prd.md` | `83cacbc51a1eb15649d6e0a17759e2115a3c2185a93b7c4532001beee2527137` | same | ✅ |

The canonical PRD hashes byte-identical to the pinned SHA in BUILD-CONTEXT and the runner
plan. No drift detected.

## 3. High-value path audit (issue scope: named paths)

### 3.1 `docs/loom/entity-document-integrations/phase2-canonical-prd.md`
Canonical PRD present, SHA verified (section 2). Downstream implementation authority is
Sections 26–27, T-001..T-040.

### 3.2 `docs/loom/entity-document-integrations/BUILD-CONTEXT.md`
Binding architecture corrections confirmed against current repo evidence (see 3.4–3.6):
- `/api/document-integrations` default (no sibling route yet).
- `document_integration_events` (NOT `document_events` — see 3.6).
- `document-providers` module name (NOT `provider-registry/` — see 3.5).
- Creation idempotency must use an operation-scoped store.
- Receipts attach to `packages/server/src/receipt-writer.ts` (canonical, see 3.4).
- Flags use `packages/server/src/phase2-flags.ts` (canonical, see 3.4).

### 3.3 `.project-gate.json`
- `proofCommands`: `cd packages/server && npm run build && npx vitest run`,
  `npm run build`, `bash scripts/proof/entity-phase-2-smoke.sh`.
- Gate 8 is enforced by repo policy: main-merge/production-promotion are forbidden in this
  run (`runner-state.json` → `authority.productionAllowed=false`,
  `mergeToMainAllowed=false`).
- `scanExcludePaths` excludes `.env*`, `data`, `output`, `evidence`, and `.github/workflows`
  from private-default scanning.

### 3.4 `packages/server/src/phase2-flags.ts` (canonical flag host — confirmed)
- Exports `PHASE2_FLAG_DEFINITIONS` with fields `key, envVar, defaultEnabled, category,
  surface, stage, description` under the `ENTITY_PHASE2_*` env convention.
- Existing keys: `receipt_completion_enforcement` (default on), `review_gate_policy_enforcement`
  (on), `worktype_registry_surface` (on), `migration_enforcement` (off), `search_permission_strictness`
  (on), `taskmaster_automation` (on).
- `Phase2FlagSnapshot` / `Phase2FlagDiagnostics` types present. Colocated `phase2-flags.test.ts` passes.
- **Conclusion:** this is the canonical host for the doc write gates, as BUILD-CONTEXT says.
  No competing flag host needed.

### 3.5 `packages/server/src/receipt-writer.ts` (canonical receipt writer — confirmed)
- Exports `hashCanonicalReceiptMarkdown`, `buildCanonicalReceiptMarkdown`,
  `completeTaskWithReceipt`, `regenerateReceiptMetadataFromBody`.
- Colocated `receipt-writer.test.ts` passes.
- **Conclusion:** document operations must attach activity/receipt proof here. A second
  receipt store is a release blocker (per BUILD-CONTEXT + PRD OQ-019). Confirmed no
  competing store exists.

### 3.6 `packages/server/src/editor/index.ts` + `/api/documents` router
- `registerEditorModule(app, opts)` registers the editor router at `app.use('/api/documents', router)`.
- Auth via `createEditorRouteAuth({ tokenRepository })`; routes in `./routes`; service in `./service`;
  ws broadcaster in `./ws`; review webhooks via `registerEditorReviewWebhookRoutes`.
- `document_events` table is claimed by `packages/server/src/routes/agent-api.ts`
  (`CREATE TABLE IF NOT EXISTS document_events`, plus INSERT/poll/ack logic).
  **Conclusion:** the provider-neutral Document Integrations API must use
  `document_integration_events` and must NOT reuse or redefine `document_events`, and must
  NOT silently extend the `/api/documents` editor namespace (use `/api/document-integrations`).

### 3.7 `packages/server/src/provider-registry/` (named-avoidance — confirmed)
- This directory is the **inference** provider registry: `inference_provider_profiles`,
  `inference_provider_models`, `inference_provider_model_capabilities`,
  `inference_provider_bindings`, `inference_provider_health_checks`,
  `inference_provider_audit_events`, plus its own `migrations`/`migrations.ts`.
- **Conclusion:** document-providers must live under `packages/server/src/document-providers/`
  and persistence tables must be prefixed `document_provider_` (never `provider_` unqualified).
- BUILD-CONTEXT also flags `inference_provider_audit_events` as the OQ-018 fallback audit
  store — document ops still attach to the canonical `receipt-writer.ts`, not a new audit table.

### 3.8 DB / migration conventions (`packages/db/src`)
- TypeScript-only src (no committed `.js` — confirmed `packages/db/src/*.js` absent).
- SQLite via `better-sqlite3` in-process library; DB file resolved via `getEntityDatabase`.
- Additive schema convention; `file-sources.ts` defines `FILE_SOURCE_TYPES`,
  `FILE_SOURCE_HEALTH`, `FileSourceAuthType`, `FileSourceRecord`.
- `document-objects.ts` (server) already binds Google external-doc metadata
  (`google-docs-metadata.ts`, `buildGoogleExternalDocumentMetadata/Open`),
  permission filtering (`request-permissions.ts`, `ensureObjectPermission`,
  `ensureRequestOrgMatches`, `permissionSafeRecord`, `requireRequestOrg`),
  and `ExternalDocumentRefRecord` / `DocumentObjectRepository` live in `packages/db/src`.
- **Conclusion:** T-003 persistence goes into `packages/db/src/document-integrations.ts`
  (additive), gated by `document_provider_` table prefix.

### 3.9 Auth / tenant-isolation conventions
- `packages/server/src/request-permissions.ts` centralizes org matching + permission-safe
  records + permission actions. Editor auth uses a token repository. Tenant isolation is
  enforced through `requireRequestOrg`/`ensureRequestOrgMatches`. T-008 route wiring must
  reuse this boundary. Colocated `request-permissions.test.ts` / `permissions.test.ts` pass.

### 3.10 File Source, search, association conventions
- File Source routes: `packages/server/src/routes/docs.ts`, `legacy-files.ts`,
  `scoped-search.ts`, `scoped-search-documents.ts`; DB layer `packages/db/src/file-sources.ts`
  and `file-index.ts`.
- Search permission strictness is already a Phase 2 flag (`search_permission_strictness`,
  default on) — search/associations must remain permission-filtered before render.
- `scoped-search-documents.ts` exists as the scoped doc search surface (T-011 path).

## 4. Baseline proof (T-001: existing baseline tests pass before feature work)

Node runtime: `v22.22.2` (nvm) — required for native `better-sqlite3` / `node-pty` builds.
NOTE: the machine default is Node v26.5.0 which **fails** native module compilation
(`better-sqlite3`). All proof below uses Node 22. This is an environment prerequisite to
record, not a repo defect.

| Command | Result |
| --- | --- |
| `git status --short` | clean (empty) ✅ |
| `git rev-parse HEAD` | `d052d3c…` ✅ |
| `git diff --check` | clean ✅ |
| `cd packages/server && npm run build` | pass ✅ |
| `cd packages/server && npx vitest run` (full) | **202 files / 1701 tests pass** ✅ |
| Focused doc-relevant vitest (docs, doc-intelligence, phase2-flags, receipt-writer, request-permissions, file-types, document-objects, google-docs-metadata) | 8 files / 64 tests pass ✅ |
| `npm run build` (root: app+db+server) | pass ✅ |
| `npm run ctrl:gate` | **pass** (TAP 493 + db 148 + server 1701) ✅ |
| `npm run scan:private-defaults -- --enforce` | errors=0; 240 pre-existing baseline warnings (not rewritten) ✅ |
| `npm run test:release-deploy` | 14 pass ✅ |
| `npm run test:wiki-html` | 15 pass ✅ |
| `npm run docs:wiki:verify` | **FAILS — pre-existing** (see §5) ⚠️ |
| `bash scripts/proof/entity-phase-2-smoke.sh` | PASS ✅ |

## 5. Documented discrepancies with the source packet

1. **OpenWiki staleness (`npm run docs:wiki:verify` FAIL).**
   `openwiki/.entity-openwiki.json` `sourceFingerprint` `36ae62d1…` does not match the
   current branch source fingerprint. The branch is ahead of `origin/main` by 2 git-tracked
   planning-doc commits; OpenWiki's fingerprint hashes all tracked files, so any added
   tracked file (or pre-existing state) changes it. This is **not** a code regression from
   T-001 (working tree clean, no source edits). OpenWiki regenerates at delivery time via
   `npm run docs:wiki:prepare` / `docs:wiki:update`; it is a generated-doc freshness check,
   not a code gate. Recorded as a baseline gap, to be refreshed by the owning delivery step
   (per OpenWiki repo policy, do not hand-edit generated OpenWiki pages).

2. **Private-default scan warnings at baseline (240).** `manual scan:private-defaults
   -- --enforce` exits with `errors=0` but reports 240 warning-level `findings`. These are
   the pre-existing baseline; `--write-baseline` was intentionally NOT run (that would mutate
   `docs/reports/private-default-scan-baseline.md` and is outside T-001 audit scope). The
   gate (enforce) passes. No T-001 change introduced any new private-default finding.

3. **No runtime `entity.config.yaml` / `.env` present** in this worktree (both gitignored and
   absent). Not required for T-001's read-only audit / test baseline. No credentials were
   copied into any artifact (PRIVACY satisfied).

## 6. Decision — canonical hosts confirmed by audit (answers to PRD/BUILD-CONTEXT questions)

| BUILD-CONTEXT binding | Audit confirmation |
| --- | --- |
| Flag host = `phase2-flags.ts` | ✅ confirmed (3.4) |
| Receipts attach to `receipt-writer.ts` | ✅ confirmed (3.5) |
| Event table = `document_integration_events` | ✅ `document_events` claimed by agent-api (3.6) |
| Module = `document-providers` (not `provider-registry/`) | ✅ confirmed (3.7) |
| API = `/api/document-integrations` | ✅ no sibling route; do not extend `/api/documents` (3.6) |
| Persistence prefix = `document_provider_` | ✅ confirmed (3.7, 3.8) |

## 7. Changes made

This ticket is an audit/foundation ticket: **no feature implementation, no source changes.**
The only file created is this evidence bundle under the mandated evidence destination. This
keeps the diff reversible and consistent with the non-goals (feature implementation).

## 8. Reviewer record

To be appended by the reviewer run:
`review-current.zsh THE-942 d052d3c754d0ad84241b7358ddbffe5035ec0778 <CANDIDATE_SHA>`
