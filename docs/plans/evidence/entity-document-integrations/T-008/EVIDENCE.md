# T-008 — Implement provider-neutral Document API

Issue: THE-949 ([LOOM-DOCS T-008] Implement provider-neutral Document API)
Run marker: `loom-run:entity-doc-integrations-20260818`
Worker model: `daystrom/deepseek` (medium) — pinned externally, not substituted.
Branch: `runner/entity-document-integrations-20260818`
Pre-issue reviewed base (T-007 approved HEAD): `2f150e4ab333a7c08f9b67d4466b2d417e5858d3` (GLM 5.3 r3 FINAL)
Candidate reviewed: `56c05d8fdfd258aaafd55e53d8c448d94f068cd2` (GLM 5.3 r1 → CHANGES_REQUESTED, THE-949 r2)
Reviewed candidate (r2): `404c922e6f3b4eeb4d4a53bd6fab793e0bd1f9a0` (GLM 5.3 r2 → CHANGES_REQUESTED — this round 3,
FINAL, fixes F1–F6; the findings mapping lives in §4/§5d). Round 2 fixed THE-949 r1 findings B1–B4 / M1 / M2 /
L1a–e and test gaps 1–3 (see §4/§5c).
Node: `nvm use 22` (v22.22.2) — required for better-sqlite3 native bindings (Node 26
`ERR_DLOPEN_FAILED` ABI mismatch).

## 1. Acceptance requirement (verbatim authority)

T-008 section of the canonical PRD (`docs/loom/entity-document-integrations/phase2-canonical-prd.md`),
quoted verbatim (not paraphrased into new defaults):

> ### T-008 — Implement provider-neutral Document API
>
> Goal/value: Give humans/agents a stable API.
>
> Dependencies: T-004–T-007.
>
> Scope: get/create/mutate/versions/capabilities.
>
> Non-goal: Provider-specific implementation.
>
> Acceptance: typed errors and revision requirement implemented.
>
> Automated proof: API contract tests.

Binding namespace constraint and route templates from §12 (verbatim; this round takes option (a), the
default — a distinct `/api/document-integrations` namespace following the `/api/document-objects`
precedent):

> Binding namespace constraint. /api/documents is already mounted by the agent-native editor module
> at packages/server/src/editor/index.ts:43 and serves /:docId/state, /:docId/edit, /:docId/comments,
> /:docId/suggestions, and /:docId/reviews behind createEditorRouteAuth scope checks
> (documents:read, documents:edit, documents:comment:write, documents:suggest:write,
> documents:review:write). The Document Integration Platform must not add sibling routes into that
> router. T-008 must take one of two options: (a) mount the provider-neutral API under a distinct
> namespace, following the /api/document-objects precedent at packages/server/src/index.ts:329; or
> (b) extend the existing editor router … Option (a) is the default. Option (b) requires the ADR
> before any route is added.

> Route templates, under the option (a) default:
>
> Get document: GET /api/document-integrations/{documentId}
> Create document: POST /api/document-integrations
> Mutate document: POST /api/document-integrations/{documentId}/mutations
> Capabilities: GET /api/document-integrations/{documentId}/capabilities
> Versions: GET /api/document-integrations/{documentId}/versions

§12 contracts implemented here, quoted verbatim where the acceptance hinges on shape:

### 12.3 Mutate document (revision requirement + 409 contract)

> POST /api/document-integrations/{documentId}/mutations
>
> Request:
> {
>   "expectedRevision": "rev_17",
>   "idempotencyKey": "op_01J...",
>   "operation": { "kind": "replace_text", … }
> }
>
> Response:
> {
>   "documentId": "doc_01J...",
>   "previousRevision": "rev_17",
>   "revision": "rev_18",
>   "operationId": "op_01J...",
>   "receiptId": "receipt_01J..."
> }
>
> Conflict: 409 Conflict
> {
>   "error": {
>     "code": "STALE_REVISION",
>     "message": "The document changed after this operation was prepared.",
>     "documentId": "doc_01J...",
>     "expectedRevision": "rev_17",
>     "currentRevision": "rev_18",
>     "retryable": true
>   }
> }

### 12.6 Capability endpoint

> GET /api/document-integrations/{documentId}/capabilities
> or an equivalent field on document retrieval.
> Responses must include reason codes.

### 12.7 Versions

> GET /api/document-integrations/{documentId}/versions
>
> Response:
> {
>   "versions": [
>     {
>       "revision": "rev_18",
>       "actorType": "agent",
>       "actorId": "agent_...",
>       "observedAt": "2026-08-09T06:10:00Z",
>       "providerModifiedAt": "2026-08-09T06:09:58Z"
>     }
>   ]
> }

## 2. Scope delivered (named paths)

New (this round):
- `packages/server/src/routes/document-integrations.ts` (router: get/create/mutate/capabilities/versions)
- `packages/server/src/routes/document-integrations.test.ts` (API contract tests)
- `docs/plans/evidence/entity-document-integrations/T-008/EVIDENCE.md` (this file)
- `packages/server/src/index.ts` — mount ONLY: the `/api/document-integrations` router wired to the
  T-003-backed registry + phase-2 flags + a fail-closed workspace resolver. No editor-route changes.

Carry-forward edits (already in the preserved working tree, kept and re-verified this round):
- `packages/server/src/document-providers/registry.ts` + `registry.test.ts` — THE-945 r3 F1 / F3 / F4
- `packages/server/src/document-providers/write-policy.ts` + `write-policy.test.ts` — THE-948 r3 F4
  (`UnapprovedDestinationError` cause differentiation)
- `docs/plans/evidence/entity-document-integrations/T-007/EVIDENCE.md` — one trivial §8b count fix
  (three→four)

## 3. What T-008 delivers

- Five provider-neutral routes under the option (a) default namespace `/api/document-integrations`.
- Every route scopes every lookup by the resolved workspace (THE-945 r3 F3 predicate holds at the
  route boundary). A cross-workspace read/mutate returns the SAME typed 404 as an unknown id; a
  cross-workspace create returns a typed 409 that never names the owning workspace (THE-944 r2 F7 —
  a cross-workspace probe is not an existence oracle).
- Typed, machine-readable errors throughout (never a bare 500 for an expected failure):
  `WORKSPACE_REQUIRED`, `WORKSPACE_ISOLATION`, `DOCUMENT_NOT_FOUND`, `DOCUMENT_ALREADY_EXISTS`,
  `STALE_REVISION`, `INVALID_REQUEST`, `DESTINATION_REQUIRED`, `DESTINATION_NOT_ALLOWED`,
  `WRITE_DISABLED`, `CAPABILITY_UNSUPPORTED`, `UNSUPPORTED_OPERATION`, `PROVIDER_UNAVAILABLE`.
- Mutation enforces the §12.3 revision requirement: `expectedRevision` + `idempotencyKey` + a typed
  `operation` are all required; a stale expected revision returns 409 `STALE_REVISION` with
  expected/current revision and `retryable:true`.
- Create is enforced through the T-007 destinations/write-policy (R-003): unapproved destination →
  typed `DESTINATION_NOT_ALLOWED` with a machine-readable `cause` (THE-948 r3 F4);
  missing policy → typed `DESTINATION_REQUIRED`; policy `denied` → typed `WRITE_DISABLED`.
- Capabilities carry reason codes (T-006 fold honored). Capability evidence is DERIVED from actual
  state, not fabricated (THE-949 r2 M2): the create lane uses registered connection state via
  `connectionStateFor` (default `unknown` → fail closed) and every lane uses real runtime evidence
  via `runtimeEvidence` (default none) — the route never hardcodes `connection:'authorized'` or
  `runtime:{healthy:true,mutationGateOpen:true}`. A disconnected/unknown connection or a closed
  mutation gate cannot be papered over at the route; write lanes fail closed on unknown/degraded
  capability or authority.
- Versions surface revision, actorType/actorId, observedAt, providerModifiedAt with honest
  attribution (R-027): the adapter version ref carries no actor, so `actorType` is `unknown` (never
  a fabricated `agent`), and `providerModifiedAt` is distinct from `observedAt` — `null` (unknown)
  when the provider did not report a separate modification timestamp (THE-949 r2 M1).
- Provider-neutral: every provider is reached through the `DocumentProviderAdapter` contract
  (T-005) via the deterministic fake adapter in all tests; no provider-specific code, no network,
  no unseeded randomness. The clock is INJECTED in tests (frozen determinism is injection-only);
  the un-injected production default is WALL-CLOCK (THE-949 r2 B4).

## 4. Automated proof — API contract tests

`packages/server/src/routes/document-integrations.test.ts` (31 tests) covers all five routes and the
full contract, including the THE-949 r2 additions (B1 canonical shapes, B2 replay, B3 rejection,
B4 wall-clock, M1 versions, M2 fail-closed create, gap 2/3 boundary cases). Focused run (Node 22),
exit 0:

```sh
cd packages/server && npx vitest run \
  src/routes/document-integrations.test.ts \
  src/document-providers/write-policy.test.ts \
  src/document-providers/registry.test.ts \
  src/document-providers/capability-resolver.test.ts   # 4 files / 136 tests / exit 0
```

Per-route negative proof (all asserted in the test file):

- **Mutation requires `expectedRevision` + `idempotencyKey` + typed operation** — omitting any one
  returns a typed 400 `INVALID_REQUEST` before the adapter is touched.
- **Stale-revision 409** (STALE_REVISION test, §12.3): a document advanced to `rev-2`, then mutated
  with a stale `expectedRevision` of `rev-1`, returns `409`, `error.code === 'STALE_REVISION'`,
  `error.expectedRevision === 'rev-1'`, `error.currentRevision === 'rev-2'`,
  `error.retryable === true`. Full 409 body shape (documentId, expectedRevision, currentRevision,
  retryable) verified.
- **Unapproved-destination negative** (create into `dest_evil` not in the policy's approved set)
  returns `422 DESTINATION_NOT_ALLOWED` with `error.cause === 'not_in_approved_set'` — fail closed.
- **Unknown/degraded capability fail-closed** (capabilities + mutate lanes): `agent_range_mutation`
  is honestly `unsupported` by the fake baseline → `state:'unsupported'`; a degraded connection
  never promotes a write lane to `supported`; a mutate into an unsupported lane returns typed
  `403 CAPABILITY_UNSUPPORTED`.
- **Cross-workspace isolation**: GET and mutate of another workspace's id return the SAME 404 body
  as an unknown id; a workspace-unbindable request returns typed `403 WORKSPACE_REQUIRED`;
  a cross-workspace create of an existing provider identity returns `409 DOCUMENT_ALREADY_EXISTS`
  whose message never names the owning workspace.
- **Capabilities include reason codes** and honor the T-006 fold; **versions** include
  revision/actorType/actorId/observedAt/providerModifiedAt.
- **B1**: canonical §12.4 `set_range` (sheet/range/values) and §12.5 `update_slide_text`
  (slideRef/elementRef/text) are accepted at the route boundary and surface `CAPABILITY_UNSUPPORTED`
  (not `INVALID_REQUEST`); unknown `operation.kind` → `UNSUPPORTED_OPERATION`; `target.anchor` is
  rejected typed `CAPABILITY_UNSUPPORTED` (never silently dropped).
- **B2**: a create retry with the SAME `idempotencyKey` reconciles with `200 reconciled:true` and the
  same `documentId` — never `409 DOCUMENT_ALREADY_EXISTS`.
- **B3**: `initialContent` / `associations` that the lane cannot honor are REJECTED typed
  `CAPABILITY_UNSUPPORTED` — no accepted-but-dropped path.
- **B4**: an un-injected `now` defaults to WALL-CLOCK (advances with real time), never the frozen
  constant.
- **M1**: versions use honest `actorType:'unknown'` and distinct `providerModifiedAt:null`.
- **M2**: an unknown connection state or a closed mutation gate fails create closed
  (`CAPABILITY_UNSUPPORTED`) — the route no longer fabricates `authorized`/healthy/gate-open.
- **gap 2/3**: create with no `destinationId` but a governing policy → `WRITE_DISABLED` (not
  `DESTINATION_REQUIRED`); capability-resolver disabled (rollback) still fails closed via the
  adapter; a KNOWN document with no registered adapter → `503 PROVIDER_UNAVAILABLE`.


## 5. RED → GREEN proof

### 5a. T-008 route integration fixes (this round)

The preserved `document-integrations.test.ts` was executing 4 FAIL cases at session resume because
the mutation/version tests seeded documents directly in the registry (leaving the fake adapter's own
in-memory store blind to the artifact) and one cross-workspace create test had no second-workspace
policy (so it failed at the policy gate before reaching the identity-conflict check). Fixes:

1. Seeded all three mutation tests (success, stale, unsupported) and the versions test **through the
   API** (`createViaApi`) so the deterministic fake adapter knows the artifact — the prior session's
   recorded intent, adopted as the code required.
2. Added a `ws_B` policy + destination so the cross-workspace create test reaches the
   identity-conflict check (THE-944 r2 F7) rather than `DESTINATION_REQUIRED`.
3. Fixed the router to persist `destination_id` on the created canonical record, so downstream
   mutate/version/capability evidence scopes resolve against the R-003 destination instead of
   failing closed on a null destination (this is why the API-created registry records now satisfy
   the mutation lanes).

RED (route test file at resume, `npx vitest run src/routes/document-integrations.test.ts`):
`Test Files 1 failed | Tests 4 failed | 14 passed (18)` — `cross-workspace create` (DESTINATION_REQUIRED
instead of DOCUMENT_ALREADY_EXISTS), `successful mutation` (200 vs 404), `STALE_REVISION` (409 vs 403),
`versions include …` (200 vs 404).

GREEN (after the three fixes above): `Tests 18 passed (18)`, exit 0.

### 5b. Carry-forward RED tests (THE-945 r3 F1/F3/F4, THE-948 r3 F4)

The carry-forward tests in `registry.test.ts` / `write-policy.test.ts` are genuinely RED against the
base `2f150e4` source. Proven by writing the base-`2f150e4` versions of `registry.ts` /
`write-policy.ts` into the working tree (keeping the carry-forward tests) and running the targeted
group; then restoring the carry-forward sources and re-running.

RED (base source, tests kept):
```sh
npx vitest run src/document-providers/registry.test.ts src/document-providers/write-policy.test.ts \
  -t "RED|carried|carry|cause|F1|F3|F4"   # 7 failed | 15 passed | 45 skipped, exit 1
```
Failing (7):
- registry F1: `F1 RED: a register/rediscover whose provider differs … FAILS CLOSED`
- registry F1: `F1 RED: a register/rediscover whose artifact_type differs … FAILS CLOSED`
- registry F3: `F3-carried: registry.update is atomic — one immediate transaction`
- write-policy F4: `not-in-approved-set … carries an explicit cause`
- write-policy F4: `record-missing: an approved id with NO destination record carries a distinct cause`
- write-policy F4: `record-disabled: an approved id whose destination record is disabled …`
- write-policy F4: `scope-mismatch: an approved id whose record serves a different scope …`

GREEN (carry-forward source restored):
```sh
npx vitest run src/document-providers/registry.test.ts src/document-providers/write-policy.test.ts \
  -t "RED|carried|carry|cause|F1|F3|F4"   # 22 passed | 45 skipped, exit 0
```

F4-lane "id omitted from `RegistryWriteInput`" is enforced at compile time by `@ts-expect-error`
inside the test; the strict tsc build passing at HEAD proves that annotation is still exercised (the
`@ts-expect-error` is NOT unused), so a caller-chosen `id` override cannot silently reappear.

### 5c. THE-949 r1 → r2 RED→GREEN (this round's findings)

Proven by reverting the 4 source files (`document-integrations.ts`, `registry.ts`, `index.ts`,
`request-permissions.ts`) to candidate HEAD `56c05d8` while KEEPING the newly-added tests, running
them, then restoring the fixed sources and re-running.

RED (candidate source, new tests kept) — `npx vitest run src/routes/document-integrations.test.ts
src/document-providers/registry.test.ts` → `11 failed | 53 passed (64)`, exit 1:

1. `B2 (gap 1): a create retry with the SAME idempotencyKey …` — got 409 `DOCUMENT_ALREADY_EXISTS` on replay (B2).
2. `B3: create with initialContent … REJECTED (no silent drop)` — got 201 (content silently dropped) (B3).
3. `B3: create with associations … REJECTED (no silent drop)` — got 201 (associations silently dropped) (B3).
4. `M2: create does NOT fabricate connection authorized … CAPABILITY_UNSUPPORTED` — got 201 (route assumed authorized) (M2).
5. `M2: a closed mutation gate (runtime evidence) fails create closed` — got 201 (runtime ignored) (M2).
6. `B1 (gap 2): canonical §12.4 set_range … CAPABILITY_UNSUPPORTED, not INVALID_REQUEST` — got 400 (B1).
7. `B1 (gap 2): canonical §12.5 update_slide_text … CAPABILITY_UNSUPPORTED, not INVALID_REQUEST` — got 400 (B1).
8. `B1: operation.target.anchor is NOT silently dropped` — got 200 (anchor dropped) (B1).
9. `versions include … ` — got `actorType:'agent'` + duplicated `providerModifiedAt` (M1).
10. `the un-injected production clock is WALL-CLOCK … not frozen` — got the frozen `2026-08-18T…` (B4).
11. `L1a … TYPED DocumentRegistryIdentityConflictError` — got a generic string-matched error (L1a).

GREEN (fixed sources restored) — `npx vitest run src/routes/document-integrations.test.ts
src/document-providers/registry.test.ts` → `Tests 64 passed (64)`, exit 0. Focused group (4 files)
`136 passed (136)`, exit 0; full server suite `208 files / 1862 tests / exit 0` (see §9).

## 6. Route-mount proof

`packages/server/src/index.ts` mounts the router under `/api/document-integrations` following the
`/api/document-objects` precedent (option (a)):
- The router is created with the T-003-backed registry (`createDocumentRegistry(entityDb)`), the
  phase-2 flag snapshot (`phase2Flags`), and an injected fail-closed `resolveWorkspace`.
- The T-003 additive schema is applied idempotently via `applyDocumentIntegrationsMigration(entityDb)`
  (reversible; touches no legacy document data).
- `adapters: () => undefined` and empty `policies`/`destinations` — because no real provider adapters
  are wired until T-012+, every provider-aware write/capability path fails closed with a typed
  `PROVIDER_UNAVAILABLE` / `DESTINATION_REQUIRED` rather than inventing a provider.
- `resolveWorkspace` maps a bound customer principal to its single authorized org (fail closed on
  ambiguity / out-of-membership), and the trusted service/admin path to the deployment default org.
  THE-949 r2 (L1d/L1e): a global admin with ambiguous scope (no explicit header, multiple orgs) now
  FAILS CLOSED (`WORKSPACE_REQUIRED`) instead of silently binding the default org, and this
  namespace reads the caller-explicit org from the HEADER ONLY (no query/body org selectors).
- The editor router (`editor/index.ts`) and the `/api/documents` namespace are untouched — no
  sibling routes added (binding namespace constraint honored).

## 7. Rule-outs

- **PRD (`phase2-canonical-prd.md`) — READ-ONLY.** Not modified. Quoted verbatim (§1) only.
- **`editor/index.ts` and the `/api/documents` editor namespace — UNTOUCHED.** Option (a) taken: the
  provider-neutral API lives under its own `/api/document-integrations` namespace.
- **§13 Events — NOT this ticket.** No event table, no `document_integration_events` writes, no
  `document_events` claim. No competing registry / receipt store / API namespace.
- **No provider-specific lanes.** Every provider is reached through the `DocumentProviderAdapter`
  (T-005); all tests use the deterministic fake. No provider-name-implies-capability shortcut
  (D-003 / R-002).
- **Read-only paths untouched:** `AGENTS.md`, `ISSUE-MAP.md`, `BUILD-CONTEXT.md`, gates, test
  allowlists, `migrations.ts`, `scoped-search-documents.ts`, `documents.ts`, editor router.
- **No persistence/migration changes beyond the additive T-003 schema application in the mount**
  (the schema itself is owned by read-only `migrations.ts`; the mount only calls the existing,
  additive, reversible `applyDocumentIntegrationsMigration`).
- No Linear/GitHub/deploy/production writes; no push; no merge to main; no OpenWiki regeneration;
  no next-issue selection; no test allowlist/gate weakening; deterministic (no time/network/
  randomness dependence).
- Privacy: no credentials, raw tokens, tenant secrets, document contents, or operator-specific
  absolute paths in code, fixtures, evidence, or output.

## 8. Carry-forward disclosures (reviewer-sanctioned, exact findings only)

- **THE-944 r2 F7** (strict-create error differentiation): enforced at the route boundary in
  `document-integrations.ts` create — a cross-workspace probe gets the same `409 DOCUMENT_ALREADY_EXISTS`
  as a same-workspace duplicate, and the message never names the owning workspace; pinned by the
  `cross-workspace create` test.
- **THE-945 r3 F1** (provider/artifact_type mismatch rejection): `registry.ts` rejects a
  register/rediscover that reuses an existing provider identity while claiming a different provider
  or artifact_type via `DocumentRegistryValidationError`; RED→GREEN in §5b.
- **THE-945 r3 F3** (race-safe `registry.update`): `registry.update` now wraps its workspace
  check-and-write in one `BEGIN IMMEDIATE` transaction; pinned by the atomicity RED test (§5b) using
  a second connection holding a write lock.
- **THE-945 r3 F4** (omit `id` from `RegistryWriteInput`): `id` is excluded from the registry write
  input; the deterministic T-003-derived canonical id is authoritative; enforced at compile time by
  `@ts-expect-error` and pinned by the `get`-lane assertions (§5b).
- **THE-948 r3 F4** (cause differentiation): `UnapprovedDestinationError` now carries one of
  `not_in_approved_set` / `destination_record_missing` / `destination_record_disabled` /
  `destination_scope_mismatch`, all still fail-closed; surfaced by the create route as
  `DESTINATION_NOT_ALLOWED` with `error.cause`. The T-007 EVIDENCE's §8b three→four count fix is the
  only change to T-007 evidence.
- **THE-948 r3 F1/F2/F3** carried as-is from T-007 (destination record integration, fail-closed
  branches, disabled-exact-over-enabled-wildcard precedence): re-verified this round via the focused
  `write-policy.test.ts` / `capability-resolver.test.ts` run (§4, 122/122).

## 9. Verification commands (Node 22 — v22.22.2)

Commands actually run this round (exit codes in `#` comments):

```sh
# 1. Focused T-008 + carry-forward suites
cd packages/server && npx vitest run src/routes/document-integrations.test.ts \
  src/document-providers/write-policy.test.ts src/document-providers/registry.test.ts \
  src/document-providers/capability-resolver.test.ts          # 4 files / 122 tests / exit 0

# 2. Strict tsc build
cd packages/server && npm run build                            # tsc strict / exit 0

# 3. Full server suite at final HEAD
cd packages/server && npx vitest run                           # 208 files / 1862 tests / exit 0

# 4. CTRL gate (root build + unit tests) under Node 22
npm run ctrl:gate                                              # [ctrl] gate passed ✅ / exit 0

# 5. Diff hygiene
git diff --check                                               # clean / exit 0
git status --short                                             # only scoped paths; clean after commit
```

RED→GREEN proof commands with exit codes are in §5.

Note on `npm run ctrl:gate`: the gate runner does not select a Node runtime itself; under the
PATH-default Node 26 the build fails on the known `better-sqlite3` `ERR_DLOPEN_FAILED` ABI mismatch.
Run in a shell that has selected Node 22 (`source ~/.nvm/nvm.sh && nvm use 22`) — the gate then passes
`[ctrl] unit tests passed` / `[ctrl] gate passed ✅` (exit 0).

## 10. Worktree / diff hygiene

```sh
git status --short   # only scoped paths, clean after commit (worktree clean)
git diff --check     # clean (exit 0)
```

Final commit SHA is recorded in the commit message and the final answer (a NEW commit on top of base
`2f150e4`; never amend/rebase, and the commit's own SHA is never written into tracked files).

## 11. Round 3 (FINAL) — fixes THE-949 r2 findings F1–F6

This round was reviewed against candidate `404c922e6f3b4eeb4d4a53bd6fab793e0bd1f9a0` (GLM 5.3 r2),
verdict **CHANGES_REQUESTED** for findings F1–F6. All six are closed here; the verified-correct F1-era
items (B1–B4 / M1 / M2 / L1a–e / gaps 1–3) were NOT touched. Fixes are small and localized exactly as
scoped.

### Finding disposition

- **F1 (MEDIUM) — §12.5 `elementRef`/`text` silently dropped.** Chose the reviewer's FIRST sanctioned
  option (typed `CAPABILITY_UNSUPPORTED` rejection, NOT an `AdapterMutation` extension): `parseMutation`
  now rejects a non-empty `elementRef`/`text` payload on the slide lane with `403 CAPABILITY_UNSUPPORTED`
  (mirroring the anchor guard and the `:241-252` no-silent-drop contract). `parseMutation` is now
  exported for the RED→GREEN unit proof. A bare §12.5 `slideRef` with no `elementRef`/`text` still maps
  to the plain slide lane.
- **F2 (MEDIUM) — `CREATE_RECONCILIATION_REQUIRED` zero coverage.** Added both negative tests: (a) a
  replayed idempotency key whose provider-side artifact is NOT yet registered → `409
  CREATE_RECONCILIATION_REQUIRED`; (b) cross-workspace replay — the workspace-scoped
  `findByProviderIdentity` returns undefined for a ws_A-owned record, so a ws_B replay fails closed
  with `409 CREATE_RECONCILIATION_REQUIRED` and the message never names `ws_A` (no existence oracle).
- **F3 (LOW) — `providerModifiedAt` can never be non-null.** Chose the reviewer's MINIMAL option
  (comment correction, NOT `ProviderVersionRef` plumbing): the `:843-849` comment now states the
  omission EXPLICITLY — `ProviderVersionRef` carries only `revision` + `observed_at`, so
  `providerModifiedAt` is structurally always `null`; plumbing is deferred to the slide/adapter-capable
  round (T-009/T-016). No behavior/type change.
- **F4 (LOW) — L1e/L1d workspace-binding untested.** Extracted the pure customer workspace decision
  from `index.ts:453` into `resolveCustomerWorkspaceScope` in `request-permissions.ts` (index.ts now
  calls it), and added tests pinning: header-only selector trims correctly and ignores body/query;
  `explicit ?? (single-org)` with NO default-org fallback; ambiguous global admin (no explicit, multiple
  orgs) FAILS CLOSED (`null` → WORKSPACE_REQUIRED); out-of-membership explicit header fails closed;
  catch → `null` → WORKSPACE_REQUIRED is the existing route-level mapping (already pinned at
  `document-integrations.test.ts` `WORKSPACE_REQUIRED` test). `readExplicitRequestOrgHeader` was
  unchanged (the index.ts refactor is the only index.ts edit, strictly required for F4 mount-level
  pinning).
- **F5 (LOW) — `parseMutation` validation gaps.** A present-but-non-array `values` on the §12.4 range
  lane is now a typed `400 INVALID_REQUEST` (was silently ignored → fell through to the value/empty
  string). A
  present-but-non-string `target.anchor` (e.g. number) is now a typed `400 INVALID_REQUEST` (was
  silently skipped → 200); the non-empty-string case remains `403 CAPABILITY_UNSUPPORTED`. Both are
  consistent with the diff's own no-silent-drop stance.
- **F6 (INFO) — EVIDENCE.md.** `:8` "See §11" (a nonexistent section) is now a pointer to the real
  findings mapping (§4/§5c) plus the new round-3 §11; the stale §9 full-suite count (`1848`) is corrected
  to the actual `1862` (§5c had it right).

### 5d. Round-3 RED→GREEN proof (F1 / F5 / F4 logic changes)

Proven by writing the NEW tests first and running them against the un-modified `404c922` sources, then
applying the fixes and re-running.

RED (`404c922` sources, new tests kept) — Node 22:
```sh
npx vitest run src/routes/document-integrations.test.ts -t "F1:|F5:"   # 3 failed | 33 skipped, exit 1
npx vitest run src/request-permissions.test.ts                          # 4 failed | 8 passed (12), exit 1
```
- F1: `parseMutation({kind:'update_slide_text',slideRef,elementRef:'title',text:'Revised'})` did NOT
  throw — got `{kind:'slide',slideId}` (elementRef/text dropped).
- F5 non-array `values` → got `403 CAPABILITY_UNSUPPORTED` (silently coerced to ``''`` then failed in
  the unsupported lane) instead of `400 INVALID_REQUEST`.
- F5 non-string `target.anchor` → got `200` (anchor silently skipped) instead of `400 INVALID_REQUEST`.
- F4: `resolveCustomerWorkspaceScope` undefined (not yet exported) — 4 request-permissions tests fail.

GREEN (fixed sources):
```sh
npx vitest run src/routes/document-integrations.test.ts -t "F1:|F5:|F2:"   # 5 passed, exit 0
npx vitest run src/request-permissions.test.ts                              # 12 passed (12), exit 0
```

F2 is a coverage-gap fix on existing 409 code (the branch is exercised only via the new negative tests);
it passed on `404c922` and stays green, so no RED needed for F2.

### Round-3 verification (final HEAD, Node 22)

Commands actually run this round (exit codes in `#` comments):

```sh
# 1. Focused T-008 + request-permissions + carry-forward suites
cd packages/server && npx vitest run src/routes/document-integrations.test.ts \
  src/request-permissions.test.ts src/document-providers/write-policy.test.ts \
  src/document-providers/registry.test.ts src/document-providers/capability-resolver.test.ts \
                                                                   # 5 files / 153 tests / exit 0

# 2. Strict tsc build
cd packages/server && npm run build                             # tsc strict / exit 0

# 3. Full server suite at final HEAD
cd packages/server && npx vitest run                            # 208 files / 1874 tests / exit 0

# 4. Diff hygiene
git diff --check                                                # clean / exit 0
git status --short                                              # only scoped paths; clean after commit
```

The full-suite count rose from `1862` (r2) to `1874` (r3): +5 route tests (F1, F2×2, F5×2) and +7
request-permissions tests (F4) = +12, matching `1862 + 12 = 1874`.
