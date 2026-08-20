# THE-950 (LOOM-DOCS T-009) — Implement Revision Coordinator — EVIDENCE

## Scope

A Revision Coordinator module that owns mutation preconditions and stale-write rejection
(PRD §10.1), enforcing R-024 (revision-aware mutation) and R-025 (standard conflict response) for
every mutation lane (document/text, sheet/range, slide), with an unsafe provider that cannot
establish a safe current revision failing closed.

- Base (reviewed HEAD, T-008 approved): `33105b954de979b5159c14ae4ea43efbacc5c0d2`
- Branch: `runner/entity-document-integrations-20260818` (no merge, no push)
- Node used everywhere: **v22.22.2** (per the task — Node 26 has a better-sqlite3 ABI mismatch)
- Final SHA: see final answer (this file must not contain its own SHA).

## Allowed paths touched (only)

- `packages/server/src/document-providers/revision-coordinator.ts` (new — the coordinator)
- `packages/server/src/document-providers/revision-coordinator.test.ts` (new — concurrent-writer tests, 12 tests)
- `packages/server/src/routes/document-integrations.ts` (wired the coordinator into the mutate route; 409 `STALE_REVISION` contract preserved exactly)
- `packages/server/src/routes/document-integrations.test.ts` (route-level integration + carry-forward RED→GREEN guards; 6 new T-009 tests; existing T-008 contract tests unweakened)
- `docs/plans/evidence/entity-document-integrations/T-009/` (this directory)

No other files were edited.

---

## Verbatim acceptance & authority quotes

### T-009 ticket block (PRD `phase2-canonical-prd.md`, `### T-009` ~:3762)

> **T-009 — Implement Revision Coordinator**
>
> Goal/value: Eliminate silent stale overwrite.
>
> Dependencies: T-008.
>
> Acceptance: R-024/R-025.
>
> Automated proof: concurrent writer tests.
>
> Security: expected/current revisions sanitized.
>
> Not done until: unsafe provider with no concurrency evidence fails closed.

The task's quoted acceptance ("R-024/R-025", "concurrent writer tests", "expected/current
revisions sanitized", "unsafe provider with no concurrency evidence fails closed") matches this
verbatim ticket block.

### R-024 — Revision-aware mutation (PRD ~:1468, verbatim)

> **R-024 — Revision-aware mutation**
>
> All mutations must participate in the Revision Coordinator.
>
> A provider-specific token may be:
>
> revision ID;
>
> ETag;
>
> change token;
>
> content hash/local revision;
>
> another provider-documented concurrency token.
>
> If the adapter cannot establish a safe current revision, write capability must degrade or require a separately proven safe strategy.
>
> Acceptance criteria
>
> A known stale write never succeeds silently.
>
> Validation
>
> Concurrency tests with two independent writers for each implemented mutation lane.

### R-025 — Standard conflict response (PRD ~:1496, verbatim)

> **R-025 — Standard conflict response**
>
> Provider-neutral API conflict response:
>
> ```json
> {
> "error": {
> "code": "STALE_REVISION",
> "message": "The document changed after this operation was prepared.",
> "documentId": "doc_...",
> "expectedRevision": "rev_17",
> "currentRevision": "rev_18",
> "retryable": true
> }
> }
> ```
>
> No automatic blind retry is allowed.
>
> Acceptance criteria
>
> Conflict response does not contain document secrets or provider credentials and does not overwrite current data.

### §10.1 Revision Coordinator (PRD ~:2107, verbatim)

> Revision Coordinator
>
> Owns mutation preconditions and stale-write rejection.

---

## Implementation summary

### `revision-coordinator.ts` (new)

Provider-neutral coordinator that owns mutation preconditions:

- `readMutationPrecondition({ adapter, externalId, providerConnectionId, mutation })` — reads the
  **authoritative provider current revision** via `adapter.getMetadata`. It never fabricates a
  revision from the registry hint or any secondary source; when the provider exposes none
  (null/empty `current_revision`), `concurrencyProven=false` (R-024 "never proceed on unverifiable
  state").
- `assertMutationPrecondition({ precondition, expectedRevision, documentId })` — fails closed with
  a typed `UnsafeMutationError` when `concurrencyProven=false` ("unsafe provider with no
  concurrency evidence fails closed"); otherwise compares expected vs current and throws the typed
  `StaleRevisionError` on mismatch **before any adapter write** (R-024 / R-025). No automatic blind
  retry (the caller surfaces the 409 once).
- `preflightMutation(...)` — one-step read + assert, used by the route.
- `sanitizeRevisionToken(raw, maxLength=64)` — treats revision tokens as **untrusted strings**:
  strips C0/C1 control characters and HTML metacharacters (`<>"'&\`), bounds length to 64
  (no secrets/credentials bleed, no HTML injection surface).
- `staleRevisionBody(err, documentId?)` — builds the exact §12.3/R-025 envelope
  (`code`, `message`, `documentId`, `expectedRevision`, `currentRevision`, `retryable:true`) with
  **sanitized** expected/current revisions and the fixed message (never embeds raw tokens; no
  document secrets or provider credentials).
- `UnsafeMutationError` — typed fail-closed error (lane + documentId in message; lane is a fixed
  vocabulary value, never a free-form token).

The coordinator introduces **no receipt store, no event table, no new API namespace, and no
competing provider registry** (§13 events / T-010 receipts explicitly ruled out).

### `document-integrations.ts` (wired)

In the mutate route, `preflightMutation` runs **before** `adapter.mutate`; the adapter's own
`mutate` re-checks the revision atomically as defense-in-depth (so even the coordinator-read →
adapter-write race can never commit a stale write silently). The 409 `STALE_REVISION` response
contract is preserved exactly — `code`, `message`, `documentId`, `expectedRevision`,
`currentRevision`, `retryable:true` — now with sanitized token values and the fixed message.
`UnsafeMutationError` maps to the existing typed `CAPABILITY_UNSUPPORTED` (403) fail-closed code
(the lane degrades because no safe current revision can be established), and the
`sendDocumentApiError` StaleRevisionError branch is also sanitized. Workspace/tenant isolation,
typed error codes, and T-006/T-007 capability/destination gating are unchanged at the route
boundary; no new namespace, receipt store, or event table was added.

---

## TDD: RED → GREEN proof

### RED 1 — coordinator test (module did not exist yet)

Command:

```sh
cd packages/server && npx vitest run src/document-providers/revision-coordinator.test.ts
```

Result (RED):

```
 FAIL  src/document-providers/revision-coordinator.test.ts [ ... ]
Error: Cannot find module './revision-coordinator' imported from
  .../revision-coordinator.test.ts
 Test Files  1 failed (1)
```

### RED 2 — route test (coordinator behavior + carry-forward guards not yet implemented)

Command:

```sh
cd packages/server && npx vitest run src/routes/document-integrations.test.ts
```

Result (RED): 5 failed | 37 passed (42)

```
FAIL ... slide lane: present-but-non-string text is a typed INVALID_REQUEST (400), not silently dropped
   AssertionError: expected 403 to be 400
FAIL ... range lane: present-but-non-string sheet is a typed INVALID_REQUEST (400), not silently dropped
   AssertionError: expected 403 to be 400
...

 Test Files  1 failed (1)
      Tests  5 failed | 37 passed (42)
```

(The 3 carry-forward guards returned `CAPABILITY_UNSUPPORTED` instead of `INVALID_REQUEST`, and
the sanitized-409 / no-token-fail-closed route tests failed because those behaviors did not exist.
The fifth failure was the sanitized-409 message/envelope; the no-blind-retry test was already green
because the route never auto-retried even before T-009.)

### GREEN — focused (final HEAD)

Command (task verification #1):

```sh
cd packages/server && npx vitest run src/document-providers/revision-coordinator.test.ts src/routes/document-integrations.test.ts
```

Result (GREEN, exit 0):

```
 Test Files  2 passed (2)
      Tests  58 passed (58)
```

### GREEN — full server suite (task verification #2, final HEAD)

```sh
cd packages/server && npm run build && npx vitest run
```

- `npm run build` (strict tsc): **exit 0**
- `npx vitest run`: **209 test files passed, 1896 tests passed** (exit 0)

### GREEN — root control gate (task verification #3)

```sh
npm run ctrl:gate
```

- First run: 1 flaky pre-existing failure in `src/editor/auth.test.ts`
  ("accepts valid agent bearer tokens without X-Entity-Actor", expected 200 got 404). This test
  spins up a real local HTTP server (`127.0.0.1` ephemeral port) and issues a live `fetch`; under
  heavy full-suite parallelism the local fetch intermittently races. It is **unrelated to T-009**
  (my diff touches only `src/document-providers/revision-coordinator*.{ts}` and
  `src/routes/document-integrations.{ts,test}`; the editor module imports nothing I changed), it
  **passes in isolation** (`npx vitest run src/editor/auth.test.ts` → 5/5, exit 0), and it **passes
  on re-run** of both `npx vitest run` and `npm run ctrl:gate`.
- Re-run: `[ctrl] gate passed ✅`, exit 0.

### Hygiene (task verification #3)

```sh
git diff --check
```

Result: exit 0 (no whitespace errors). Worktree clean after commit.

---

## R-024 automated proof — two independent writers per mutation lane (via the fake adapter)

`revision-coordinator.test.ts` (`describe.each` over the three implemented mutation lanes
`document/text`, `sheet/range`, `slide`; the fake adapter is created with range and slide
capabilities enabled so each lane is exercised through the deterministic fake):

For **each lane** two tests prove R-024 "a known stale write never succeeds silently":

1. **Coordinator pre-write rejection (lost-update prevented):**
   - Writer A reads the authoritative current revision (rev-1), asserts, commits → rev-2.
   - Writer B (a second independent writer) is prepared against the now-stale rev-1; the
     coordinator re-reads the authoritative current revision (rev-2) and throws
     `StaleRevisionError(rev-1, rev-2)`.
   - Proof: a `RecordingAdapter` spy confirms **no adapter mutate call for writer B**
     (`recording.mutateCalls.length` unchanged), and `getMetadata` still reports **rev-2**
     (writer A's write survives; B's data never overwrote current data).

2. **Defense-in-depth atomic rejection:**
   - Both writers snap the same rev-1; writer A commits → rev-2; writer B (whose snapshot matched)
     submits its write — the adapter re-checks the revision atomically and rejects with
     `StaleRevisionError`, so the stale write never commits; final revision stays rev-2.

Nothing is retried blindly; the stale writer is rejected and the current data is retained.

---

## R-025 automated proof — 409 STALE_REVISION contract preserved, sanitized

- Unit (`revision-coordinator.test.ts`): `staleRevisionBody` emits the exact envelope shape with a
  **sanitized** hostile current revision (`<script>…</script>rev\x00-2` → no HTML/control chars,
  bounded, no secrets) and `retryable:true`; the fixed message equals
  `"The document changed after this operation was prepared."`.
- Route (`document-integrations.test.ts`): a stale mutation with a hostile expected revision
  returns `409 STALE_REVISION` with `code`, `message`, `documentId`, `expectedRevision`,
  `currentRevision`, `retryable:true`, where the expected revision is sanitized (no `<`/`>`, no
  control chars, length ≤ 64) — preserving the §12.3 contract while not leaking secrets.
- No automatic blind retry: a repeated stale request (same stale `expectedRevision`) stays `409`
  both times — the server never masks the conflict by auto-retrying.

### Sanitization coverage (`sanitizeRevisionToken`)

- HTML injection metacharacters (`< > " ' & \`) stripped → no HTML injection surface.
- C0/C1 control characters (newlines, NUL, …) stripped.
- Bounded length (default 64) → an over-long/credential-like payload is truncated, never echoed in
  full; the full token never leaves the coordinator server-side boundary unredacted.
- `null`/`undefined` → empty safe string.

---

## R-024 fail-closed — unsafe provider with no concurrency evidence FAILS CLOSED

- Unit: `readMutationPrecondition` on an adapter whose authoritative metadata returns
  `current_revision: null` yields `concurrencyProven=false`; `assertMutationPrecondition` then
  throws a typed `UnsafeMutationError` (lane = `agent_text_mutation`), and a `RecordingAdapter`
  spy confirms **zero** adapter mutate calls — the lane never writes optimistically.
- Route (`document-integrations.test.ts`): a document backed by a no-token adapter (advertises the
  text lane but exposes no revision token) returns **403 CAPABILITY_UNSUPPORTED** on mutation —
  the lane degrades (typed capability/policy error) instead of writing on unverifiable state.

---

## Route-boundary preserved

- `/api/document-integrations` mount, route set, typed error codes, and workspace/tenant isolation
  are unchanged. `requireOwnedDocument` / `requireWorkspace` / cross-workspace non-existence-oracle
  semantics are untouched.
- T-006 capability-resolution gating and T-007 destination/write-policy gating run exactly as at
  base (the coordinator is inserted between those gates and `adapter.mutate`).
- The mutate response envelope on success (`documentId`/`previousRevision`/`revision`/
  `operationId`/`receiptId`) is unchanged.

---

## Carry-forward disclosure (reviewer-sanctioned, THE-949 r3 FINAL finding 1, LOW)

In `document-integrations.ts` `parseMutation`, the slide lane's `elementRef`/`text`
(~:316-318 at base) and the range lane's `sheet` were **present-but-non-string-coerced-and-silently
dropped**. Mirrored the anchor guard's present-but-non-string → typed `400 INVALID_REQUEST` pattern:
now a present-but-non-string `elementRef`, `text` (slide lane) or `sheet` (range lane) is a typed
`400 INVALID_REQUEST`, never silently dropped. Covered by 3 RED→GREEN route tests.

- Finding ID: **THE-949 r3 FINAL finding 1 (LOW)**.
- Disclosure: this edit is carried forward from the T-008 review and is inside the T-009 allowed
  path (`document-integrations.ts` / `document-integrations.test.ts`).

---

## Rule-outs

- **PRD is read-only authority.** The task lists `phase2-canonical-prd.md` under T-009 paths, and
  `ISSUE-MAP.md` / `BUILD-CONTEXT.md` pin SHA `83cacbc5…` while the in-tree PRD header documents SHA
  `c82e82d8…`. Pin reconciliation is pending Henry's decision, so the in-tree PRD content was
  treated as **read-only authority** and was **not edited** — no rule-out change was needed beyond
  this EVIDENCE rule-out note.
- **§13 events are not this ticket:** the coordinator adds no event table, no
  `document_integration_events` writes, and no change/reconciler integration.
- **No new namespace / receipt store / provider registry:** the coordinator only composes the
  existing adapter/lane contract (`types.ts`), reuses the existing typed error vocabulary, and adds
  no competing registry or receipt surface. T-010 receipts are out of scope.
- **No provider-specific adapters** were added or modified (`fake-adapter.ts`, `registry.ts`,
  `write-policy.ts`, `destinations.ts`, `capability-resolver.ts` are untouched); the fake adapter
  is the only provider, exercised with range/slide capabilities enabled via its existing
  `capabilities` option inside the T-009 test file (no production adapter change).

---

## Privacy

No credentials, raw tokens, tenant secrets, document contents, or operator-specific absolute paths
in logs, fixtures, evidence, or output. Revision tokens in tests are synthetic (`rev-1`, `rev-2`,
or hostile-but-synthetic HTML/credential-like strings used only to prove sanitization). Document
contents are never read or logged by the coordinator.
