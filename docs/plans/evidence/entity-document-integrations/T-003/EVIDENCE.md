# T-003 — Define and migrate unified document persistence

Issue: THE-944 ([LOOM-DOCS T-003] Define and migrate unified document persistence)
Run marker: `loom-run:entity-doc-integrations-20260809`
Worker model: `citadel/daystrom/deepseek` (medium) — pinned externally, not substituted.
Branch: `runner/entity-document-integrations-20260818`
Pre-issue reviewed base (T-002 approved HEAD): `f8fb9fd7636c92f3a0074257fa6673e31c0e492e`
Node: `nvm use 22` (v22.22.2) — required for better-sqlite3 native bindings (Node 26 `ERR_DLOPEN_FAILED`).

## 1. Acceptance requirement (verbatim authority)

Acceptance for this ticket is **R-001 and R-036** (canonical PRD T-003 section:
"Acceptance: R-001 and R-036", "Automated proof: Empty and populated migration fixtures",
"Security: No credential fields", "Not done until: rollback with old application semantics is
documented").

### R-001 — Canonical document object (verbatim)

> Entity must represent every managed document, spreadsheet, or presentation with one provider-neutral document record.

> **Acceptance criteria**
>
> Given any supported Google, Microsoft, or local artifact,
> when Entity registers it,
> then it receives exactly one canonical Entity document ID.
>
> Given an artifact is rediscovered from its provider,
> when the external provider identity already maps to an Entity object,
> then Entity updates the existing record rather than creating a duplicate.
>
> Given a provider URL changes but provider artifact identity does not,
> when Entity synchronizes metadata,
> then the Entity document URL remains stable.
>
> **Validation**
>
> Database uniqueness tests.
> Provider rediscovery integration test.
> Stable URL regression test.
> Duplicate-import concurrency test.

### R-036 — Database migration safety (verbatim)

> The unified model must be introduced without destructively deleting existing Google V1 data during initial rollout.
>
> Migration strategy must provide:
>
> additive schema;
> backfill or lazy registration;
> compatibility period;
> parity validation;
> cutover;
> rollback path.
>
> **Acceptance criteria**
>
> Rolling application code back during the compatibility period does not require recovering dropped legacy data.
>
> **Validation**
>
> Migration-up test.
> Application rollback test.
> Migration on representative populated fixture.

## 2. Scope delivered (named paths)

| Path | Action |
| --- | --- |
| `docs/loom/entity-document-integrations/phase2-canonical-prd.md` | **Read-only authority** — NOT modified. Ruled out this round: T-003 lists it as a named path, but the operator-side authority-pin reconciliation (`83cacbc…` vs in-tree `c82e82d8…`) is pending Henry's decision; per the ticket the in-tree PRD is the read-only authority. |
| `packages/db/src/document-integrations.ts` | Added — additive unified schema + data-access helpers + collision guard + rollback. |
| `packages/db/src/document-integrations.test.ts` | Added — 16 focused tests (RED→GREEN), including empty + populated migration fixtures. |
| `packages/server/src/document-providers/migrations.ts` | Added — server migration helper (apply / verify-collision / reverse / repository). |
| `docs/plans/evidence/entity-document-integrations/T-003/EVIDENCE.md` | Added — this file. |

No change outside these named paths was made (worktree diff at §9).

## 3. What T-003 delivers

Goal/value: **Establish stable Entity document identity.** Delivered, scoped to the four
T-003 sub-areas:

1. **Additive schema** — `document_objects`, `document_associations`, `document_versions`,
   `document_integration_events`, derived verbatim from PRD §11.1–11.4. All `CREATE TABLE IF NOT EXISTS`
   + idempotent; no existing table is altered or dropped.
2. **Provider identity uniqueness** — partial unique index
   `UNIQUE(provider_connection_id, external_id) WHERE external_id IS NOT NULL` on `document_objects`
   (R-001 uniqueness + PRD 11.1). For local artifacts `external_id` carries the durable managed file
   identity, supplying equivalent uniqueness. A stable deterministic Entity id
   (`doc_<hash12>` from the identity tuple) backs R-001 "exactly one canonical Entity document ID";
   `registerDocumentObject` updates an existing record on rediscovery instead of duplicating.
3. **Version/activity requirements** — `document_versions` carries revision/version-id/ETag/change-token
   (snapshot_ref may be null for cloud-authoritative providers); `document_integration_events` records
   attributable activity (event type, actor, provider, operation/receipt/idempotency refs,
   before/after revision, status, sanitized metadata). Distinct from the already-claimed `document_events`
   (MF-02): we never reuse that name.
4. **Migration helpers** — `packages/server/src/document-providers/migrations.ts` exposes
   `applyDocumentIntegrationsMigration`, `checkDocumentIntegrationsCollisions`,
   `reverseDocumentIntegrationsMigration`, `entityDocumentIntegrationsRepository`. The db module owns the
   DDL/collision-guard primitives so the required empty + populated fixtures run under the db test.

Constraints honored: no competing API namespace, no second receipt store (we only store a `receipt_id`
reference to the canonical receipt system per PRD 11.4), no provider registry (module stays out of
`provider-registry/`), no redefinition of `document_events`, no credential fields anywhere, and
reversibility documented via an additive-only migration whose rollback preserves legacy semantics.

## 4. TDD — RED first, then GREEN

### RED (module absent)

```sh
cd packages/db && nvm use 22 && npx vitest run src/document-integrations.test.ts
#  Test Files  1 failed (1)
#  Tests       16 failed (16)
#  Error: Cannot find module './document-integrations' imported from ...document-integrations.test.ts
```

### GREEN (module implemented) — focused suite, 16/16

```sh
cd packages/db && nvm use 22 && npx vitest run src/document-integrations.test.ts
#  Test Files  1 passed (1)
#  Tests       16 passed (16)
```

Proof that the RED→GREEN transition is real: the 16 tests reference only the exported symbols
(`createDocumentIntegrationsRepository`, `documentObjectIdForIdentity`, `DOCUMENT_INTEGRATION_TABLE_NAMES`)
which did not exist before implementation; the first run failed on module resolution (RED), the second
passed after the module was added (GREEN). One follow-up fix was required to reach full GREEN: the
explicit-duplicate `createDocumentObject` needed a loud, descriptive "provider identity already exists"
message (wrapping the raw SQLite UNIQUE-constraint failure) — added with the catch in `createDocumentObject`
and confirmed by the negative-path test that would not have matched the raw SQLite message.

## 5. Migration fixture results (the required automated proof)

### Empty fixture — fresh database

```
apply on empty DB:
  tablesEnsured = document_objects, document_associations, document_versions, document_integration_events
  collision     = { ok: true }
  destructive   = false
second apply (idempotent): collision { ok: true } — no failure, no duplicate
```

### Populated fixture — legacy Google V1 rows present (R-036)

Seeded a representative `external_document_refs` table with two Google connector rows, then applied the
migration:

```
legacy rows before  = 2
apply migration     = success, additiveOnly, destructiveChanges=false
legacy rows after   = 2 (r1/AAA, r2/BBB)  — preserved, not dropped, not altered
document_objects    = created
```

### Collision guard — negative path (MF-02 / PRD 11.4)

Pre-creating an `document_objects` with an incompatible column set causes the migration to **fail loudly**
rather than silently binding to the other consumer's schema:

```
ensureSchema() on incompatible pre-existing document_objects → throws
  "document-integrations schema collision on table 'document_objects': ...incompatible column set"
```

### Cross-codebase collision check (declared table names)

Reserved unified names vs every `CREATE TABLE` declared under `packages/db/src` + `packages/server/src`
(production, test fixtures excluded):

```
document_objects:          1 (in document-integrations.ts)
document_associations:     1
document_versions:         1
document_integration_events: 1
document_events is NOT in the unified set: true
RESULT: NO COLLISION — each unified name declared exactly once
```

Note: `document_objects` appears twice in a raw scan only because the negative-path fixture
(`document-integrations.test.ts:390`) intentionally creates an incompatible table to exercise the guard;
it is not a production schema collision.

### Rollback path (R-036 "not done until")

```
reverse drops ONLY: document_integration_events, document_versions, document_associations, document_objects
legacy rows after rollback = 2  (unchanged)
unified tables remaining   = 0
```

Rolling the application back to pre-T-003 semantics does **not** require recovering dropped legacy data:
the additive unified tables are the only thing removed, and legacy `external_document_refs` /
`native_documents` are never touched, so the old application keeps its original semantics.

### Server migration-helper runtime smoke (compiled `dist`, populated in-memory DB)

```sh
cd packages/server && nvm use 22 && node -e '...'
# collision: {"ok":true,"namesAlreadyCompatible":[]}
# report success: true | additiveOnly: true | tables: document_objects,document_associations,document_versions,document_integration_events
# legacy rows preserved after apply: 1
# reverse drops: ... | legacyPreserved: true
# after rollback legacy rows: 1
# unified tables remaining after rollback: 0
```

## 6. Security / privacy self-check

- **No credential fields/holders.** A negative-path test scans every unified table's DDL and asserts no
  `access_token|refresh_token|client_secret|password|api_key|secret|credential|token` column exists.
- Event metadata is stored only under the `sanitized_metadata_json` column name; ownership and permission
  fields are summaries, never raw credentials or document contents.
- No raw tokens, tenant secrets, document contents, or operator-specific absolute paths appear in the
  schema, code, tests, fixtures, or this evidence. (The only paths below are relative repo paths.)

## 7. Schema-review self-check (manual proof)

- [x] Every logical field listed under R-001 ("Required logical fields") is represented in
  `document_objects` (Entity id; workspace; provider; artifact type; title; external id; provider URL;
  destination; associations table; ownership summary; tenant binding; permissions summary; sensitivity;
  auth state; readiness/degraded; revision; provider modified time; indexed time; preview state;
  conflict state; created/updated). Negotiated capabilities and activity are represented in
  `document_versions` / `document_integration_events` (activity table) — capability negotiation itself is
  T-006/T-002 and is not re-implemented here.
- [x] `(provider_connection_id, external_id)` uniqueness enforced only when `external_id IS NOT NULL`
  (SQLite partial unique index) — matches PRD 11.1 exactly.
- [x] CHECK constraints for provider and artifact_type match the canonical vocabularies.
- [x] `document_integration_events` is used, never `document_events` (MF-02).
- [x] Both `document_versions.document_id` and `document_integration_events.document_id` FK to
  `document_objects(id)` (integrity test proves a version for a missing document is rejected).
- [x] Exact SQLite types follow repository conventions (TEXT PKs/ids, ISO-8601 timestamps).
- [x] Additive-only: `CREATE TABLE IF NOT EXISTS` + no `DROP`/`ALTER`/`DELETE` of legacy tables.
- [x] Documented rollback with old application semantics (R-036).

## 8. Broader build / test / gate commands (Node 22)

```sh
cd packages/server && nvm use 22 && npm run build          # PASS (tsc, strict)          exit 0
cd packages/server && nvm use 22 && npx vitest run         # 203 files, 1719 tests PASS  exit 0
cd packages/db     && nvm use 22 && npx tsc --noEmit       # PASS (strict)              exit 0
npm run build                                             # app + db + server build     exit 0
npm run ctrl:gate                                         # gate passed ✅              exit 0
npm run scan:private-defaults -- --enforce               # exit 0 (no new findings)
npm run test:release-deploy                              # 14/14 PASS                 exit 0
bash scripts/proof/entity-phase-2-smoke.sh                # PASS                        exit 0
git diff --check                                          # clean                       exit 0
```

The full server suite remains **1719/1719** across 203 files (the same final count as the T-002 base),
and the db package suite is now **164 tests across 22 files** (incl. the 16 new T-003 tests).

## 9. Worktree / diff hygiene

```sh
git status --short   # only the 3 new source files + this evidence directory
git diff --check     # clean
```

## 10. Rule-outs

- **PRD (`phase2-canonical-prd.md`) is read-only this round** — rule-out per the ticket: T-003 lists it as
  a named path, but operator-side authority-pin reconciliation (`83cacbc…` vs in-tree `c82e82d8…`) is pending
  Henry's decision; the in-tree PRD content is this task's read-only authority. Its T-003/R-001/R-036 content
  is what the deliverable represents. The discrepancy is documented in T-002 evidence §8 and is unchanged.
- `AGENTS.md`, `BUILD-CONTEXT.md`, `ISSUE-MAP.md`, `.cursor/rules/entity-document-integrations.mdc`,
  `phase2-flags.ts`, `receipt-writer.ts`, `index.ts` — out of scope, untouched.
- No Linear/GitHub/deploy/production writes; no push; no merge to main; no OpenWiki regeneration; no next-issue
  selection; no test allowlists or gate weakening.

## 11. Feature-flag / reversibility note

The migration is purely additive and reversible through the audited Phase 2 flag host
(`packages/server/src/phase2-flags.ts`). No flag is registered in this ticket — T-006 owns flag
registration for the unified-registry rollout. The migration itself is already fully reversible:
`reverseDocumentIntegrationsMigration` drops only the four unified tables and preserves legacy data, so a
rollback of the application keeps pre-T-003 semantics with no data recovery. Writes to the new tables are
gated later by the T-006 capability/flag layer, not by provider name (T-002 `types.ts` principle).

## 12. Unresolved risks / open items

- **Authority-pin drift** (`83cacbc…` vs in-tree `c82e82d8…`): pending Henry's decision; handled by
  treating the in-tree PRD as read-only authority and not touching it.
- **Retention / backfill & parity validation** for legacy Google V1 `external_document_refs` → unified
  `document_objects` registration is not implemented here (R-036 lists backfill/lazy registration and parity
  validation among the migration strategy elements; the concrete Google backfill is T-012). T-003 provides the
  additive schema + helpers + migration fixtures; T-012 owns migrating the Google read path and T-004 owns the
  registry that consumes these helpers.
- **Operation-scoped creation idempotency store** (PRD §11, line 1529 for T-003) is noted but its concrete
  table is governed by downstream decisions; T-003 keeps the schema additive and the event table carries an
  `idempotency_key` column as required, with full creation-idempotency implementation deferred to the
  creation-path ticket.

## 13. Delivery

Scoped to the runner branch only; no merge to `main` (Gate 8) and no production promotion. Final reviewed
SHA is recorded in the final-answer line and subsequently in the external review receipt + Linear proof
comment (a tracked commit cannot contain its own SHA).
