# THE-952 (LOOM-DOCS T-011) — Integrate search and associations — EVIDENCE

## Scope

Integrate managed documents with Entity search/indexing (R-029) and preserve Entity-owned
work-object associations across provider moves/renames (R-030), so the Entity workspace keeps its
value around artifacts and the UI can identify stale/degraded indexing.

R-029 (search/indexing): managed documents participate in Entity search/indexing; index state is
tracked independently from provider modified time; successful document changes invalidate (or
refresh) search state; indexing failure does NOT falsely mark the provider write as failed; the UI
can identify stale/degraded indexing. R-030 (associations): a document's Entity
workspace/project/task/File Source associations are Entity-owned metadata, not provider folders, so
moving/renaming a provider document never removes them.

- Base (reviewed HEAD, T-010 approved): `294194842ef092ee43995f0f36bef8d727df6e97`
- Branch: `runner/entity-document-integrations-20260818` (no merge, no push)
- Node used everywhere: **v22.22.2** (per the task — Node 26 has a better-sqlite3 ABI mismatch)
- Final SHA: see final answer (this file must not contain its own SHA).

## Allowed paths touched (only)

- `packages/db/src/index.ts` — R-029 persistence: `NativeDocumentSearchIndexState` vocabulary;
  three optional fields on `NativeDocumentRecord`/`CreateNativeDocumentInput`
  (`last_indexed_at`, `search_index_state`, `last_index_error`); `markNativeDocumentIndexed` /
  `markNativeDocumentIndexFailed` on the `DocumentObjectRepository` interface AND implemented on the
  real `createDocumentObjectRepository()`; `native_documents` schema columns (DDL + guarded
  `ALTER TABLE` for existing DBs); `mapNativeDocumentRow` maps the three new fields;
  `createNativeDocument` defaults to `stale`/null; `updateNativeDocumentVersion` invalidates
  (stale/null/null) on every successful content write.
- `packages/server/src/document-objects.ts` — `POST /native-documents/:id/index-result` route
  (validates state against the closed four-value vocabulary, fail closed on unknown → 400;
  dispatches `fresh`→markNativeDocumentIndexed and `stale|degraded|indexing_failed`→
  markNativeDocumentIndexFailed), write-permission-gated.
- `packages/server/src/routes/scoped-search-documents.ts` — `ScopedSearchResult` gains
  `indexState`; `nativeResult` now surfaces the independent index state (`indexed`/`indexedAt`/
  `indexState`) from the record so the UI can identify stale/degraded indexing.
- `packages/server/src/document-objects.test.ts` — T-011 R-029/R-030 tests (route-level HTTP tests
  with the in-memory fake repo updated for the new fields/methods, `nativeResult` visibility tests,
  and a real-repository (better-sqlite3) integration test); +9 tests.
- `docs/plans/evidence/entity-document-integrations/T-011/EVIDENCE.md` (this file).

Not touched, per the allowed-path contract / rule-outs:

- `docs/loom/entity-document-integrations/phase2-canonical-prd.md` — **read-only authority**, not edited.
- `packages/server/src/routes/scoped-search.ts` and `scoped-search.test.ts` — NOT edited; the
  existing `nativeResult` (which they consume) already flows to the search surface, and adding the
  index fields is backwards-compatible (optional field). Verified the full server suite stays green
  (211 / 1944) with no change to those files.
- No other files edited. Provider adapters, receipt-writer, migration inventories,
  `.project-gate.json`, OpenWiki, and all other document-providers files are untouched.

---

## Verbatim acceptance & authority quotes

### T-011 ticket block (PRD `phase2-canonical-prd.md`, `### T-011` ~:3790, verbatim)

> **T-011 — Integrate search and associations**
>
> Goal/value: Preserve Entity workspace value around artifacts.
>
> Dependencies: T-004.
>
> Acceptance: R-029/R-030.
>
> Automated proof: reindex and provider move tests.

### R-029 — Search and indexing (PRD ~:1599, verbatim)

> **R-029 — Search and indexing**
>
> Managed documents must participate in existing Entity search/indexing where supported.
>
> Index state must be tracked independently from provider modified time.
>
> Acceptance criteria
>
> successful document changes invalidate or refresh search state;
>
> indexing failure does not falsely mark the provider write as failed;
>
> UI can identify stale/degraded indexing where relevant.
>
> Validation
>
> Search refresh integration test.
>
> Index failure/retry test.

### R-030 — Work-object associations (PRD ~:1618, verbatim)

> **R-030 — Work-object associations**
>
> A document may be associated with Entity workspace/project/task/File Source objects using existing
> association conventions where possible.
>
> Associations are Entity-owned metadata and must not depend on provider folders.
>
> Acceptance criteria
>
> Moving a provider document does not remove its task/project association.
>
> Validation
>
> Move/rename association regression test.

### Validation matrix rows (PRD ~:3584–3585, verbatim)

> R-029	Search	reindex/retry test
>
> R-030	Associations	move/rename test

---

## Implementation summary

### R-029 — independent search/index state, isolated from provider-write success

- **Refreshed on successful indexing and independent of modified time.** A new `index-result`
  endpoint records a re-index outcome. `state: "fresh"` calls `markNativeDocumentIndexed(id,
  indexedAt)` which sets `search_index_state='fresh'`, `last_indexed_at=<indexedAt>` and clears
  `last_index_error`, while leaving every provider-write field — and `updated_at` — untouched. The
  index timestamp is tracked independently of the document's own modified time (verified:
  `updated_at` is unchanged after a fresh index; `updated_at` <> `last_indexed_at`).
- **Successful document changes invalidate search state.** `updateNativeDocumentVersion`
  (the provider write path, which handles content changes AND stable_path moves/renames) sets
  `search_index_state='stale'`, `last_indexed_at=NULL`, `last_index_error=NULL` on every successful
  write.
- **Indexing failure never falsely marks the provider write as failed.** `state:
  "indexing_failed"` (or `degraded`/`stale`) calls `markNativeDocumentIndexFailed(id, error, state)`,
  which touches only `search_index_state` + `last_index_error` — the document's write lifecycle
  fields (content_hash, version, lifecycle_state, linked refs, timestamps) are untouched. A prior
  provider write remains successful and the document stays readable; only the index metadata records
  the failure for retry visibility.
- **UI can identify stale/degraded indexing.** `ScopedSearchResult` carries an `indexState`
  (`fresh|stale|degraded|indexing_failed`) plus `provenance.indexed`/`provenance.indexedAt` derived
  independently of the document modified time, so a consumer can show "stale"/"degraded"/"index
  failed" and retry.
- **Fail-closed validation.** The route accepts only the closed four-value vocabulary; an unknown
  state (e.g. `sneaky_supported`) returns 400 before any repository write, leaving the document's
  lifecycle untouched.

### R-030 — Entity-owned associations survive provider move/rename

- Associations are stored as Entity-owned metadata in `linked_object_refs_json` (the existing
  association convention), NOT in any provider folder path. The move path is
  `updateNativeDocumentVersion` with a changed `stable_path`; it rewrites only `stable_path`
  (+ content/index invalidation) and leaves `linked_object_refs` intact.
- Tested at both layers: the HTTP route (PATCH changes `stable_path`, task/project/File Source
  associations all preserved on the write response and on a fresh read) and the real
  better-sqlite3 repository (`updateNativeDocumentVersion` with a new `stable_path` preserves
  `task`/`project` associations).

### Real repository (better-sqlite3) regression

`createDocumentObjectRepository()` (the production SQL path) implements the new methods and row
mapping, exercised by a real-repo integration test using the `ENTITY_TASK_DB_PATH` temp-DB switch
(same pattern as the db test suite), so the genuine SQL insert/update/select paths run for create
defaults, fresh-mark, write-invalidation, failure-mark, retry-to-fresh, and move-association
preservation.

---

## TDD: RED → GREEN proof

### RED — new tests against the reviewed base implementation

Temporarily restoring only the three implementation files to base `2941948` (db index,
document-objects, scoped-search-documents — tests kept as-is) and running the focused file:

Command (Node 22, working runner):

```sh
cd <repo-root> && node_modules/.bin/vitest run src/document-objects.test.ts
```

Result (RED, exit 1):

```
Test Files  1 failed (1)
     Tests  7 failed | 17 passed (24)

 FAIL ... nativeResult exposes index state > ... > expected undefined to be 'stale' (indexState missing)
 FAIL ... real repository ... > tracks native search index state independently ... > expected undefined to be 'stale'
 ... (7 T-011 R-029/R-030 tests fail: no index-result route, no repo methods, no index fields)
```

The 17 pre-existing tests still pass; exactly the 7 new R-029/R-030 tests that depend on the new
index fields/routes/methods fail (the other 2 of the 9 new tests, e.g. `secondsSince`, are
pure-function and pass). This reproduces the reviewer's expectation that the feature is absent at
base.

### GREEN — focused (final HEAD)

Command:

```sh
cd <repo-root> && node_modules/.bin/vitest run src/document-objects.test.ts
```

Result (GREEN, exit 0):

```
 ✓ packages/server/src/document-objects.test.ts (24 tests) 88ms

 Test Files  1 passed (1)
      Tests  24 passed (24)
```

### GREEN — strict tsc build

```sh
cd packages/server && npm run build
```

Result: **exit 0** (strict tsc).

### GREEN — full server suite (task verification, final HEAD)

```sh
cd packages/server && <repo-root>/node_modules/.bin/vitest run
```

Result: **211 test files passed, 1944 tests passed** (exit 0) — the 1935 pre-existing / T-010 count
plus **9 new T-011 tests** (all in `document-objects.test.ts`). No existing test broke.

### GREEN — db suite (required because packages/db/src/index.ts is touched)

```sh
cd packages/db && <repo-root>/node_modules/.bin/vitest run
```

Result: **22 test files passed, 185 tests passed** (exit 0).

### Runner note (pre-existing environment conflict, NOT a code change)

Identical to T-010: `packages/server/node_modules/vitest@4.1.2` cannot start under Node 22 in this
checkout — its `dist/chunks/cac.*.js` does `import { isAgent } from 'std-env'`, but Node's ESM
resolution from that chunk hits the hoisted root `node_modules/std-env@3.10.0` (which lacks
`isAgent`) instead of the `packages/server/node_modules/std-env@4.0.0` the server vitest wants — a
dual-major `std-env` hoisting conflict. This is **pre-existing** (occurs before any test loads, with
no production edits) and is NOT caused by this diff. The working equivalent invocation is the
repo-root `node_modules/.bin/vitest@4.0.18`, used for every proof command above;
`cd packages/server && npx vitest run` reproduces only the pre-existing crash.

`npm run ctrl:gate`:

```sh
npm run ctrl:gate
```

Result: **exit 1** — root `npm run build` (app + db + server, strict tsc) **passed**, then
`@entity/db` workspace unit tests **passed (22 files / 185 tests)**, then `@entity/server test`
(`npx vitest run`) hit the SAME pre-existing `std-env` `isAgent` crash described above. This is not
a regression from T-011; the substantive gate content (strict build + full unit suite) passes under
the working runner. `.project-gate.json` was left unchanged (see Rule-outs).

### Additional checks

- `git diff --check` — **exit 0** (no whitespace/EOF errors).
- App build is unaffected (no app files touched); the gate ran `npm --prefix packages/app run build`
  as part of the root build and it passed.

---

## R-029 automated proof — independent index state, refresh, invalidation, isolation, fail-closed

`document-objects.test.ts` (route-level, in-memory fake repo):

1. **Fresh index refreshes state independently of provider modified time.** Create → `stale`/null;
   `index-result {state:'fresh', indexed_at}` → `fresh` + `last_indexed_at`, `last_index_error`
   null, and `updated_at` unchanged; a GET re-read confirms `content_hash`/`version` untouched (no
   rewrite) with the independent index timestamp.
2. **Successful write invalidates search state.** After a fresh index, a PATCH content write returns
   `search_index_state:'stale'`, `last_indexed_at:null`.
3. **Indexing failure does NOT falsely mark the provider write as failed; retry clears it.** Create
   returns 201 (write succeeded); `index-result {state:'indexing_failed', error}` → 200 with
   `indexing_failed` + `last_index_error`; the document stays readable with `content_hash`, `title`,
   and `linked_object_refs` intact; a later `{state:'fresh'}` retry returns to `fresh` and clears
   `last_index_error`.
4. **Fail-closed unknown state.** `index-result {state:'sneaky_supported'}` → **400**, and the
   document lifecycle is unaffected (still `stale` on read).

### real-repository (better-sqlite3) automation

The real `createDocumentObjectRepository()` (SQL insert/update/select) is driven end-to-end: create
defaults to `stale`/null; `markNativeDocumentIndexed` → `fresh` + timestamp; `updateNativeDocumentVersion`
invalidates to `stale`/null; `markNativeDocumentIndexFailed` records `indexing_failed` while the
document's `content_hash` is untouched; retry-to-`fresh` clears the error.

### search-visibility automation (`scoped-search-documents.ts`)

`nativeResult` now surfaces the independent index state so the UI can identify stale/degraded
indexing: a `fresh` record → `provenance.indexed:true`, `indexedAt` set, `indexState:'fresh'`; a
`stale` record → `provenance.indexed:false`, `indexedAt:null`, `indexState:'stale'`; an
`indexing_failed` record → `indexState:'indexing_failed'`. `secondsSince` computes index lag
independently of the document modified time (28h → 100800s).

---

## R-030 automated proof — move/rename preserves Entity-owned associations

`document-objects.test.ts`:

- Route-level: create a document with `task`/`project`/`file_source` `linked_object_refs`, then PATCH
  with a changed `stable_path` (a provider move/rename). The write response AND a fresh GET re-read
  both return the new `stable_path` with all three associations intact.
- real-repository: `updateNativeDocumentVersion` with a new `stable_path` preserves `task`/`project`
  associations.

Associations are Entity-owned `linked_object_refs` metadata stored independently of any provider
folder path — moving the provider document's `stable_path` cannot remove them.

---

## Privacy / security

No credentials, raw tokens, tenant secrets, or new secret handling are introduced (R-031 remains
untouched). The `index-result` endpoint records a caller-supplied index outcome/error under the
document's existing `write` permission gate; `last_index_error` is only surfaced back through the
same permission-safe record envelope as the rest of the document. The `indexState` field is a closed
four-value vocabulary string — no confidential content. All test data is synthetic (`r029-*`,
`r030-*`), timestamps are fixed, and the only "provider" is the deterministic in-memory fake or an
isolated temp DB — no network, no real provider credentials.

---

## Rule-outs

- **PRD is read-only authority.** `docs/loom/entity-document-integrations/phase2-canonical-prd.md`
  was NOT edited. The known open item — authority pin `83cacbc…` vs in-tree PRD hash `c82e82d…` —
  is pending Henry's decision; the in-tree PRD content was used as read-only authority and the
  resolution is not part of this ticket.
- **`scoped-search.ts` / `scoped-search.test.ts` not edited.** The existing native-document search
  flow already consumes `nativeResult`; adding the optional `indexState` field is non-breaking and
  the full server suite (211 / 1944) stays green with these files untouched.
- **No second receipt store / no provider-adapter wiring.** T-011 only integrates index state and
  associations into the existing document-object surfaces; it does not touch receipt-writer, the
  provider registry, or route wiring owned by later tickets (T-014+). R-031 secrets and provider
  adapters are out of scope and untouched.
- **`.project-gate.json` unchanged.** The only observed gate deviation is the pre-existing
  server-workspace `std-env`/vitest hoisting crash described under Runner note, which is
  environmental (affects `npx vitest run` for ANY task in this checkout) and not a gate-logic defect.
- **Allowed paths / other files untouched.** Only the five allowed paths above were edited. OpenWiki
  regeneration, migrations inventories, migration.ts, routes/document-integrations.ts, and all other
  packages are unchanged.

---

## Unresolved risk

- **Search refresh is contract-provided, not auto-triggered.** T-011 ships the tested contract
  (state recorded via `index-result`; writers invalidate on change), but nothing yet *calls* the
  `index-result` endpoint with real provider search results — that wiring belongs to a real
  provider-adapter round (T-014+), mirroring the T-010 adapter-deferral posture. Until then the state
  is recorded by whatever agent/provider-adapter honors the contract.
- **`indexed`/`indexState` semantics for a stale doc with a prior index.** `provenance.indexed`
  reflects "has been indexed at least once" (`last_indexed_at` present); a stale-but-previously-
  indexed doc reports `indexed:true` while `indexState:'stale'` is what the UI keys on for
  staleness. No acceptance requires `indexed` to be false for stale docs.
- **`degraded`/`stale` explicit `index-result` states** are accepted and stored but not yet driven by
  any real caller; they fail closed (400) for unknown inputs and are reversible.
