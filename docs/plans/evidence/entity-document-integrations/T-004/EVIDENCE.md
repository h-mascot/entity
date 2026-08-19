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
cd packages/server && nvm use 22 && npx vitest run           # 205 files, 1746 tests exit 0
cd packages/db     && nvm use 22 && npx vitest run           # 22 files, 184 tests  exit 0
cd packages/db     && nvm use 22 && npx tsc --noEmit         # PASS (strict)        exit 0
cd packages/server && nvm use 22 && npx vitest run src/document-providers/registry.test.ts  # 22/22 exit 0
cd packages/db     && nvm use 22 && npx vitest run src/document-integrations.test.ts        # 36/36 exit 0
git diff --check                                             # clean                exit 0
npm run ctrl:gate                                            # gate
```

Focused command exit codes after the final implementation (review round 1 HEAD; server type-check
uses `tsc --noEmit` so the strict check runs without emitting into `packages/*/dist`, keeping the
worktree clean):

```sh
cd packages/server && npx vitest run src/document-providers/registry.test.ts   # exit 0 (22/22)
cd packages/db     && npx vitest run src/document-integrations.test.ts         # exit 0 (36/36)
cd packages/server && npx tsc --noEmit -p tsconfig.json                       # exit 0 (strict)
cd packages/db     && npx tsc --noEmit -p tsconfig.json                       # exit 0 (strict)
```

Server suite delta vs T-003 base: T-004 adds the registry suite (now 22 tests incl. the round-1
fixes) plus the T-003 review-round fixes landed before this ticket; full server suite 1746 tests,
full db suite 184 tests. No pre-existing test regressed.

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

## 12. Review round 1 (GLM 5.3) findings — F1–F6 disposition

Independent reviewer verdict `CHANGES_REQUESTED` (round 1 of 3). All findings reproduced
empirically by the reviewer; each fixed failing-test-first on the reviewed HEAD `ca1e4e8`, then
GREEN at final HEAD.

### F1 — `update()` permitted identity rewiring (Blocker)
**Disposition: FIXED.** Narrowed `UpdateDocumentObjectFields` (db) to exclude the identity tuple
(`provider_connection_id`, `external_id`) — the patch type no longer advertises them, so
`DocumentRegistryUpdatePatch` (derived) can never rewire identity at compile time. Added a runtime
guard in `updateDocumentObject` that rejects any identity-supplying update (reachable only via an
unsafe cast) with a TYPED rejection, so a colliding rewire never surfaces as a raw
`UNIQUE constraint failed` SqliteError (no collision can even reach SQL). Registry `update` doc
comment updated.
- **RED (HEAD `ca1e4e8`)** — `registry.test.ts` "F1: update can never rewire the provider
  identity…" and `document-integrations.test.ts` F1 rewire tests (silent rewire / raw SqliteError)
  → **5 + 6 of the new tests failed**; specifically the identity rewire behaviour was unfixed.
- **GREEN** — identity rewire is rejected with `identity/immutable`, and rediscovery of the
  original identity still converges to the SAME canonical record (no divergence, no duplicate).
  Tests: `registry.test.ts` F1 (1), `document-integrations.test.ts` F1 (2).

### F2 — `null` could never clear nullable fields (Blocker)
**Disposition: FIXED.** Rewrote the by-id `updateDocumentObject` UPDATE to a declared-guard model:
for every nullable field, `CASE WHEN @<col>_provided THEN @<col> ELSE <col> END` — explicit `null`
now CLEARS the stored value, `undefined` (omitted) PRESERVES it. The generic by-id path now agrees
with the T-003 rediscovery path (which assigns `degraded_reason_code = @degraded_reason_code`
directly) on null-clear semantics; an assertion bridges the two paths.
- **RED (HEAD)** — "F2: explicit null clears…" tests failed (a ready document could not shed its
  stale `degraded_reason_code`).
- **GREEN** — `degraded_reason_code`, `destination_id`, `provider_url`, `owner_summary`,
  `sensitivity_label`, `tenant_external_id`, `indexed_at` all clear on `null` and preserve on
  `undefined`. Tests: `registry.test.ts` F2 (1), `document-integrations.test.ts` F2 (3).

### F3 — `indexed_at` silently stamped now on every update (Major)
**Disposition: FIXED (new generic by-id path only; T-003 rediscovery path untouched per ticket).**
Changed `updateDocumentObject` from `indexed_at = COALESCE(@indexed_at, @now)` to
`indexed_at = CASE WHEN @indexed_at_provided THEN @indexed_at ELSE indexed_at END` — a title-only
patch now leaves `indexed_at` unchanged; an explicit `indexed_at` (or `null`, per F2) still
applies. The T-003 rediscovery UPDATE (`:629`) is intentionally NOT modified (that expression
pre-exists at base and is out of scope this ticket).
- **RED (HEAD)** — "F3: a title-only patch preserves indexed_at…" failed (title-only patch rewrote
  `indexed_at` to now).
- **GREEN** — `indexed_at` unchanged on title-only patch; explicit value still applies. Tests:
  `registry.test.ts` F3 (1), `document-integrations.test.ts` F3 (1).

### F4 — identity-less register/rediscover minted duplicates (Major)
**Disposition: FIXED — fail closed.** `register`/`rediscover` now throw a typed
`DocumentRegistryValidationError` when `external_id` is null/empty (PRD §11.1: local artifacts must
supply the durable managed file identity as `external_id`), instead of silently creating a
random-UUID duplicate. Chose fail-closed rather than inventing a synthetic identity scheme (no new
product semantic introduced). Interface doc comment "Idempotent registration" aligned with the
actual guarantee (idempotency requires a durable non-empty identity).
- **RED (HEAD)** — "F4: register with a null/empty external_id FAILS CLOSED…" failed (silently
  minted rows, `created: true` ×2).
- **GREEN** — identity-less register/rediscover throw; zero rows minted. Tests:
  `registry.test.ts` F4 (2).

### F5 — colocated db coverage for `updateDocumentObject` (Minor)
**Disposition: FIXED.** Added colocated `T-004 — updateDocumentObject (by-id update primitive)`
tests in `document-integrations.test.ts` covering: `changes === 0 → undefined` (unknown id), the
provided/omitted/null binding matrix (F2), identity-collision typed rejection (F1), and
`indexed_at` preserve/apply/clear (F3).

### F6 — test quality: tautology + fixture-shaped privacy test (Minor)
**Disposition: FIXED.** Replaced the tautology `expect(last?.record.id).toBe(last?.record.id)`
with an assertion that the final record id equals the FIRST registration's canonical id. Rewrote
the static-shape privacy test to introspect the REAL exported `RegistryWriteInput` type via a
compile-time `@ts-expect-error` guard (if a credential field were added to the type, the assignment
becomes legal and the unused `@ts-expect-error` fails the strict tsc gate).

### Verification commands for this round (Node 22)

```sh
# RED proofs captured on unmodified reviewed HEAD ca1e4e8 (new tests added first):
cd packages/server && $HOME/.nvm/versions/node/v22.22.2/bin/npx vitest run src/document-providers/registry.test.ts
#   → 5 failed (F1, F2, F3, F4×2) | 17 passed  [exit 1]
cd packages/db     && $HOME/.nvm/versions/node/v22.22.2/bin/npx vitest run src/document-integrations.test.ts
#   → 6 failed (F1×2, F2×3, F3×1) | 30 passed (36)  [exit 1]
# GREEN after fixes, final HEAD:
cd packages/server && $HOME/.nvm/versions/node/v22.22.2/bin/npx vitest run src/document-providers/registry.test.ts   # 22/22 exit 0
cd packages/db     && $HOME/.nvm/versions/node/v22.22.2/bin/npx vitest run src/document-integrations.test.ts         # 36/36 exit 0
cd packages/server && $HOME/.nvm/versions/node/v22.22.2/bin/npx vitest run                                          # 205 files / 1746 tests exit 0
cd packages/db     && $HOME/.nvm/versions/node/v22.22.2/bin/npx vitest run                                           # 22 files / 184 tests  exit 0
cd packages/server && $HOME/.nvm/versions/node/v22.22.2/bin/npx tsc --noEmit -p tsconfig.json                       # exit 0 (strict)
cd packages/db     && $HOME/.nvm/versions/node/v22.22.2/bin/npx tsc --noEmit -p tsconfig.json                       # exit 0 (strict)
git diff --check                                                                                                    # clean
```

## 13. Unresolved risks / open items

- **Authority-pin drift** (`83cacbc…` vs in-tree `c82e82d8…`): pending Henry's decision; handled by
  treating the in-tree PRD as read-only authority and not touching it.
- **Concurrent registration** is proven as SERIALIZED convergence (better-sqlite3 is synchronous).
  As of review round 3, the registry ALSO atomicizes the isolation pre-check + write in one
  `BEGIN IMMEDIATE` transaction and probes that atomic invariant with a second connection on a
  file-backed DB (B2), so a competing process can no longer commit a row between the check and the
  write. Genuine multi-process OS-thread interleaving of the full operation is not exercised here;
  the single-connection + unique-index design makes interleaved duplicates impossible at the
  storage layer, and a future multi-connection test can extend this suite.
- **(F7—review INFO, not blocking)** the isolation error and strict-create "already exists" error
  give workspace-B callers a cross-workspace existence oracle for probed identity tuples; no
  secrets leak and no HTTP surface exists yet — T-008 route wiring should review this
  differentiation (per reviewer).

## 13b. Review round 2/3 (GLM 5.3) findings — B1/B2/M1/M2 disposition

Reviewer: GLM 5.3, round 2 of 3 → **CHANGES_REQUESTED** on `feea089`. This is the final fix round
(round 3 of 3). Line numbers cited below are the re-verified `feea089` numbers from the verdict.

### B1 (Blocker) — `create()` bypassed the F4 identity-less fail-closed guard (duplicate-minting hazard)
**Disposition: FIXED — fail-closed on the create lane.**
`create()` (`registry.ts:175-178`) previously delegated straight to `repo.createDocumentObject`
with NO `external_id` validation. The partial unique index (`WHERE external_id IS NOT NULL`)
excludes NULL identities, so repeated identity-less `create()` calls minted unbounded canonical
records that `findDocumentByProviderIdentity` can never resolve and `register`/`rediscover` can
never converge — the exact R-001 divergence F4 closes, one lane over. `create()` now runs the same
`assertExternalIdentity` fail-closed guard as register/rediscover, throwing a typed
`DocumentRegistryValidationError` on null/empty `external_id` (chose fail-closed over a synthetic
identity scheme; no new product semantics). The dead nested `if (externalId)` (`registry.ts:153`)
was folded into the shared guard, and the `create` interface doc comment now states the identity
requirement (durable managed file identity per PRD §11.1).
- **RED (unmodified `feea089` source, new tests added first):** both B1 prove-it tests failed —
  `AssertionError: expected function to throw an error, but it didn't` for identity-less `create()`
  (it minted rows instead of failing closed).
- **GREEN:** identity-less `create()` throws `DocumentRegistryValidationError`; repeated identity-
  less create calls each fail closed and prove-it asserts zero rows minted. Tests:
  `registry.test.ts` B1 (2).

### B2 (Blocker) — cross-workspace isolation was a non-atomic two-statement TOCTOU
**Disposition: FIXED — atomic + workspace-guarded + header corrected.**
The isolation pre-check (`registry.ts:156-168`) and the delegated write (`registry.ts:170` →
`document-integrations.ts:596-633`, whose UPDATE carries no workspace guard in the WHERE clause and
overwrites title/auth_state/readiness_state/degraded_reason_code) now run inside ONE
`BEGIN IMMEDIATE` transaction (`db.transaction(...).immediate()`) in the registry layer for
create/register/rediscover, so a competing process (e.g. the separate-process db CLI or desktop
package) can never commit a row between B's pre-check and B's write. A post-delegation defense-in-
depth assertion `result.record.workspace_id === workspaceId` fails closed with a typed
`DocumentRegistryIsolationError` (with the transaction rolled back) if the delegated write ever
returns a foreign-workspace record. The module header claim (`registry.ts:26-30`) was corrected to
state the now-accurate guarantee (atomic + asserted) instead of an unconditional prose claim. The
single-process synchronous guarantee is intact (`BEGIN IMMEDIATE` is a strict superset of it).
- **Prove-it:** two-connection file-backed probe — while workspace A holds an uncommitted
  `BEGIN IMMEDIATE` write, workspace B's registration cannot slip a stale pre-check through; its
  atomic first statement fails fast with `database is locked`, and after A commits, B's retry fails
  closed with `DocumentRegistryIsolationError` leaving A's record untouched (owner-untouched
  assertion). A second test exercises the post-delegation assertion: every minting method
  (create/register/rediscover) returns a record owned by the caller workspace. Tests:
  `registry.test.ts` B2 (2).

### M1 (Minor) — rediscovery never syncs `destination_id`
**Disposition: DOCUMENTED (column list unchanged per ticket).** The delegated rediscovery UPDATE
(`document-integrations.ts:596-633`) omits `destination_id` from its column list; only the by-id
primitive updates it (`:701`). Per the ticket ("do NOT change the T-003 rediscovery column list in
this ticket"), the omission is now documented explicitly in the `rediscover()` docstring: it states
that rediscovery does NOT sync `destination_id` and that destination changes require `update()`.

### M2 (Minor) — rediscovery stamped `indexed_at = now` when omitted (R-029 contradiction)
**Disposition: FIXED — index state preserved when omitted.**
`document-integrations.ts:631` changed from `indexed_at = COALESCE(@indexed_at, @now)` to
`indexed_at = COALESCE(@indexed_at, indexed_at)`: a register/rediscover that omits `indexed_at` now
leaves the stored value unchanged (observing a new revision leaves the search index stale, matching
R-029), while an explicit `indexed_at` still applies. This aligns the rediscovery path with the
F3 semantics the by-id update path already established and makes the F3 fix two-sided. The prior db
test asserting "refreshes to now" was corrected to assert preservation.
- **RED (unmodified `feea089` source):** registry-level M2 failed —
  `expected '2026-08-19T20:05:28.449Z' to be '2026-01-01T00:00:00.000Z'` (re-stamped now); the
  db-layer M2 test likewise failed on the unmodified re-stamp.
- **GREEN:** omitted `indexed_at` preserved, explicit still applies. Tests:
  `registry.test.ts` M2 (1), `document-integrations.test.ts` M2 (1).

### Verification commands for this round (Node 22 — v22.22.2, final HEAD)

```sh
# RED proofs captured on UNMODIFIED feea089 source (round-2/3 tests added to the test files first):
cd packages/server && $HOME/.nvm/versions/node/v22.22.2/bin/npx vitest run src/document-providers/registry.test.ts
#   → 3 failed (B1×2, M2) | 24 passed (27)   [exit 1]
#     B1: "expected function to throw an error, but it didn't" (identity-less create not fail-closed)
#     M2: "expected '2026-08-19T20:05:28.449Z' to be '2026-01-01T00:00:00.000Z'" (re-stamp)
cd packages/db     && $HOME/.nvm/versions/node/v22.22.2/bin/npx vitest run src/document-integrations.test.ts
#   → 1 failed (M2 re-stamp test) | 35 passed (36)   [exit 1]

# GREEN after fixes, final HEAD:
cd packages/server && $HOME/.nvm/versions/node/v22.22.2/bin/npx vitest run src/document-providers/registry.test.ts   # 27/27 exit 0
cd packages/db     && $HOME/.nvm/versions/node/v22.22.2/bin/npx vitest run src/document-integrations.test.ts         # 36/36 exit 0
cd packages/server && $HOME/.nvm/versions/node/v22.22.2/bin/npx vitest run                                          # 205 files / 1751 tests exit 0
cd packages/db     && $HOME/.nvm/versions/node/v22.22.2/bin/npx vitest run src                                        # 22 files / 184 tests exit 0
cd packages/server && $HOME/.nvm/versions/node/v22.22.2/bin/npx tsc --noEmit -p tsconfig.json                       # exit 0 (strict)
cd packages/db     && $HOME/.nvm/versions/node/v22.22.2/bin/npx tsc --noEmit -p tsconfig.json                       # exit 0 (strict)
git diff --check                                                                                                    # clean
```

## 14. Delivery

Scoped to the runner branch only; no merge to `main` (Gate 8) and no production promotion. Final
reviewed SHA is recorded in the final-answer line and subsequently in the external review receipt +
Linear proof comment (a tracked commit cannot contain its own SHA).

## 15. Correction notice (2026-08-19) — T-005 disclosure of GLM 5.3 r3 finding F-2

This notice is appended by the T-005 worker (THE-946) to correct two statements in THIS evidence
file that misdescribe `packages/db/src/document-integrations.test.ts` as "out of scope, untouched".
History is not rewritten; only this appended notice plus the two corrected statements are recorded.

### Correcting §2 ("Scope delivered (named paths)")

The §2 table's `packages/db/src/document-integrations.ts` row correctly reports the new additive
`updateDocumentObject(id, fields)` primitive, but the accompanying "No change outside these named
paths" line does **not** disclose that its test companion `packages/db/src/document-integrations.test.ts`
was modified by T-004. Correction: T-004 (base `0f1f6fd` → `a62d17d`) added **221 lines** to
`packages/db/src/document-integrations.test.ts` — the failing-test-first regression tests for the
new `updateDocumentObject` primitive and the review-round M2 `indexed_at` preserve behavior. Those
tests are exercised throughout this evidence (§ Verification commands, review rounds) and are part of
the T-004 delta; they were NOT "out of scope, untouched."

### Correcting §10 ("Rule-outs / rule-ins")

The §10 bullet:

> `AGENTS.md`, `BUILD-CONTEXT.md`, `ISSUE-MAP.md`, `.cursor/rules/entity-document-integrations.mdc`,
> `phase2-flags.ts`, `receipt-writer.ts`, `index.ts`, `document-integrations.test.ts` — out of
> scope, untouched.

is corrected as follows: `AGENTS.md`, `BUILD-CONTEXT.md`, `ISSUE-MAP.md`,
`.cursor/rules/entity-document-integrations.mdc`, `phase2-flags.ts`, `receipt-writer.ts`,
`index.ts` remain **out of scope, untouched**; **`packages/db/src/document-integrations.test.ts` was
RULED IN** as the colocated test companion to the additive db primitive and was modified by T-004
(and by the T-003 review-round fixes landed before this ticket). All other §10 statements are
unchanged.
