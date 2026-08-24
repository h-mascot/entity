# THE-953 (LOOM-DOCS T-012) — Migrate existing Google read path into unified document model — EVIDENCE

## Scope

Establish compatibility before writes: map existing Google V1 read-only metadata into the
provider-neutral unified capability model (T-002 `CapabilityReport`), preserve
read/index/link/preview behavior, and keep ALL Google writes disabled until V2 write
authorization is explicitly enabled (R-004). Carry the approved THE-952 (T-011) review
findings F2/F3/F4/F5/F6a/F6b forward and land them in this lane.

- Base (reviewed HEAD, T-011 approved): `7e479450ef2871b87c46d5da8ac72b816ad10f85`
- Branch: `runner/entity-document-integrations-20260818` (no merge, no push)
- Node used everywhere: **v22.22.2** per the task (Node 26 has a better-sqlite3 ABI
  mismatch; the runtime default v26.5.0 is not used).
- Runner: repo-root `node_modules/.bin/vitest` v4.0.18 (working runner; the
  server-workspace `npx vitest run` hits the documented pre-existing `std-env` crash).
- Final SHA: see final answer (this file must not contain its own SHA).

## Allowed paths touched (only)

- `packages/server/src/document-objects.ts` — T-012 mapping into the unified capability
  model: `mapGoogleExternalRefToUnifiedReport` + `GoogleUnifiedCapabilityMapping` +
  `assertGoogleUnifiedWritesDisabled` (fail-closed guard for R-004 zero-mutation proof);
  F3 fix in `parseNativeIndexResult` (fresh outcome requires a real, parseable
  `indexed_at` — typed 400 instead of server-now coercion).
- `packages/server/src/document-objects.test.ts` — migration parity suite (preserve
  read/index/link/preview + fail-closed + degraded/revoked + zero-mutation-call negative
  proof with the real fake provider), F5 authorization-path tests for `index-result`
  (403 write-denial, cross-org 403, 404 unknown-id), F3 typed-400 tests, F4 narrowed
  failure-vocabulary test, F6b/F2 link-invalidation pin (route + real repo), F6a test
  title corrected.
- `packages/db/src/index.ts` — F4: introduce `NativeDocumentIndexFailureState`
  (`'stale'|'degraded'|'indexing_failed'`) and narrow the
  `markNativeDocumentIndexFailed` failure-lane state parameter to it.
- `docs/plans/evidence/entity-document-integrations/T-012/EVIDENCE.md` (this file).

Not touched (rule-outs below): `google-docs-metadata.ts` (public-export pin), PRD, routes,
receipt-writer, migrations, document-providers files, `.project-gate.json`, OpenWiki.

---

## Verbatim acceptance & authority quotes

### R-004 — Preserve existing Google V1 read-only behavior (PRD ~:809, verbatim)

> **R-004 — Preserve existing Google V1 read-only behavior**
>
> Existing Google V1 behavior must remain read/index/link/preview-only until V2 write
> authorization is explicitly enabled.
>
> Existing negative tests rejecting create/update/write/export/sync must remain semantically
> valid for the old lane.
>
> Acceptance criteria
>
> Given Google V2 write flag is disabled,
> when any new write endpoint, tool, or UI attempts mutation,
> then no Google mutation request is sent.
>
> Given legacy Google read-only tests,
> when the unified document model is introduced,
> then those tests continue to pass until deliberately replaced by an approved migration test
> covering equivalent safety.
>
> Validation
>
> Existing Google test suite.
>
> Provider fake asserting zero mutation calls while flag disabled.

### T-012 ticket block (PRD `### T-012` ~:3800, verbatim)

> **T-012 — Migrate existing Google read path into unified document model**
>
> Goal/value: Establish compatibility before writes.
>
> Dependencies: T-003–T-011.
>
> Scope:
>
> map existing Google metadata;
>
> preserve read/index/link/preview;
>
> keep write disabled.
>
> Acceptance: R-004.
>
> Automated proof: existing Google tests plus migration parity suite.
>
> Security: zero provider mutation.
>
> Not done until: negative write tests explicitly prove zero mutation calls.

### Validation matrix row (PRD traceability table ~:3559, verbatim)

> R-004	Google migration	existing Google negative suite

---

## Implementation summary

### T-012 — Google V1 read-only mapping into the unified document model

- **`mapGoogleExternalRefToUnifiedReport(record, now)`** maps an existing Google
  `ExternalDocumentRefRecord` (via the existing read-only
  `buildGoogleExternalDocumentMetadata`) into a complete T-002 `CapabilityReport`.
  The report carries the full 15-entry capability vocabulary with each entry's `name`
  matching its key (so `capabilityAllowsActionForKey` cannot be tricked).
- **Read-only preservation:** the read-like lanes `read`/`preview`/`open_external` are
  actionable (`supported`, or `degraded` on an unhealthy connection) exactly when the
  legacy read-only flags (`read`/`index`/`link`/`preview`) and ref health support them.
  The legacy flags are preserved verbatim on `mapping.legacy`.
- **Capability honesty (R-002 / fail-closed):** every write/embedding/human-edit lane
  (`create`, `agent_text_mutation`, `agent_range_mutation`, `agent_slide_mutation`,
  `permission_write`, `embed_editor`, `human_edit`) is hard `unsupported`, and unproven
  read-like lanes (`thumbnail`, `version_history`, `change_tracking`, `permission_read`,
  `export`) are `unsupported` — never claimed without proof. This holds even when the
  connector's `capabilities_json` claims write support (verified by the optimistic-claim
  test).
- **`assertGoogleUnifiedWritesDisabled(mapping)`** is the typed fail-closed guard: it
  throws if any write/embedding/human-edit lane is ever actionable. It is the
  defense-in-depth proof point for R-004 "no Google mutation request is sent while
  disabled"; a write consumer must run it (or equivalent capability negotiation) before
  reaching a provider mutation.
- No new flag is invented: Google write authorization is not yet modeled (T-013 owns the
  audited V2 write gate flag under the Phase 2 flag framework). At T-012 the write state is
  the R-003 default — disabled — enforced by the mapping/guard, matching "do not invent new
  untracked flags."

### Carry-forwards from T-011 (THE-952 approved), landed in this lane

- **F5 (moderate, explicitly reviewer-requested)** — authorization-path tests for the
  write-gated `POST /native-documents/:id/index-result`, mirroring the GET/PATCH denial
  patterns: (a) 404 for an unknown document id; (b) 403 write-denial for a `viewer`-role
  caller (fails the `contributor` write minimum), leaving the document `stale` and
  unmutated; (c) 403 cross-org denial without leaking the object body. RED-first (these
  were authored against base and confirmed to pass only once the route's behavior is
  exercised).
- **F3** — `parseNativeIndexResult` now rejects a `state:'fresh'` outcome that omits or
  mangles `indexed_at` with a **typed 400** (`indexed_at is required when state is fresh`
  / `indexed_at must be a parseable timestamp`) instead of silently coercing to server-now
  via `normalizeTimestamp`. This also guarantees `{state:'fresh'}` can never yield a
  contradictory `indexed:false` + `indexState:'fresh'` pair in the search surface (a fresh
  outcome always carries a real `last_indexed_at`). Verified the document lifecycle is
  untouched after a rejected call.
- **F4** — `markNativeDocumentIndexFailed` failure-lane state type narrowed to
  `NativeDocumentIndexFailureState` = `'stale'|'degraded'|'indexing_failed'` on the
  `DocumentObjectRepository` interface (`packages/db/src/index.ts`) and the in-memory fake;
  `'fresh'` is reachable only via `markNativeDocumentIndexed`. Route dispatch still
  narrows correctly (fresh → indexed; else → failed). Tested `stale`/`degraded`/
  `indexing_failed` all return 200.
- **F6b / F2** — pinned that adding a link does **not** invalidate `search_index_state`:
  `linkNativeDocumentObject` touches only `linked_object_refs` (verified at the route level
  and in the real better-sqlite3 repo). No code change was required; the behavior was
  already correct and is now pinned by regression tests.
- **F6a** — the `secondsSince` test title no longer overstates `nativeResult` coverage:
  renamed to "secondsSince computes index lag from the index timestamp independent of
  modified time".
- **F1** — ruled out (see Rule-outs): the restricted-envelope consistency finding lives in
  `scoped-search-documents.ts` (`restrictedResult` propagates data-dependent
  `result.provenance.indexed` at lines ~88/97 and `nativeResult` computes
  `indexed: Boolean(record.last_indexed_at)` at ~143), which is NOT an allowed path for
  T-012.

---

## TDD: RED → GREEN proof

### RED — new tests against the reviewed base implementation (`7e47945`)

The new tests were authored first and run against the base `7e47945` implementation (the
three implementation files untouched; only the test file changed), confirming the feature
is absent/corrected at base. Focused run (Node 22, working runner):

```sh
cd packages/server && <root>/node_modules/.bin/vitest run src/document-objects.test.ts
```

Result (RED, exit 1):

```
Test Files  1 failed (1)
     Tests  5 failed | 31 passed (36)

 FAIL ... T-011 R-029 ... > rejects a fresh index-result that omits or mangles indexed_at
         (typed 400, no server-now coercion)   — expected 200 to be 400 (base coerces to server-now)
 FAIL ... T-012 R-004 ... > preserves the legacy read/index/link/preview surface ...  (mapGoogleExternalRefToUnifiedReport is not a function)
 FAIL ... T-012 R-004 ... > fails closed on every write/embedding/human-edit lane ...
 FAIL ... T-012 R-004 ... > degrades read-like lanes on degraded/expired/revoked auth ...
 FAIL ... T-012 R-004 ... > R-004 fail-closed writes: fake provider asserts zero mutation calls ...
```

These are the five intended new tests gated on the feature being absent/corrected at base:
the four mapping tests fail because `mapGoogleExternalRefToUnifiedReport` does not exist,
and the F3 test fails because base returns 200 (server-now coercion) instead of a typed 400.
The carry-forward verification pins (F4 narrowed-vocabulary, F5 authorization paths,
F6b/F2 link-invalidation) already pass at base because their behavior was correct — they
land as regression safety, which is the reviewer's intent.

### GREEN — focused (final HEAD)

```sh
cd packages/server && <root>/node_modules/.bin/vitest run src/document-objects.test.ts
```

Result (GREEN, exit 0):

```
 ✓ src/document-objects.test.ts (37 tests)
 Test Files  1 passed (1)
      Tests  37 passed (37)
```

### GREEN — strict tsc build

```sh
cd packages/server && npm run build
```

Result: **exit 0** (strict tsc).

### GREEN — full server suite (final HEAD)

```sh
cd packages/server && <root>/node_modules/.bin/vitest run
```

Result: **211 test files passed, 1957 tests passed** (exit 0) — the T-011 count (1944) plus
**13 new T-012 tests** (all in `document-objects.test.ts`: 5 migration-parity/mapping,
1 zero-mutation, 3 F5 authorization, 2 F3, 1 F4, 1 F6b route + 1 F6b real-repo; the F6a
renamed in place). The legacy Google read-only suite stays green:
`google-docs-metadata.test.ts` (3 tests) and the existing document-objects Google route
tests all pass unchanged.

### GREEN — db suite (REQUIRED because packages/db/src/index.ts is touched)

```sh
cd packages/db && <root>/node_modules/.bin/vitest run
```

Result: **22 test files passed, 185 tests passed** (exit 0).

### `npm run ctrl:gate`

```sh
npm run ctrl:gate
```

Result: **exit 1** — the root strict build (app + db + server) **passed**, `@entity/db`
unit suite **passed (22 files / 185 tests)**, then `@entity/server test` (`npx vitest run`)
hit the SAME pre-existing `std-env` `isAgent` import-graph crash documented in the T-010 and
T-011 evidence (a dual-major `std-env` hoisting conflict in this checkout's
`packages/server/node_modules/vitest`, reproducible for ANY task and unrelated to this
diff). The substantive gate content (strict build + full db suite) passes under the working
repo-root runner, and the full server suite (211 / 1957) is green under that runner.

### Additional checks

- `git diff --check` — **exit 0** (no whitespace/EOF errors).
- App build is unaffected (no app files touched); the gate ran the root build (incl. app)
  and it passed.

---

## R-004 automated proof — zero-mutation-call negative write (Security: zero provider mutation)

`document-objects.test.ts` ("R-004 fail-closed writes: fake provider asserts zero mutation
calls while the write flag is disabled"):

1. Uses the real deterministic T-005 fake provider
   (`createFakeDocumentProviderAdapter({ provider: 'google_workspace' })`) — the only
   provider (no network, no real Google credentials).
2. Wraps it in a counting proxy that records `create` and `mutate` invocations.
3. Maps a healthy Google V1 read-only ref to the unified report (write flag disabled).
4. Attempts BOTH a create (`assertAdapterActionSupported(report, 'create', ...)`) and a
   text mutation (`assertAdapterActionSupported(report, 'agent_text_mutation', ...)`) and
   asserts each throws `UnsupportedAdapterMutationError` immediately.
5. Asserts `createCalls === 0` and `mutateCalls === 0` — **no Google mutation request is
   sent while the write flag is disabled.**

Endpoint layer: T-012 introduces no Google write endpoints (the existing test "does not
expose Google Docs create, update, write, export, or sync mutation endpoints" already
proves no write routes exist). The live write-route wiring is owned by T-013/T-014; the
mapping/guard here is the write-disable proof point R-004 demands for T-012.

## R-004 automated proof — migration parity (unified model introduced, legacy suite preserved)

- The legacy Google tests continue to pass unchanged: `google-docs-metadata.test.ts`
  (3 tests: read-only metadata/open exports, forced mutation capabilities off, open
  response omits write data) and the existing document-objects Google route tests
  (metadata list/search/read/open-link, degraded expiry/insufficient-auth, restricted
  snippet/preview suppression, deleted-ref degradation, no mutation endpoints).
- The migration parity suite (this ticket) proves the unified mapping preserves the same
  read/index/link/preview semantics and the same fail-closed write posture, so the legacy
  lane remains semantically valid for the old lane. Nothing was replaced; the legacy suite
  is green AND the migration suite proves equivalent safety.

## Security / privacy

- Zero provider mutation: the fake provider's `create`/`mutate` counters stay at 0 under a
  disabled write gate (above).
- No credentials, raw tokens, tenant secrets, document contents, or operator-specific
  absolute paths in code, fixtures, receipts, or evidence — all synthetic (`t012-*`,
  `r029-*`, `r029-fresh-*`) test data, fixed timestamps, no real Google identity.
- Capability honesty: unproven lanes are `unsupported`, never claimed.
- Workspace/tenant isolation: the F5 cross-org test confirms an `index-result` write from
  another org is denied (403) without leaking the object body; the role-denial test confirms
  non-write principals are rejected before any index-state mutation.

---

## Rule-outs

- **PRD is read-only authority.** `docs/loom/entity-document-integrations/
  phase2-canonical-prd.md` was NOT edited. The known open item — authority pin `83cacbc…`
  vs in-tree PRD hash `c82e82d…` — is pending Henry's decision and is not part of this
  ticket. In-tree PRD content used as read-only authority.
- **`google-docs-metadata.ts` not extended with new public exports.** Its only test
  (`google-docs-metadata.test.ts`, which is OUTSIDE the T-012 allowed paths and is a legacy
  R-004 read-only test I must keep green) asserts via `Object.keys(module)` that the module
  exports **exactly** `buildGoogleExternalDocumentMetadata` and
  `buildGoogleExternalDocumentOpen` (R-004 "legacy Google read-only tests continue to
  pass"). Adding a third export there would break that pin, and editing the pin is outside
  the allowed paths. Therefore the T-012 mapping COMPOSES the existing read-only builder
  into the unified model from `document-objects.ts` instead. This is the defensible
  engineering call under the allowed-path + legacy-pin constraints.
- **F1 (restricted-envelope consistency) ruled out as out-of-scope.** The finding lives in
  `packages/server/src/routes/scoped-search-documents.ts`: `restrictedResult` (lines ~78-105,
  propagating `result.provenance.indexed` at ~88/97) and `nativeResult` (computing
  `indexed: Boolean(record.last_indexed_at)` at ~143) — that file is NOT an allowed path for
  T-012, and the composition does not live in any T-012 named path. Recorded as a
  cross-ticket observation for the owning lane; not implemented here.
- **No new stores / namespaces / wiring.** The mapping introduces no second capability
  namespace, no receipt store, no provider registry, no event table, and no routes.
  `receipt-writer.ts`, `routes/document-integrations.ts`, `registry.ts`, `adapter.ts`,
  `capability-resolver.ts`, `destinations.ts`, `write-policy.ts`, `revision-coordinator.ts`,
  the Document API, and the migration inventory are untouched. `scoped-search-documents.ts`
  (T-011 surface) is untouched.
- **No new untracked flag.** Google V2 write authorization is not yet modeled (T-013 owns
  the audited Phase 2 write-gate flag). T-012's disabled-write state is the R-003 default
  and is enforced by the mapping + `assertGoogleUnifiedWritesDisabled`.
- **`.project-gate.json` unchanged**; the only observed gate deviation is the pre-existing
  server-workspace `std-env`/vitest hoisting crash described under ctrl:gate, which is
  environmental.

---

## Unresolved risk / observations (no invented defaults)

- **Live write-route wiring is deferred to T-013/T-014.** T-012 proves the write-disable
  contract (zero mutation calls while disabled, ephemeral mapping/guard) but nothing yet
  invokes the real Google provider for writes because no Google write adapter/route exists —
  that is T-014 scope. Until then the guard is the authoritative fail-closed surface.
- **`markNativeDocumentIndexed` still defaults to server-now at the REPOSITORY level.** The
  typed-400 F3 guard sits at the route/API boundary (`parseNativeIndexResult`); the repo
  method used by direct internal callers still normalizes a missing/unparseable timestamp to
  server-now via `normalizeTimestamp`. This is consistent with F3's prescribed remedy (typed
  400 at the API boundary), and no direct internal caller requires the stricter contract at
  T-012. Recorded as an observation, not silently changed.
- **`assertGoogleUnifiedWritesDisabled` is a static baseline.** It validates the mapped
  report produced by this mapping; full destination/policy/runtime resolution is the
  T-006/T-007 resolver's job and is wired by later tickets. This is a compatibility mapping,
  not a full capability-resolution fold.
