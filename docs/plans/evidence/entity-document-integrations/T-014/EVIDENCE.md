# T-014 (THE-955) — Google Docs create/mutate — EVIDENCE

Attempt 6 continuation. Base reviewed HEAD: `9867dfa66ed37a0d6988cc29063099ae8653921f`
(T-013, GLM 5.3 r1 APPROVED). All work on top of that base; no amend/rebase.

## PRD acceptance (verbatim quote)

`docs/loom/entity-document-integrations/phase2-canonical-prd.md`, `### T-014 — Implement
Google Docs create/mutate`:

> Goal/value: Deliver agent document workflow.
>
> Dependencies: T-013.
>
> Acceptance:
>
> create;
>
> stable Entity URL;
>
> bounded mutation;
>
> revision capture;
>
> conflict rejection.
>
> Automated proof: adapter contract + sandbox.
>
> Manual proof: open document in Google.

Rows: R-004 (existing Google read-only preserved — production mount untouched, see rule-outs),
R-005 (explicit write gate — gate stack reused unchanged), R-007 (destination support —
destination scope resolution unchanged).

## Artifacts

| Artifact | Status |
|---|---|
| `packages/server/src/document-providers/google/docs-adapter.ts` | NEW. Transport-injected Google Docs adapter implementing the full T-005 `DocumentProviderAdapter` surface. |
| `packages/server/src/document-providers/google/docs-adapter.test.ts` | Pre-existing RED suite (untracked at base), kept. One minimal harness fix — see "Test change" below. |
| `packages/server/src/routes/document-integrations.test.ts` | +182 lines: 3 route-lane tests wiring the real Docs adapter through the unchanged T-013 gate stack. |
| `docs/plans/evidence/entity-document-integrations/T-014/EVIDENCE.md` | This file. |

## Acceptance elements — RED → GREEN

All five acceptance elements were RED in the committed-at-base sense: the suite existed
untracked with no adapter module (`docs-adapter.ts` did not exist), so every test failed on a
missing import. Each is now GREEN:

- **create** — RED→GREEN tests:
  - `T-014 Google Docs adapter — create > create returns a provider descriptor with stable provider identity (documentId as external_id)`
  - plus `create replay with the same idempotency key reconciles (created:false) — R-026` and
    `create fails closed when the create capability is not actionable (degraded connection)`.
  - Route-level: `T-014 (THE-955) — Google Docs lane through the T-013 gate stack (routes) >
    SUCCESS: the real Docs adapter creates and mutates through every satisfied gate …`.
- **stable Entity URL** — RED→GREEN tests:
  - `T-014 Google Docs adapter — stable provider identity across create/read > read/getMetadata return the SAME external_id and revision after create (stable identity)` (adapter half);
  - route half asserts `entityUrl === /documents/${documentId}` in the SUCCESS route test above,
    minted once by the existing T-004/T-008 registry (`deps.registry.create`) — no new registry.
- **bounded mutation** — RED→GREEN tests:
  - `mutate applies ONLY the declared batchUpdate envelope for the text lane` (transport records exactly one batchUpdate whose request kinds are all declared);
  - `range mutation … FAILS CLOSED` / `slide mutation … FAILS CLOSED` with typed `UnsupportedAdapterMutationError`;
  - `capability honesty: the docs adapter advertises only create + text mutation`.
- **revision capture** — RED→GREEN tests:
  - `every create/mutate populates the provider revision token on the descriptor`;
  - route SUCCESS test additionally proves the new revision is durable on the canonical record via fresh GET.
- **conflict rejection** — RED→GREEN tests:
  - `mutation against a STALE revision token fails closed…`, `mutation against an UNKNOWN revision token fails closed…`,
    `transport conflict is mapped to the typed provider-neutral StaleRevisionError with retryable:true`;
  - route-level: `CONFLICT: a stale expectedRevision on the Docs lane surfaces the R-025 typed 409 STALE_REVISION envelope (retryable:true)`.
- **token strictness (THE-950 r2 F2 adapter half)** — 15-case `it.each` over the extended unsafe set
  (U+200E/200F, U+202A–202E, U+2066–2069, U+FEFF, U+2060, U+00AD, U+061C, U+0001, `<`, `"`)
  plus transport-reported-unsafe and benign-opaque-token acceptance.

## Commands run (exit codes)

Node 22 pinned per prior-attempt convention (`/opt/homebrew/opt/node@22/bin/node`).

```
node node_modules/.bin/vitest run packages/server/src/document-providers/google/docs-adapter.test.ts   # exit 1 first run (1 harness-bug failure), exit 0 after fix
node node_modules/.bin/vitest run packages/server/src/document-providers                               # exit 0 (247 tests)
npx tsc                      # in packages/server, strict build — exit 0 after fixes
node node_modules/.bin/vitest run packages/server/src                                   # exit 0 (212 files, 2037 tests)
git diff --check             # clean
```

## Test-file change (disclosed)

One minimal fix to the pre-existing RED suite, in
`docs-adapter.test.ts > adapter-boundary revision-token strictness > a revision reported by the
transport that contains an unsafe character fails closed`:

1. The test set `transport.nextReportedRevision` **before** `create`, but then expected `create`
   to SUCCEED and only `read` to reject. That contradicts the binding fail-closed invariant
   (§19.2 / R-002): the adapter must validate transport-reported tokens on EVERY descriptor
   boundary, including create's. The negative is preserved intact by injecting the unsafe token
   after create, onto the read-back path.
2. The original line `transport.docsWithUnsafeRevision = created.descriptor.external_id;` assigned
   a string to a `Set<string>` field — a harness type bug that would throw at runtime.

No other test semantics were altered.

## Carry-forward dispositions

- **F3/THE-954-r1 (admin-gate mutation negative)** — RESOLVED here. New route test
  `NEGATIVE admin mutation (F3/THE-954-r1 carry)` creates the doc via API with the admin policy
  present, replaces `ctx.policies[0]` in place with `adminWriteAuthorized: false`
  (`findGoverningPolicy` reads the array live; policy objects are plain), then POSTs a mutation →
  expects 403 `WRITE_DISABLED`. Mirrors the create-lane negative at
  `document-integrations.test.ts` (T-013 base lines ~1488–1495).
- **F2/THE-950-r2 (revision-token strictness, adapter half)** — RESOLVED here at the adapter
  boundary: `UnsafeRevisionTokenError` raised for both client-supplied `expectedRevision` and
  transport-reported revisions, extended unsafe-char set enforced
  (`UNSAFE_REVISION_CHARACTERS` in docs-adapter.ts). **Core half carry remains**: extending
  `sanitizeRevisionToken`'s core set in `revision-coordinator.ts` is OUT of path for T-014;
  observed current core set covers C0/C1, U+200B–200F, U+202A–202E, HTML metacharacters
  (revision-coordinator.ts:47–49) but NOT the isolates U+2066–2069/U+061C/U+FEFF/U+2060/U+00AD —
  carried for a revision-coordinator-scoped task.

## Hard requirements compliance

- Deterministic: injected `GoogleDocsTransport` only; no default transport exists (compile-time
  required option). No network, credentials, tenant data, operator paths, real timers, or unseeded
  randomness anywhere in the adapter or its tests.
- Fail-closed: `resolveCapabilities` folds context + live transport evidence taking the MORE
  restrictive state; unknown/degraded/unauthorized never lift a write; every side-effecting action
  re-checks via `assertAdapterActionSupported` (defense-in-depth).
- Stable Entity URL: external_id IS the durable Google documentId; Entity-side mapping via the
  existing T-004/T-008 `DocumentRegistry`; no new registry invented.
- Bounded mutation: only `{kind:'insertText'} | {kind:'replaceAllText'}` envelopes are ever
  constructed; range/slide lanes throw typed `UnsupportedAdapterMutationError` before any
  transport interaction.
- `confirmed` boolean stays caller-attested exactly as at T-013 base; OQ-003 remains open;
  observation only — no behavior changed.
- `capability_resolver_enforcement` flag reuse unchanged (OQ-018 open); observation only.
- Receipts stay deferred: every route response keeps `receiptId: null`
  (document-integrations.ts:758, :818, :931); asserted in the new route tests.
- Workspace/tenant isolation: route scoping helpers (`requireOwnedDocument`, `writeScopeFor`)
  untouched.

## Rule-outs (OUT of path — not edited, with exact cites)

- `packages/server/src/routes/document-integrations.ts` — UNCHANGED this attempt (base T-013
  logic already provider-agnostic via `deps.adapters(provider)`; gates at :639–:733 create lane
  and :834–:921 mutate lane). Diff shows zero changes to it.
- Production mount unwired exactly as at base: `packages/server/src/index.ts:470–477`
  (`adapters: () => undefined`, comment "No real provider adapters are wired until T-012+").
- `packages/server/src/document-providers/types.ts` — T-005 contract imported, not modified.
- `packages/server/src/document-providers/fake-adapter.ts` (400 lines) — untouched.
- `packages/server/src/document-providers/write-policy.ts` (488 lines) — untouched; admin veto at
  :165 observed only.
- `packages/server/src/document-providers/revision-coordinator.ts` (210 lines) — untouched
  (core-half F2 carry noted above).
- `packages/server/src/document-providers/document-objects.ts` — does not exist in tree (no such
  file under document-providers/); nothing to rule out beyond absence.
- `packages/db/src/index.ts` (11571 lines) — untouched.
- Feature-flag file `packages/server/src/phase2-flags.ts` — untouched (OQ-018 observation only).
- `DocsSettings.tsx` — absent from the tree (`grep -r DocsSettings packages/` → no hits); UI work
  is out of T-014 scope.
- Receipt writer — no receipt store/wiring exists or was added (`receiptId: null` everywhere).
- No competing API namespace, provider registry, event table introduced.

## Sandbox/manual proof deferral

PRD "Automated proof: adapter contract + sandbox" / "Manual proof: open document in Google":
sandbox deployment and browser/manual Google proof are DEFERRED to T-038/T-039 per
`docs/loom/entity-document-integrations/BUILD-CONTEXT.md:38` ("Do not deploy a sandbox or
production environment as part of this Loom run."). The adapter-contract half of automated proof
is satisfied here via `runAdapterContractSuite('google-docs-adapter', …)`. No sandbox credentials
invented; no product defaults chosen for open questions.

## Unresolved risks / observations

1. Create-lane revision capture uses the transport's typed `createDocument` response revisionId
   as-is (noted in code); every read-back path re-validates strictly. A transport that lies at
   create-time only would plant an unsanitized-but-typed token until first read-back. Accepted:
   the response is a typed structured field from the injected transport, and read/mutate/preflight
   all fail closed on it.
2. Core-half F2 (revision-coordinator sanitize set extension) remains carried — see above.
3. OQ-003 (`confirmed` as human-confirmation control) and OQ-018 (flag host) remain open by
   design; no product defaults invented.
