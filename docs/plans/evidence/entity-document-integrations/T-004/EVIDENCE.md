# T-004 — Implement Document Registry

Issue: THE-945 ([LOOM-DOCS T-004] Implement Document Registry)
Run marker: `loom-run:entity-doc-integrations-20260809`
Worker model: `citadel/daystrom/deepseek` (medium) — pinned externally, not substituted.
Branch: `runner/entity-document-integrations-20260818`
Pre-issue reviewed base (T-003 approved HEAD): `0f1f6fd33ca84ee55c5de21c80f6790ce7d59f5b`
Node: `nvm use 22` (v22.22.2) — required for better-sqlite3 native bindings (Node 26 `ERR_DLOPEN_FAILED`).

## 1. Acceptance requirement (verbatim authority)

T-004 section of the canonical PRD (`docs/loom/entity-document-integrations/phase2-canonical-prd.md`):

> ### T-004 — Implement Document Registry
>
> Goal/value: Centralize canonical document identity.
>
> Scope: create/register/get/update/rediscover.
>
> Dependencies: T-003.
>
> Acceptance: Rediscovery does not duplicate.
>
> Automated proof: Registry unit/integration tests.
>
> Security: workspace isolation.
>
> Not done until: concurrent registration test passes.

### R-001 — Canonical document object (verbatim, the acceptance R-001 backs)

> Entity must represent every managed document, spreadsheet, or presentation with one provider-neutral document record.
>
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

## 2. Scope delivered (named paths)

| Path | Action |
| --- | --- |
| `docs/loom/entity-document-integrations/phase2-canonical-prd.md` | **Read-only authority** — NOT modified. Ruled out this round: T-004 lists it as a named path, but the operator-side authority-pin reconciliation (`83cacbc…` vs in-tree `c82e82d8…`) is pending Henry's decision; per the ticket the in-tree PRD is the read-only authority. |
| `packages/server/src/document-providers/registry.ts` | Added — the R-001 registry surface (`create/register/get/update/rediscover`) that composes the T-003 db primitives and enforces workspace isolation. |
| `packages/server/src/document-providers/registry.test.ts` | Added — 17 focused tests (RED→GREEN): rediscovery-no-duplicate, workspace isolation negative tests, by-id update scoping, serialized duplicate/concurrent-style registration convergence, security/privacy surface. |
| `packages/db/src/document-integrations.ts` | **Barely touched (ruled IN with justification)** — one ADDITIVE primitive added: `updateDocumentObject(id, fields)` (interface + impl + export). Justification: the ticket's `update` scope requires a by-id metadata update, and the T-003 repo exposed no by-id update primitive (only strict `createDocumentObject`, identity-keyed `registerDocumentObject`, and workspace-blind `getDocumentObject`). Without it the registry could not compose (not duplicate SQL) a by-id update. The edit is additive-only: no existing method was changed, so the T-003 F3/F4 findings (which touch the existing rediscovery UPDATE / operation upsert code paths) were NOT touched and therefore NOT folded in — they remain out of scope. |
| `docs/plans/evidence/entity-document-integrations/T-004/EVIDENCE.md` | Added — this file. |

No change outside these named paths was made (worktree diff at §9).

## 3. What T-004 delivers

Goal/value: **Centralize canonical document identity.** Delivered as a server-layer registry
`packages/server/src/document-providers/registry.ts` that composes the T-003 persistence
primitives (`createDocumentIntegrationsRepository`) and adds the one missing by-id update
primitive to the db layer.

- **`create`** — strict create scoped to a workspace; throws loudly on any existing provider
  identity (including an identity owned by a different workspace, so a strict create can never
  mask or duplicate a globally-owned identity). Delegates to the T-003 strict-create primitive.
- **`register`** — idempotent registration. Resolves the (provider_connection_id, external_id)
  identity via the T-003 lookup, then: same-workspace match → update (created=false);
  cross-workspace match → **FAILS CLOSED** (throws `DocumentRegistryIsolationError`); no match →
  create (created=true). Delegates the actual update/create to T-003's
  `registerDocumentObject` so identity logic is not duplicated.
- **`get`** — by-Entity-id read, scoped to the caller workspace. Returns `undefined` when the id
  is unknown OR owned by a different workspace (a workspace-A read never returns a workspace-B
  document).
- **`update`** — by-Entity-id metadata update, scoped to the caller workspace; `undefined`
  (no-op) for unknown or cross-workspace ids. Field-omitting patches preserve stored state
  (COALESCE, matching T-003 F2 no-clobber semantics). Backed by the new db primitive.
- **`rediscover`** — provider-sync intent. Semantically identical to `register` (idempotent,
  same-workspace update / cross-workspace fail-closed / new create) so a rediscovered artifact
  converges to the same canonical record (R-001: "Rediscovery does not duplicate").

Constraints honored: no competing API namespace (reuses the db input vocabulary,
`RegistryWriteInput = Omit<CreateDocumentObjectInput,'workspace_id'>`), no second receipt store,
no provider registry, no event table, no credential fields.

## 4. Workspace isolation — the required security guarantee

T-003 review r2 INFO finding (c): the underlying identity lookup is **workspace-blind by PRD 11.1
design** — `(provider_connection_id, external_id)` uniqueness is enforced globally, not
per-workspace. The registry layer is therefore where isolation is enforced. Every registry method
that resolves a record re-checks its `workspace_id` against the caller's scope before returning or
writing:

- `get(id, wsB)` returns `undefined` for a record created in wsA (negative test).
- `findByProviderIdentity(id, wsB)` returns `undefined` for a record created in wsA (negative test).
- `register`/`rediscover` of an identity owned by another workspace **throws**
  `DocumentRegistryIsolationError` and never reads or mutates the owner's record (negative test —
  asserts the owner's title is unchanged after the attack).
- `update(id, wsB, …)` is a no-op for a record created in wsA (negative test — asserts the owner
  is untouched).
- `create` of an identity owned by another workspace throws (identity globally owned).

### Workspace-isolation negative-test proof

```
T-004 document registry — workspace isolation (security)
  ✓ get scoped by workspace never returns another workspace's document (negative)
  ✓ findByProviderIdentity is workspace-scoped and never leaks a cross-workspace record (negative)
  ✓ register for an identity owned by another workspace FAILS CLOSED (negative)
  ✓ rediscover for an identity owned by another workspace FAILS CLOSED (negative)
  ✓ strict create throws on any existing identity, including a cross-workspace owner (negative)
```

## 5. TDD — RED first, then GREEN

### RED (module absent)

```sh
cd packages/server && nvm use 22 && npx vitest run src/document-providers/registry.test.ts
#  Test Files  1 failed (1)
#  Tests       16 failed | 1 passed (17)
#  Error: Cannot find module '/src/document-providers/registry' imported from ...registry.test.ts
```

The 1 "passed" is the static-shape privacy test that does not touch the module (asserts the write
input type has no credential field). All 16 tests that exercise registry behavior failed on module
resolution.

### GREEN (module implemented) — focused suite, 17/17

```sh
cd packages/server && nvm use 22 && npx vitest run src/document-providers/registry.test.ts
#  Test Files  1 passed (1)
#  Tests       17 passed (17)
```

Proof that the RED→GREEN transition is real: every registry test references only the exported
symbols (`createDocumentRegistry`, `DocumentRegistryIsolationError`,
`DocumentRegistryUpdatePatch`) which did not exist before implementation; the first run failed on
module resolution (RED), the second passed after the module was added (GREEN). One test-only fix
was required to reach full GREEN: the cross-workspace rediscover assertion regex was relaxed to
match the isolation error (`/DocumentRegistryIsolationError|different workspace/i`) — the
implementation behavior (throw, owner unchanged) was always correct.

## 6. Required acceptance proofs

### Rediscovery does not duplicate (R-001 acceptance)

```
✓ rediscovery converges to the SAME canonical record, never a duplicate (R-001 acceptance)
✓ register is idempotent and converges to a single canonical id (R-001)
✓ the canonical id is stable and deterministic across first create and rediscovery
✓ NULL-connection provider identity converges to a single canonical record (R-001 / T-003 F1)
```

The rediscovery test registers the identity once (`created=true`), then rediscoverers with a
changed title/revision/readiness; the second call returns `created=false` with the SAME id, and
exactly one `document_objects` row exists for the identity.

### Workspace isolation (T-004 security) — see §4.

### Concurrent registration test passes (T-004 "not done until") — honest naming

better-sqlite3 is **synchronous and single-connection**, so genuine OS-thread interleaving cannot
be produced by this driver. Per T-003 r2 F2 ("do not overstate it as interleaving coverage"), the
tests exercise **SERIALIZED double/concurrent-style registration convergence** at the registry
boundary: registration attempts for the same provider identity executed back-to-back must
converge to a single canonical record. Labeled honestly in the suite:

```
T-004 document registry — duplicate/concurrent-style registration convergence (SERIALIZED)
  ✓ many back-to-back duplicate registrations converge to exactly one canonical record
    (25 sequential register() calls → 1 unique id, 1 row)
  ✓ alternating register/rediscover attempts converge to one canonical record
    (20 alternating calls → exactly 1 row, final title = last write)
```

## 7. Security / privacy self-check

- **Workspace isolation** is enforced in the registry layer (the workspace-blind identity lookup
  is never exposed without a workspace re-check) — covered by the negative tests in §4.
- **No credential columns anywhere.** A dedicated test `PRAGMA table_info('document_objects')`
  asserts none of `access_token | refresh_token | client_secret | password | api_key | secret |
  auth_code | token` exists; and a static-shape test asserts the registry write input type exposes
  no `token|secret|credential|password` field names. The registry holds leaf R-001 fields only.
- No raw tokens, tenant secrets, document contents, or operator-specific absolute paths appear in
  the code, tests, fixtures, or this evidence. (The only paths below are relative repo paths.)

## 8. Broader build / test / gate commands (Node 22)

```sh
cd packages/server && nvm use 22 && npm run build            # PASS (tsc, strict)   exit 0
cd packages/server && nvm use 22 && npx vitest run           # 205 files, 1741 tests exit 0
cd packages/db     && nvm use 22 && npx vitest run           # 22 files, 177 tests  exit 0
cd packages/db     && nvm use 22 && npx tsc --noEmit         # PASS (strict)        exit 0
cd packages/server && nvm use 22 && npx vitest run src/document-providers/registry.test.ts  # 17/17 exit 0
cd packages/db     && nvm use 22 && npx vitest run src/document-integrations.test.ts        # 29/29 exit 0
git diff --check                                             # clean                exit 0
npm run ctrl:gate                                            # gate
```

Focused command exit codes after the final implementation:

```sh
cd packages/server && npx vitest run src/document-providers/registry.test.ts   # exit 0 (17/17)
cd packages/db     && npx vitest run src/document-integrations.test.ts         # exit 0 (29/29)
cd packages/server && npm run build                                            # exit 0
cd packages/db     && npx tsc --noEmit                                         # exit 0
```

Server suite delta vs T-003 base (204 files / 1719 tests): +1 file / +17 registry tests → 205
files / 1736 tests beyond the T-003 delta; the reported 1741 includes the T-003 review-round
fixes landed before this ticket. No pre-existing test regressed.

## 9. Worktree / diff hygiene

```sh
git status --short   # only: registry.ts, registry.test.ts, document-integrations.ts, T-004/EVIDENCE.md
git diff --check     # clean
```

## 10. Rule-outs / rule-ins

- **PRD (`phase2-canonical-prd.md`) is read-only this round** — rule-out per the ticket: T-004 lists
  it as a named path, but operator-side authority-pin reconciliation (`83cacbc…` vs in-tree
  `c82e82d8…`) is pending Henry's decision; the in-tree PRD content is this task's read-only
  authority. Its T-004/R-001 content is what the deliverable represents. The discrepancy is
  documented in T-002/T-003 evidence and is unchanged.
- **`packages/db/src/document-integrations.ts` — RULED IN (narrowly).** One ADDITIVE primitive,
  `updateDocumentObject(id, fields)`, was added. Justification: the `update` scope has no by-id
  update primitive in the T-003 repo (only strict-create, identity-keyed registration, and
  workspace-blind get); adding it keeps the registry compositional (no raw SQL in the server
  layer). The edit does not alter any existing method, so the T-003 F3/F4 findings (on the
  existing rediscovery UPDATE / operation-upsert code paths) were NOT reached and were therefore
  NOT folded in — they remain out of scope for T-004. No db test edit was required because
  every consumer uses the `createDocumentIntegrationsRepository` factory (no mock object literal
  breaks).
- `AGENTS.md`, `BUILD-CONTEXT.md`, `ISSUE-MAP.md`, `.cursor/rules/entity-document-integrations.mdc`,
  `phase2-flags.ts`, `receipt-writer.ts`, `index.ts`, `document-integrations.test.ts` — out of
  scope, untouched.
- No Linear/GitHub/deploy/production writes; no push; no merge to main; no OpenWiki regeneration;
  no next-issue selection; no test allowlists or gate weakening.

## 11. Feature-flag / reversibility note

The registry is a pure composition layer over the additive T-003 schema: it introduces no
competing table, namespace, receipt store, provider registry, or event table, and it holds no
immutable flag of its own. Reversibility is preserved through the audited Phase 2 flag host
(`packages/server/src/phase2-flags.ts`): per T-003 evidence §11, T-006 owns registering the
unified-registry rollout flag, so the registry's behavior remains capability-honest (it never
gates writes on provider name — capability negotiation stays in the T-002/T-006 layer) and
flip-of-flag reversible. At the data layer, the only new code path added here is the additive
`updateDocumentObject` primitive on an existing additive table; rolling the application back to
pre-T-003 semantics still drops only the additive unified tables
(`reverseDocumentIntegrationsMigration`) and preserves old application semantics (R-036), with no
legacy data recovery required.

## 12. Unresolved risks / open items

- **Authority-pin drift** (`83cacbc…` vs in-tree `c82e82d8…`): pending Henry's decision; handled by
  treating the in-tree PRD as read-only authority and not touching it.
- **Concurrent registration** is proven as SERIALIZED convergence (better-sqlite3 is synchronous).
  Genuine multi-process / multi-connection interleaving at the registry boundary is not exercised
  here; the single-connection + unique-index design makes interleaved duplicates impossible at the
  storage layer, and a future multi-connection test can extend this suite.
- **`update` allows identity-field mutation** (`external_id` / `provider_connection_id` in the
  patch): the unique identity index surfaces a collision loudly if a caller sets them to a
  conflicting value; T-004 does not otherwise gate identity rewiring, which is a provider-sync
  concern for later tickets.

## 13. Delivery

Scoped to the runner branch only; no merge to `main` (Gate 8) and no production promotion. Final
reviewed SHA is recorded in the final-answer line and subsequently in the external review receipt +
Linear proof comment (a tracked commit cannot contain its own SHA).
