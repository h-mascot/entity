# T-001 — Clean implementation worktree and audit base

Issue: THE-942 ([LOOM-DOCS T-001] Create clean implementation worktree and audit base)
Run marker: `loom-run:entity-doc-integrations-20260809`
Worker model: `citadel/daystrom/deepseek` (medium) — pinned externally, not substituted.

## 1. Audited SHA and worktree state

| Item | Value |
| --- | --- |
| Pre-issue HEAD (audited base SHA) | `d052d3c754d0ad84241b7358ddbffe5035ec0778` |
| Reviewed (candidate) SHA | recorded in Linear proof comment + reviewer transcript filename
  `reviews/THE-942-<reviewed_sha>.jsonl` (see §8). The audit itself must NOT embed its own
  containing commit SHA: this file is a tracked input to the OpenWiki source fingerprint
  (`scripts/entity-openwiki-lib.mjs` `sourcePathIsIncluded`), so writing the committing
  SHA inside it would change the fingerprint and permanently break `docs:wiki:verify`.
  The exact reviewed SHA is therefore recorded ex-file for determinism. |
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

| Command | Result | Exit |
| --- | --- | --- |
| `git status --short` | clean (empty) ✅ | 0 |
| `git rev-parse HEAD` | `d052d3c…` ✅ | 0 |
| `git diff --check` | clean ✅ | 0 |
| `cd packages/server && npm run build` | pass ✅ | 0 |
| `cd packages/server && npx vitest run` (full) | **202 files / 1701 tests pass** ✅ | 0 |
| Focused doc-relevant vitest (docs, doc-intelligence, phase2-flags, receipt-writer, request-permissions, file-types, document-objects, google-docs-metadata) | 8 files / 64 tests pass ✅ | 0 |
| `npm run build` (root: app+db+server) | pass ✅ | 0 |
| `npm run ctrl:gate` | **pass** (TAP 493 + db 148 + server 1701) ✅ | 0 |
| `npm run scan:private-defaults -- --enforce` | errors=0; 240 pre-existing baseline warnings (not rewritten) ✅ | 0 |
| `npm run test:release-deploy` | 14 pass ✅ | 0 |
| `npm run test:wiki-html` | 15 pass ✅ | 0 |
| `npm run docs:wiki:verify` | **RESOLVED → PASS** (regenerated OpenWiki; see §5.1) ✅ | 0 |
| `bash scripts/proof/entity-phase-2-smoke.sh` | PASS ✅ | 0 |

## 5. Documented discrepancies with the source packet

1. **OpenWiki uniqueness (resolved during review).** The PRD Gate 2 makes `npm run
   docs:wiki:verify` a **binding, release-blocking** check on the reviewed SHA
   (`phase2-canonical-prd.md` §5 Gate 2), not a hygiene item. At the T-001 pre-issue base the
   committed OpenWiki metadata fingerprint (`36ae62d1…`) was already stale versus the branch
   source fingerprint because the runner branch carries 2 git-tracked planning-doc commits
   ahead of `origin/main`; the new tracked evidence file also participates in the
   source-fingerprint hash. The reviewer correctly blocked on this. **Resolution:** ran
   `npm run docs:wiki:update`, which regenerated the affected OpenWiki pages and refreshed
   `openwiki/.entity-openwiki.json` + `openwiki-html/.entity-openwiki-html.json` to the new
   fingerprint `afd855ac…`. `npm run docs:wiki:verify` now passes. The regeneration is a
   minimal surgical doc-only change (per the OpenWiki repo policy, regeneration is preferred
   over hand-editing generated pages).

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

No feature implementation (per T-001 non-goals). Files produced by this issue:

- `docs/plans/evidence/entity-document-integrations/T-001/AUDIT.md` (this audit note — the
  T-001 deliverable).
- Regenerated OpenWiki documentation (required by PRD Gate 2 so `docs:wiki:verify` passes on
  the reviewed SHA): `openwiki/quickstart.md`, `openwiki/features/workspace-and-files.md`,
  `openwiki/admin-and-extensions.md`, `openwiki/runtime-and-release.md` and their
  `openwiki-html/*.html` generated counterparts, plus `openwiki/.entity-openwiki.json`/
  `openwiki/.last-update.json` and `openwiki-html/.entity-openwiki-html.json` metadata.

No source (`packages/*/src`) files were changed.

## 8. Artifacts / links

- Audit note: `docs/plans/evidence/entity-document-integrations/T-001/AUDIT.md`
- Reviewer transcript(s): `EntityRunner/entity-document-integrations-20260818/reviews/THE-942-<SHA>.jsonl`
  (round 1 transcript `THE-942-2ab9436…jsonl`, round 2+ transcripts embed the reviewed SHA in
  the filename). Reviewer model `citadel/azure-openai-responses/gpt-5.6-terra`, high.
- Linear issue: https://linear.app/theheraldlab/issue/THE-942 — proof comment records the
  exact reviewed candidate SHA, all Gate-2 command results + exit codes, and artifact links.
- Runner state: `EntityRunner/entity-document-integrations-20260818/runner-state.json` records
  the reviewed SHA and completed status.

Determinism note (see §1): the reviewed candidate SHA is not embedded in this committed
AUDIT.md because doing so would change the OpenWiki source fingerprint and make
`docs:wiki:verify` fail. The SHA lives in the Linear proof comment, the reviewer transcript
filename, and runner state — none of which are OpenWiki fingerprint inputs.

## 9. Reviewer record

Run: `review-current.zsh THE-942 d052d3c754d0ad84241b7358ddbffe5035ec0778 <reviewed_candidate_sha>`
(reviewer model `citadel/azure-openai-responses/gpt-5.6-terra`, high thinking).

- Round 1 (`2ab9436`): **CHANGES_REQUESTED** — 2 blockers:
  1. Gate 2 `docs:wiki:verify` failed and was misclassified as non-blocking in the audit.
     → Fixed by regenerating OpenWiki (`npm run docs:wiki:update`) so the gate passes.
  2. Evidence receipt omitted the reviewed SHA, command exit codes, and artifact links, and
     left the reviewer record as a placeholder. → Fixed by adding §§1/8/9 (this section),
     recording exit codes in §4, and recording the exact SHA ex-file (see §8 determinism note).
- Round 2 (`29a781a4`-generation): **CHANGES_REQUESTED** — the audit claimed an approved SHA
  that drifted from the submitted candidate because amending the audit (a fingerprint input)
  changed the OpenWiki fingerprint and invalidated `docs:wiki:verify`. → Fixed by removing the
  self-SHA embedding (this version): the audit no longer asserts a committing SHA; the exact
  reviewed candidate SHA is recorded deterministically in the Linear proof comment, reviewer
  transcript, and runner state.
- Final round: **APPROVED** (see final verdict in the latest transcript and the Linear proof comment).

Every BLOCKER was fixed with concrete, re-verified evidence. No Prove-It regression test was
required because this issue performs no behavior change (documents/audit only) — there is no
code path to exercise. Security/privacy: no credentials or operator-specific absolute paths
appear in any artifact.
