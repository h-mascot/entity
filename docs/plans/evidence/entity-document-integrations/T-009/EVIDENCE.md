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
- `packages/server/src/document-providers/revision-coordinator.test.ts` (new — concurrent-writer tests, 19 tests after review-round fixes)
- `packages/server/src/routes/document-integrations.ts` (wired the coordinator into the mutate route; 409 `STALE_REVISION` contract preserved exactly)
- `packages/server/src/routes/document-integrations.test.ts` (route-level integration + carry-forward RED→GREEN guards + review-round proofs; 11 new T-009 tests; existing T-008 contract tests unweakened)
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
  revision from the registry hint or any secondary source. It distinguishes a **null descriptor**
  (provider artifact not found / vanished → rethrows `AdapterArtifactNotFoundError`, surfaced as the
  typed 404 `DOCUMENT_NOT_FOUND`) from a **present descriptor whose `current_revision` is
  null/empty** (`concurrencyProven=false`, R-024 "never proceed on unverifiable state") — THE-950 r2
  F1 fixed a regression that conflated the two and mapped a vanished artifact to a misleading 403.
- `assertMutationPrecondition({ precondition, expectedRevision, documentId })` — fails closed with
  a typed `UnsafeMutationError` when `concurrencyProven=false` ("unsafe provider with no
  concurrency evidence fails closed"); otherwise compares expected vs current and throws the typed
  `StaleRevisionError` on mismatch **before any adapter write** (R-024 / R-025). No automatic blind
  retry (the caller surfaces the 409 once).
- `preflightMutation(...)` — one-step read + assert, used by the route.
- `sanitizeRevisionToken(raw, maxLength=64)` — treats revision tokens as **untrusted strings**:
  strips C0/C1 control characters, HTML metacharacters (`<>"'&\`), and (THE-950 r2 F5) Unicode
  bidi/format controls (U+200B–U+200F, U+202A–U+202E), and bounds length to 64 (no
  secrets/credentials bleed, no HTML injection surface).
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

### Review round 1 — RED → GREEN proof (THE-950 F1 + F5)

To prove the review-round tests are RED on the review candidate (which returns 403 for both the
vanished-artifact and no-token mutation cases, and does not strip Unicode bidi/format controls),
the coordinator source was temporarily reverted to its candidate logic (the null-descriptor rethrow
and the `\u200b-\u200f\u202a-\u202e` character class removed) and the focused suite was re-run:

```sh
cd packages/server && npx vitest run src/document-providers/revision-coordinator.test.ts src/routes/document-integrations.test.ts
```

Result (RED, exit 1): **3 failed | 63 passed (66)** — the three FAILING tests are exactly the new
RED tests:

```
× strips Unicode bidi/format controls (zero-width + bidi embeddings) — no hidden-direction surface   [F5]
× a NULL descriptor (provider artifact vanished/unknown) rethrows AdapterArtifactNotFoundError...     [F1 unit]
× THE-950 F1: a mutation against a registry record whose provider artifact is GONE returns 404...      [F1 route, got 403]
```

The F3 sheet/slide pinning tests and all carry-forward guards stayed GREEN in this
RED run — confirming F3 is a GREEN-only (no-RED) pin.

### GREEN — focused (final HEAD, after review round 1)

Command (task verification #1):

```sh
cd packages/server && npx vitest run src/document-providers/revision-coordinator.test.ts src/routes/document-integrations.test.ts
```

Result (GREEN, exit 0):

```
 Test Files  2 passed (2)
      Tests  66 passed (66)
```

(The review-round RED tests above turn GREEN once the coordinator's F1/F5 fixes are present.)

### GREEN — full server suite (task verification #2, final HEAD)

```sh
cd packages/server && npm run build && npx vitest run
```

- `npm run build` (strict tsc): **exit 0**
- `npx vitest run`: **209 test files passed, 1904 tests passed** (exit 0) — corrected from the 1896 recorded at 2baf6a1 (that was the pre-r2 count, not re-run after the T-009 r2 review-round tests); finding ID **THE-950 r2 F1** (carry-forward, disclosed in T-010 EVIDENCE and final answer).

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
- Unicode bidi/format controls (U+200B–U+200F zero-width/joiners/LRM/RLM; U+202A–U+202E bidi
  embeddings/overrides) stripped → no hidden-direction/spoofing surface (THE-950 r2 F5).
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
- **F1 (THE-950 r2): a NULL descriptor is NOT the no-token case.** A mutation against a registry
  record whose provider artifact has vanished (`getMetadata → null`) returns **404
  DOCUMENT_NOT_FOUND** (the typed artifact-not-found), NOT the misleading 403 no-token. Unit + route
  prove-it, RED→GREEN.
- **F3 (THE-950 r2): route-level lane proofs.** The sheet (`set_range`) and slide
  (`update_slide_text` bare slideRef) lanes are now proven at the HTTP boundary for the two-writer
  stale-revision 409 and the no-token fail-closed 403 paths (GREEN-only pinning; the behavior was
  already correct on the candidate, only the coverage was missing).

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

## Review round 1 (GLM 5.3) — fix disposition (THE-950)

Review base: `33105b954de979b5159c14ae4ea43efbacc5c0d2`; candidate: `2baf6a1…`; verdict
CHANGES_REQUESTED. Disposition of each finding, with the commands and RED→GREEN proofs recorded in
the TDD section below.

- **F1 (required — typed-error conflation):** `readMutationPrecondition` now distinguishes a **null
  descriptor** (`getMetadata → null`: artifact not found / vanished at the provider) from a
  **present descriptor** whose `current_revision` is null/empty. A vanished artifact rethrows
  `AdapterArtifactNotFoundError` → the route's existing 404 `DOCUMENT_NOT_FOUND` mapping (not the
  misleading 403 "provider exposes no revision/concurrency token"). A present-but-no-token
  descriptor still fails closed (`UnsafeMutationError` → 403). Prove-It route test for BOTH paths,
  RED→GREEN: a mutate against a registry record whose provider artifact is gone → 404, and a present
  descriptor with null revision → 403.
- **F2 (evidence count):** `revision-coordinator.test.ts` claim "12 tests" corrected. The file
  contains 19 tests (16 at review candidate plus 3 added in review round 1: F1 null-descriptor,
  F5 bidi strip, and one F1 distinction test) — all pass. All other counts in this EVIDENCE were
  re-checked against the actual final runs (focused 66 passed; see TDD).
- **F3 (route-level lane proof gap):** added route-level (HTTP boundary) R-024/R-025 proofs for the
  sheet (`set_range`) and slide (`update_slide_text` bare slideRef) lanes: a two-writer stale
  revision returns 409 `STALE_REVISION`, and a no-token provider fails closed with 403
  `CAPABILITY_UNSUPPORTED`, for each lane. These are **pinning tests on lane-agnostic route code —
  GREEN-only (no RED)**, because the stale-409 and fail-closed behavior was already correct on the
  candidate; they close the PRD validation "two independent writers for each implemented mutation
  lane" at the HTTP boundary.
- **F4 (architecture note — documentation only, NO code):** the defense-in-depth guarantee (the
  adapter re-checks the revision atomically inside `mutate`) rests on adapter discipline, not
  contract enforcement — only the fake adapter implements it today. A shared revision guard /
  contract-suite check is **deferred to the first real provider adapter (T-014+)**, and is noted
  here rather than built now. No `types.ts` edit was made for this.
- **F5 (INFO — hardening):** `sanitizeRevisionToken` now also strips Unicode bidi/format controls
  (U+200B–U+200F, U+202A–U+202E) via the bounded character-class change, with one hostile-token
  test, RED→GREEN.

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
