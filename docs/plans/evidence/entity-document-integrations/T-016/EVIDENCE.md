# T-016 EVIDENCE — Google Slides create/bounded-slide-text-mutate adapter (THE-957)

Base: `45a1c86f8b0c41c6c3fdc139df87e8400ba1849e` (T-015 approved, GLM 5.3 r2). Branch `runner/entity-document-integrations-20260818`.

## Verbatim acceptance (PRD `### T-016`)

> Same required task contract as T-014, applied to presentation/element semantics.

Slides lane row (`phase2-canonical-prd.md:873`):

> Slides presentation creation and supported element/slide mutation.

Canonical mutation shape (`phase2-canonical-prd.md:2593-2601`, §12.5): `"kind": "update_slide_text"` with `slideRef: "slide_4"`, `elementRef: "title"`, `text: "Revised market outlook"`; plus the verbatim rule:

> Exact slide/element addressing is adapter/engine dependent and must use stable identifiers whenever supported.

## Deliverables

- `packages/server/src/document-providers/google/slides-adapter.ts` — new. Injected `GoogleSlidesTransport` (no default, no network, no credentials); capability fold from LIVE connection state + structured-slide-mutation probe (no hardcoded `supported`); bounded `updateSlideText` envelope only; slide/element targeting validated BEFORE any transport write; revision capture on create/mutate via the existing descriptor surfaces; typed conflict rejection (`StaleRevisionError`) on stale local precondition AND transport-reported conflict; boundary token strictness consuming the canonical shared `UNSAFE_REVISION_TOKEN_CHARACTERS` from `../revision-coordinator` (THE-956 r2 C3 — no forked copy; raw tokens never in error messages, hex code point only). Factory: `createGoogleSlidesAdapter(options)`.
- `packages/server/src/document-providers/google/slides-adapter.test.ts` — new, 28 tests / 7 describes, deterministic stateful fake transport only.
- Lane-payload note (recorded observation, no invented default): the T-005 slide lane carries only `slideId`; the adapter accepts a JSON-encoded §12.5 envelope `{slideRef, elementRef, text}` in that field (exact key set, string-typed), mirroring the approved Sheets compound-selector precedent. A bare slide id is typed-rejected — never silently reinterpreted.

## Commands & exit codes (Node 22 — v22.22.2; default Node 26 has the documented better-sqlite3 ABI mismatch)

| Command | Result |
|---|---|
| `npx vitest run src/document-providers/google/slides-adapter.test.ts` (FIRST run, attempt-1 tests never executed before) | **6 failed / 20 passed** |
| same, after fixes | **28 passed** (exit 0) |
| `npm run build` (strict tsc) | 0 errors (exit 0) |
| `npx vitest run` (full server suite at final HEAD) | **214 files / 2140 tests passed** (exit 0) |
| `npm run ctrl:gate` | `[ctrl] gate passed ✅` (exit 0; the documented std-env/vitest hoisting crash did NOT occur this run — full unit suite passed inside the gate) |
| `git diff --check` | clean |

## RED→GREEN proof per acceptance element

Attempt 1 wrote both files but stopped before ANY test run. First-run failures (RED evidence, honestly recorded): 6 failing tests — degraded/unauthorized/unknown fold expectation, prototype-method leak in the bare-transport probe, fake-transport `metaFor` double-wrapping element ids (`{objectId:{objectId:'title'}}`), and unsafe-reported-token sequencing. Fixes were confined to the test file's fake transport/probe construction and one over-strict fold assertion (aligned to the approved T-015 Sheets convention: `unknown` report state is not-`supported` while ALL write lanes throw). The ADAPTER required zero fixes — all six first-run failures were test-harness defects or convention misalignment.

1. **Create** — `create (stable identity) > RED→GREEN: creates a presentation descriptor with durable provider identity and URL`. GREEN at final HEAD; negative: fails closed on non-presentation artifact types and degraded/unknown connections (named test).
2. **Stable Entity URL** — same test pins `provider_url = https://docs.google.com/presentation/d/<presentationId>/edit` with `external_id` = durable Google presentation id (never a locally minted UUID); Entity-side URL mapping stays the T-004/T-008 registry machinery (no new registry).
3. **Bounded element/slide mutation** — `bounded slide mutation and targeting > RED→GREEN: forwards ONLY the declared updateSlideText envelope to the addressed slide/element` (transport records exactly one request `{kind:'updateSlideText', slideRef, elementRef, text}`); text/range lanes, bare slide id, oversized text all typed-rejected (named tests, zero transport writes).
4. **Revision capture** — `revision capture and conflict rejection > each successful mutation captures a FRESH provider revision token`; create-time capture pinned in the create test; unsafe create-response token rejects the create (named test).
5. **Conflict rejection** — `RED→GREEN: stale expected revision is rejected with the typed retryable conflict; no write occurs` and `RED→GREEN: a transport-reported conflict maps to the neutral retryable StaleRevisionError`.
6. **Slide/element targeting validation** — `RED→GREEN: nonexistent slide is rejected BEFORE any transport write` and `RED→GREEN: nonexistent or malformed element reference is rejected BEFORE any transport write` (both assert `recordedBatchUpdates.length === 0`).

Token strictness: `RED→GREEN: unsafe characters in the client expectedRevision are rejected (hex code point only)` and `RED→GREEN: unsafe transport-reported result tokens are rejected (never propagated)`.

## Rule-outs (all with observations; nothing outside allowed paths touched)

- **PRD read-only**: `phase2-canonical-prd.md` treated as authority only; quoted above; zero edits.
- **docs-adapter.ts / sheets-adapter.ts out of path**: consumed only (`UnsafeRevisionTokenError` import from docs-adapter, single-sourced error mapping). THE-956 r2 M1/M2 carry to the next Sheets-owning lane — NOT attempted here.
- **routes/document-integrations(.test).ts out of path**: production mount untouched; nothing wired into `index.ts`; adapter remains fully fail-closed and unwired. THE-955 r1 F3/F4 carry to the next route-owning lane — NOT attempted here.
- **contract.test.ts §19.2 deferral (T3)**: the shared suite fixes `artifact_type: 'document'` and TEXT-lane success mutations — both outside the Slides honest surface; equivalent contract elements covered per-element in this suite (same approach as approved T-015). Carry stays with the route/wiring lane.
- **F5 receipt wiring deferral**: routes keep `receiptId: null` exactly as at base (pending Henry sign-off t010-wiring-deferral-signoff). No receipts touched.
- **Sandbox/manual proof deferred**: BUILD-CONTEXT.md:36-38 — "Do not deploy a sandbox or production environment as part of this Loom run." Automated proof is the transport-injected contract suite above; live proof defers to T-038/T-039.
- **revision-coordinator.ts/.test.ts UNTOUCHED**: no coordinator surface change was required — the Slides lane consumes the exported canonical `UNSAFE_REVISION_TOKEN_CHARACTERS` directly and reuses `StaleRevisionError` from `../types`. Equivalence with the coordinator sanitizer is already pinned by THE-956 r2 tests.
- **Confirmation-shape warning (T-013 r1 F1, OQ-003 open)**: observed only; `confirmed` body boolean remains caller-attested; gate semantics untouched.
- **Flag reuse (T-013 r1 F2, OQ-018 open)**: observed only; `capability_resolver_enforcement` wiring not restructured.

## Open-question observations (no invented defaults)

- PRD documents no numeric bound on the §12.5 `text` payload; the adapter enforces a module-local `MAX_SLIDE_TEXT_LENGTH = 10_000` typed rejection (never truncation) purely to keep the forwarded envelope bounded/deterministic. If Henry later sets an authoritative bound, it supersedes this constant.
- The T-005 slide-lane single-field constraint vs. the three-field §12.5 shape is resolved by the JSON-envelope-in-slideId convention documented above; if a future lane widens the T-005 mutation type, the parser accepts that without semantic change.

## Unresolved risks

- The Slides adapter is NOT mounted anywhere in production (by design, fail-closed); wiring belongs to a route/wiring round with receipts decision pending.
- §12.5 covers more slide operations than text updates (insert/delete slides etc.); only `update_slide_text` is declared here, everything else typed-rejects — honest but narrow until a follow-on lane widens the declared envelope.
