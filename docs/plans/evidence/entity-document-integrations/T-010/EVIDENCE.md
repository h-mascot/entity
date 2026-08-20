# THE-951 (LOOM-DOCS T-010) — Integrate activity and Entity execution receipts — EVIDENCE

## Scope

Integrate document operations with (a) a durable normalized activity trail (R-027) and (b) the
canonical Entity execution receipt system (R-028), so an auditor can traverse
Entity task/agent action → execution receipt → document operation → document version/revision →
provider/local artifact. Provided as the `activity-adapter.ts` integration adapter that composes the
existing canonical surfaces, plus its colocated TDD tests and this evidence.

- Base (reviewed HEAD, T-009 approved): `cd83616ebdcae6ec30cc8ec2febed0c46748d9da`
- Branch: `runner/entity-document-integrations-20260818` (no merge, no push)
- Node used everywhere: **v22.22.2** (per the task — Node 26 has a better-sqlite3 ABI mismatch)
- Final SHA: see final answer (this file must not contain its own SHA).

## Allowed paths touched (only)

- `packages/server/src/document-providers/activity-adapter.ts` (new in r1 — the integration adapter;
  r2: F1/F2/F4/F5/F6 fixes)
- `packages/server/src/document-providers/activity-adapter.test.ts` (new in r1 — colocated TDD tests;
  r2: +9 tests for the F2 no-promotion capture surface, the non-agent traversal gate, and the
  persistence unit gaps; `now`/`actorPrincipalId` dead args removed per F5)
- `packages/server/src/document-providers/activity-adapter.integration.test.ts` (new in r2 — REAL
  `createActivityRepository` integration regression for F1+F2, 3 tests)
- `packages/db/src/index.ts` (r2, F1 direction (a) — LEAST db change): adds the single
  `document_operation` value to the closed `ACTIVITY_EVENT_TYPES` vocabulary; nothing else in
  `packages/db` was edited
- `packages/db/src/task-repository.test.ts` (r2, F1 direction (a)): one existing db test file gains
  one test proving the real `createActivityRepository` persists `document_operation` as a valid
  structured event (22/184 → 22/185)
- `docs/plans/evidence/entity-document-integrations/T-010/EVIDENCE.md` (this file)
- Disclosed carry-forward (reviewer-sanctioned, THE-950 GLM 5.3 r2 F1, LOW): **one-line**
  correction in `docs/plans/evidence/entity-document-integrations/T-009/EVIDENCE.md` — the "final
  HEAD" full-suite count 1896 → **1904** (see Carry-forward disclosure below).

Not touched, per the allowed-path contract / rule-outs:

- `packages/server/src/receipt-writer.ts` — **not extended**; the adapter composes the existing
  `completeTaskWithReceipt` / `buildCanonicalReceiptMarkdown` / `hashCanonicalReceiptMarkdown`
  surface by taking the already-produced `CompletionReceiptResult` as input. Never forked.
- `packages/server/src/receipt-writer.test.ts` — not extended; existing tests unweakened, all pass.
- `docs/loom/entity-document-integrations/phase2-canonical-prd.md` — **read-only authority**, not edited.
- `.project-gate.json` — not changed (ruled out; see Rule-outs).
- No other files edited (PRD, AGENTS.md, ISSUE-MAP.md, BUILD-CONTEXT.md, gates/test allowlists,
  migrations.ts, editor router, registry.ts, write-policy.ts, revision-coordinator.ts,
  routes/document-integrations.ts, and all other document-providers files untouched).

---

## Verbatim acceptance & authority quotes

### T-010 ticket block (PRD `phase2-canonical-prd.md`, `### T-010` ~:3776, verbatim)

> **T-010 — Integrate activity and Entity execution receipts**
>
> Goal/value: Preserve attributable proof.
>
> Dependencies: T-008, repository receipt audit.
>
> Acceptance: R-027/R-028.
>
> Automated proof: receipt traversal test.
>
> Non-goal: Replace existing receipt system.
>
> Audit pointer (non-binding until T-001 confirms): the repository's canonical receipt writer is
> packages/server/src/receipt-writer.ts, exporting completeTaskWithReceipt,
> buildCanonicalReceiptMarkdown, and hashCanonicalReceiptMarkdown, gated by the
> receipt_completion_enforcement flag in packages/server/src/phase2-flags.ts. Document operations
> must attach to that surface. Introducing a second receipt store is a release blocker. OQ-019
> remains the owning open question.

### R-027 — Activity and version attribution (PRD ~:1535, verbatim)

> **R-027 — Activity and version attribution**
>
> Entity must maintain a durable normalized activity trail.
>
> Actor classifications:
>
> human
>
> agent
>
> provider_external_actor
>
> local_external_actor
>
> system
>
> unknown
>
> If exact provider actor identity is unavailable, Entity must use an honest coarse classification.
>
> Acceptance criteria
>
> Activity identifies:
>
> document;
>
> operation type;
>
> actor class;
>
> known actor ID where valid;
>
> old/new revision where applicable;
>
> provider;
>
> timestamp;
>
> success/failure;
>
> correlation/receipt ID where applicable.
>
> Validation
>
> Activity unit/integration tests.

### R-028 — Execution receipts (PRD ~:1576, verbatim)

> **R-028 — Execution receipts**
>
> Every agent mutation must produce or link to the canonical Entity low-level execution receipt
> system.
>
> The provider artifact itself is not sufficient proof.
>
> Acceptance criteria
>
> An auditor can traverse:
>
> Entity task/agent action
>
> ->
>
> execution receipt
>
> ->
>
> document operation
>
> ->
>
> document version/revision
>
> ->
>
> provider/local artifact
>
> Validation
>
> Receipt linkage integration test.

### Validation matrix rows (PRD ~:3582–3583, verbatim)

> R-027 Activity attribution tests
>
> R-028 Receipt integration receipt traversal test

---

## Implementation summary

### `activity-adapter.ts` (new — the integration adapter)

A self-contained integration module on the T-010 path that composes the existing canonical surfaces.
It does **not** introduce a second receipt store, provider registry, event table, or API namespace.

- **R-027 — durable normalized activity trail.** `DocumentActivityRecord` carries every field the PRD
  requires: `documentId`, `operationType`, `actorClass` (the exact six-value vocabulary),
  `actorId` (known where valid, else null), `priorRevision`/`resultRevision` (old/new revision where
  applicable), `provider`, `artifactType`, `timestamp`, `succeeded` (success/failure),
  `reasonCode`, and `receiptId` (correlation/receipt ID where applicable). `recordDocumentActivity`
  persists one record through the **existing** `ActivityRepository.createActivity` surface (the
  existing `activities` table — no second store), embedding the normalized fields in the structured
  `activity_event_payload` so an auditor can correlate to the document, its version, and the
  receipt.
- **R-027 — honest actor classification.** The exact six classes are exported
  (`DOCUMENT_ACTIVITY_ACTOR_CLASSES`). `classifyDocumentActor` honors an explicit authoritative
  class verbatim; otherwise it coarse-falls back honestly: `provider_external_actor` for a
  provider-reported principal id (never promoted to a trusted human/agent),
  `local_external_actor` for a local managed artifact actor, and `unknown` with a NULL actor id
  when there is no trustworthy evidence. Identity is never fabricated — an absent/blank id stays
  null, and an invalid class folds to `unknown` (fail closed).
- **R-028 — every agent mutation links to the canonical receipt.** `linkDocumentMutationToReceipt`
  correlates the R-027 activity to the canonical execution receipt produced through the real
  `completeTaskWithReceipt` surface (`CompletionReceiptResult`), gated by the audited
  `receipt_completion_enforcement` flag via `phase2FlagEnabled`. `required` is read live from the
  flag (capability-honest + reversible), never hardcoded. The provider artifact alone is not the
  proof — the immutable, content-hashed canonical receipt is the auditable execution proof, and the
  activity carries its correlation/receipt id.
- **R-028 — auditor traversal (the acceptance proof).** `traverseAuditorChain` walks
  Entity task/agent action → execution receipt → document operation → document version/revision →
  provider/local artifact and throws a typed `AuditorTraversalGapError` if **any** link is missing
  or dangling (the PRD "fails if any link is missing or dangling" acceptance).

### Receipt-writer surface (composed, not forked)

The adapter imports only the type `CompletionReceiptResult` from `receipt-writer.ts` and drives the
real `completeTaskWithReceipt` in its tests to produce canonical receipts against a temp storage
root (mirroring the existing `receipt-writer.test.ts` fixture pattern). No edit to `receipt-writer.ts`
was needed — the canonical surface was sufficient as-is.

---

## TDD: RED → GREEN proof

### RED — the module did not exist yet

Command (Node 22, working runner — see Runner note):

```sh
cd packages/server && <repo-root>/node_modules/.bin/vitest run src/document-providers/activity-adapter.test.ts
```

Result (RED, exit 1):

```
 FAIL  src/document-providers/activity-adapter.test.ts [ src/document-providers/activity-adapter.test.ts ]
Error: Cannot find module './activity-adapter' imported from
  '.../packages/server/src/document-providers/activity-adapter.test.ts'
 Test Files  1 failed (1)
```

The 20 test cases (R-027 fields, actor-classification incl. coarse fallback, R-028 receipt linkage,
feature-flag reversibility, auditor traversal happy + all four dangling-link negatives, and the
fail-closed forged-receipt negative) all target the absent module — RED. Deferred by one assertion
fix (the persisted record is an `ActivityRecord`, not the `DocumentActivityRecord`, so the field
assertions read the structured payload) after the first GREEN run; no acceptance behavior changed.

### GREEN — focused (r2 final HEAD)

Command:

```sh
cd packages/server && <repo-root>/node_modules/.bin/vitest run src/document-providers/activity-adapter.test.ts src/document-providers/activity-adapter.integration.test.ts src/receipt-writer.test.ts
```

Result (GREEN, exit 0):

```
 ✓ src/receipt-writer.test.ts (9 tests) 14ms
 ✓ src/document-providers/activity-adapter.test.ts (28 tests) 17ms
 ✓ src/document-providers/activity-adapter.integration.test.ts (3 tests) 153ms

 Test Files  3 passed (3)
      Tests  40 passed (40)
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

Result: **211 test files passed, 1935 tests passed** (exit 0) — the 1904 pre-existing full-suite
count plus 8 new activity-adapter unit tests (20→28) and 3 new real-repository integration tests.

Note on `npm run ctrl:gate`/`npx vitest run` / the pre-existing `std-env` conflict: unchanged from r1
(see Runner note below). The one-off full-server run at r2 initially reported 1 flaky failure (210
passed / 1 failed / 1935), then passed cleanly 4 consecutive times (211 / 1935) with no code change;
this is an unrelated transient timing flake, not a regression.

### GREEN — db suite (r2, F1 direction (a))

Command:

```sh
cd packages/db && <repo-root>/node_modules/.bin/vitest run
```

Result: **22 test files passed, 185 tests passed** (exit 0) — baseline 22/184 plus 1 new
`document_operation`-structured-projection test in `task-repository.test.ts`.

### Runner note (pre-existing environment conflict, NOT a code change)

`packages/server/node_modules/vitest@4.1.2` cannot start under Node 22 in this checkout: its
`dist/chunks/cac.*.js` does `import { isAgent } from 'std-env'`, but Node's ESM resolution from that
chunk hits the hoisted root `node_modules/std-env@3.10.0` (which lacks `isAgent`) instead of the
`packages/server/node_modules/std-env@4.0.0` the server's vitest wants — a dual-major `std-env`
hoisting conflict. This is **pre-existing** (occurs before any test file loads, with a clean worktree
and no production edits) and is NOT caused by this diff. The prior evidence suites (T-008/T-009)
ran under a consistent install. The working equivalent invocation is the repo-root
`node_modules/.bin/vitest@4.0.18` (self-consistent with `std-env@3.10.0`), used for every proof
command above; `cd packages/server && npx vitest run` reproduces only the pre-existing crash.

`npm run ctrl:gate`:

```sh
npm run ctrl:gate
```

Result: **exit 1** — `npm run build` (root) passed, `@entity/db` workspace unit tests passed
(22 files / 184 tests), then `@entity/server test` (`npx vitest run`) hit the SAME pre-existing
`std-env` `isAgent` crash described above. This is not a regression from T-010; the substantive
gate content (strict build + full unit suite) passes under the working runner. `.project-gate.json`
was left unchanged (see Rule-outs) — the env conflict is transient/environmental, not a gate-logic defect.

---

## R-027 automated proof — activity attribution fields + honest coarse actor classification

`activity-adapter.test.ts`:

1. **Every R-027 identifying field** is produced and persisted: `id`, `documentId`, `provider`,
   `artifactType`, `operationType`, `actorClass`, `actorId`, `priorRevision`, `resultRevision`,
   `timestamp`, `succeeded`, `reasonCode`, `receiptId` — verified against the structured
   `activity_event_payload.data` of the activity written through the existing
   `ActivityRepository.createActivity` surface.
2. **Exact actor vocabulary**: `DOCUMENT_ACTIVITY_ACTOR_CLASSES` equals exactly
   `['human','agent','provider_external_actor','local_external_actor','system','unknown']`.
3. **Correlation/receipt ID where applicable**: an agent mutation activity carries `receiptId`.

Actor classification (honest, coarse, never fabricated):

- Each of the six exact classes is accepted as authoritative with a known actor id.
- An `agent`-driven document mutation with a known agent id resolves to `{agent, 'agent-1'}`.
- A provider-reported principal id resolves to honest coarse `provider_external_actor` with that
  provider-bound id (never promoted to a trusted human/agent).
- No actor evidence → honest coarse `unknown` with a NULL actor id (identity NOT fabricated).
- A blank/whitespace provider id does NOT produce a fabricated identity (`unknown`/null).
- An invalid/unknown actor class folds to `unknown` (fail closed) rather than guessing.

---

## R-028 automated proof — every agent mutation links to the canonical receipt

`activity-adapter.test.ts` (uses the REAL `completeTaskWithReceipt` against a temp storage root):

- An agent document mutation links to a canonical completion receipt: the activity receives
  `receiptId === 'receipt-1'`, the artifact is `raw_task_receipt` with stable path
  `/artifacts/evidence/receipt-1.md`, and the immutable content-hashed receipt body exists on disk —
  the provider artifact alone is not the proof.
- **Feature-flag reversibility (audited framework):** `receipt_completion_enforcement` defaults
  enabled (source `default`); can be toggled off via `ENTITY_PHASE2_DISABLE_FLAGS`
  (source `disable_list`) and via the env override `ENTITY_PHASE2_RECEIPT_COMPLETION_ENFORCEMENT=0`
  (source `env`). The adapter reads the flag live: `required:true` when enabled, `required:false`
  when disabled — capability-honest and reversible, never hardcoded, while still carrying the
  canonical linkage.

---

## R-028 automated proof — auditor traversal end-to-end (the acceptance proof)

`activity-adapter.test.ts` — `traverseAuditorChain` walks all five stages in order
(`entity_action → receipt → document_operation → document_revision → provider_artifact`) using the
REAL canonical receipt (via `completeTaskWithReceipt`) and the REAL deterministic fake adapter for
the provider/local artifact, and **fails on every missing/dangling link**:

- Happy path: full 5-hop chain resolves; the receipt hop references the canonical stable path
  `/artifacts/evidence/receipt-chain.md` (execution receipt, not the provider artifact), and the
  provider/local artifact hop references the real fake `external_id`.
- Missing Entity task/agent action → `AuditorTraversalGapError` (`entity_action`).
- Missing/dangling execution receipt for an agent mutation → `AuditorTraversalGapError` (`receipt`).
- Missing/dangling document version/revision → `AuditorTraversalGapError` (`document_revision`).
- Missing/dangling provider/local artifact → `AuditorTraversalGapError` (`provider_artifact`).

---

## Fail-closed / negative path

- A document mutation whose `receiptId` points at a NON-canonical/forged id is NOT accepted as
  proven proof — the traversal throws a typed `AuditorTraversalGapError` (dangling receipt), and the
  enforcement flag stays `enabled`. No fabricated/forged proof passes.
- An invalid/unknown actor class folds to `unknown` with a NULL id (fail closed) rather than
  guessing.
- Traversal hop labels/references expose only leaf identifiers (document id, revision, stable path,
  provider/artifact type) — no credentials, raw tokens, tenant secrets, document contents, or
  operator-specific absolute paths.

---

## Privacy

No credentials, raw tokens, tenant secrets, document contents, or operator-specific absolute paths
in code, fixtures, logs, or this evidence. All identifiers are synthetic (`doc-1`, `rev-1`,
`receipt-1`, deterministic fake external ids). Timestamps are injected fixed values; the fake
adapter is the only provider; no network, no real timers, no unseeded randomness.

---

## Carry-forward disclosure (reviewer-sanctioned, THE-950 GLM 5.3 r2 F1, LOW)

As sanctioned for this task, `docs/plans/evidence/entity-document-integrations/T-009/EVIDENCE.md`
received exactly **one line** of correction: the "final HEAD" full-server-suite count at line 250
was **1896 → 1904**, because 1896 was the `2baf6a1` count and was not re-run after the T-010 r2
review-round tests 1904 was verified in the final run (209 files / 1904 tests under the working
runner). The Finding ID **THE-950 r2 F1** is recorded on that same line. No other T-009 file edits.
(Precedent: t004EvidenceCorrection.)

---

## Rule-outs

- **PRD is read-only authority.** `docs/loom/entity-document-integrations/phase2-canonical-prd.md`
  was NOT edited. The known open item — authority pin `83cacbc…` vs in-tree PRD hash `c82e82d…` —
  is pending Henry's decision; the in-tree PRD content was used as read-only authority and the
  resolution is not part of this ticket.
- **No second receipt store (release blocker avoided).** This task introduces NO competing receipt
  store, provider registry, event table, or API namespace. Activity is persisted through the
  existing `ActivityRepository.createActivity` (existing `activities` table); receipts are produced
  exclusively through the canonical `receipt-writer.ts` surface (`completeTaskWithReceipt` /
  `buildCanonicalReceiptMarkdown` / `hashCanonicalReceiptMarkdown`) and gated by the existing
  `receipt_completion_enforcement` flag. Never forked. Replacing the existing receipt system is a
  non-goal.
- **§13 events are not this ticket.** The adapter adds no `document_integration_events` writes and
  no change/reconciler integration.
- **F1 direction (a) is the session's single sanctioned `packages/db` exception.** Per the task's
  allowed-path contract, the only `packages/db` change is the minimal `ACTIVITY_EVENT_TYPES` +
  `document_operation` vocabulary addition in `packages/db/src/index.ts` (plus its existing db test
  file `task-repository.test.ts`), chosen to fix F1 (disclosed above). `activity-event-spine.ts` and
  everything else in `packages/db` is untouched.
- **`.project-gate.json` unchanged.** The only observed gate deviation is the pre-existing
  server-workspace `std-env`/vitest hoisting crash described under Runner note, which is
  environmental (affects `npx vitest run` for ANY task in this checkout) and not a gate-logic
  defect in `.project-gate.json`. It is therefore not a "genuine" proof-command/gate change and is
  ruled out with this justification.
- **Allowed paths / other files untouched.** `receipt-writer.ts` and `receipt-writer.test.ts` (not
  extended), `revision-coordinator.ts`, `routes/document-integrations.ts`, `registry.ts`,
  `write-policy.ts`, `destinations.ts`, `capability-resolver.ts`, `types.ts`, `fake-adapter.ts`,
  `migrations.ts`, and all other document-providers files are unchanged.

---

## OQ-019 observations (no invented defaults)

OQ-019 is the owning open question for the receipt system. This task records only observations and
does not invent product defaults:

- The repository's canonical receipt writer (`completeTaskWithReceipt` /
  `buildCanonicalReceiptMarkdown` / `hashCanonicalReceiptMarkdown`) was confirmed as-is and used
  verbatim; no extension of that surface was required for the T-010 integration scope.
- The `receipt_completion_enforcement` flag (default enabled) was confirmed as the audited gate; the
  adapter reads it live and is reversible through the audited phase-2 flag framework.
- The T-009 mutation path (revision-coordinator + `document-integrations.ts` route) is already
  approved and was NOT edited. Wiring the activity-adapter primitives (persisting R-027 records and
  correlating the canonical receipt) into the route boundary is deferred to a real provider-adapter
  round (T-014+); this ticket supplies the tested integration contract and the receipt-traversal
  acceptance proof. Any product decisions on the receipt system remain OQ-019's.

---

## GLM 5.3 review round 2 — THE-951 r2 disposition (F1–F6 + integration-RED)

Round 1 verdict (THE-951-55b9708-glm53-r1): **CHANGES_REQUESTED** (blockers F1, F2; HIGH test gap;
F4/F5/F6 should-fixes; F3 record-only). Round 2 was issue-scoped to exactly the reviewed surface.
The verified-clean r1 surface (six-value actor vocabulary at the classify layer,
`completeTaskWithReceipt` composition without a fork/second store, flag gating, hops-4/5 traversal
negatives, no secrets/PII) was intentionally NOT touched; the full r1 focused + full suites remain
green.

### F1 (blocker, Correctness / R-027) — persisted structured trail no longer degrades

**Direction chosen: (a) extend the closed `ACTIVITY_EVENT_TYPES` vocabulary (db lane), the minimal
addition of `document_operation`.** Chosen over (b) remapping onto `artifact_linked` because a
document create/mutate/read/reconcile is a distinct first-class event (not an evidence-artifact
linkage), so carrying it as its own valid structured event keeps the downstream
`activity_event_type`-keyed consumption (listActivitiesByTaskId / receipt sourceEvents) honest.
Exactly one value (`document_operation`) was added to `packages/db/src/index.ts` `ACTIVITY_EVENT_TYPES`
(nothing else in `packages/db`); the adapter now passes `activity_event_type: 'document_operation'`.
Proof: `packages/db/src/task-repository.test.ts` (+1) exercises the REAL `createActivityRepository`
projection and asserts `document_operation` + `structured` + legacy_type null; and the real-repo
integration test asserts the same through the adapter (below).

### F2 (blocker, Security / attribution integrity) — no durable promotion of external actors

Adapter-side only, no db vocabulary change. `activity-adapter.ts` now maps the payload `actor_type`
through `schemaActorType`, which emits the honest schema-valid class for `agent`/`human`/`system` and
**fail-closed `unknown`** for `provider_external_actor`/`local_external_actor`/`unknown` (never
`agent`/`human`); `agent_name` (a row asserting a trusted Entity AGENT) is set ONLY for a genuine
`agent`-class actor. The honest class remains retrievable on `data.actorClass` and the principal on
`actor_principal_id` / `data.actorId`. Covered by the real-repo integration test (provider + local
external actor persist with `agent_name: null` and `actor_type: 'unknown'`) and capture-level unit
tests.

### HIGH test gap (blocker) — REAL-repository regression, failing-test-first

New `activity-adapter.integration.test.ts` drives `recordDocumentActivity` through the REAL
`createActivityRepository` on a temp DB (`ENTITY_TASK_DB_PATH` env switch, same pattern as the db
test suite), so the genuine `buildActivityEventProjection` SQL path runs.

**RED (on r1 HEAD `55b9708`, before fixes)** — command
`cd packages/server && <root>/node_modules/.bin/vitest run src/document-providers/activity-adapter.integration.test.ts`
→ **1 file / 3 tests failed**:
```
F1: expected 'legacy_event_observed' to be 'document_operation'
F2 (provider_external_actor): expected 'provider-user-99' to be null (agent_name promoted)
F2 (local_external_actor):    expected 'local-editor-7' to be null (agent_name promoted)
```
This reproduces exactly the reviewer's empirical F1/F2 findings at the real persistence surface.

**GREEN (r2 HEAD, after fixes)** — same command → **1 file / 3 tests passed**; focused suite
(adapter + integration + receipt-writer) **3 files / 40 tests passed**; full server suite
**211 files / 1935 tests passed**; db suite **22 files / 185 tests passed**; `npm run build` (strict
tsc) **exit 0**.

### F4 (MEDIUM, non-blocking) — receipt demand gated on agent mutations

`traverseAuditorChain` now requires a canonical receipt ONLY when `actorClass === 'agent'` (R-028
scopes the receipt to agent mutations). A human/non-agent operation with `receiptId: null` no longer
throws `AuditorTraversalGapError`; when a receipt id IS present it is still resolved/linked (dangling
still fails). Agent-mutation happy paths and all four r1 dangling-link negatives are unchanged.
Proof: new unit test "does NOT require a canonical receipt for a non-agent mutation".

### F5 (LOW, non-blocking) — dead/misleading surface removed

`idFactory` and `now` removed from `DocumentActivityPersistence` and `recordDocumentActivity`
(never used; tests passed `now` believing it injected determinism). `actorPrincipalId` removed from
`LinkDocumentMutationToReceiptInput` (never read). All test call sites updated accordingly. The real
repo mints ids/timestamps.

### F6 (LOW, non-blocking) — honest docstring

`linkDocumentMutationToReceipt`'s docstring no longer claims it "fails closed on a missing canonical
receipt" (no such branch exists — `receipt` is a required parameter). It now states that enforcement
is carried by the caller and the audited `receipt_completion_enforcement` flag (reported as
`required`), which is the honest description of what the function does.

### F3 — record-only, pending Henry (NOT coded)

Per the round-1 reviewer and this task's scope, the architecture acceptance-risk — that the adapter
is wired to nothing (no production module imports it; the T-008/T-009 create/mutate routes still
hardcode `receiptId: null`), so R-027/R-028 are unmet by any executable path until a real
provider-adapter round (T-014+) — is **NOT wired in this round**. No routes touched, no
`receiptId: null` placeholder changed. This is recorded here as **pending Henry's explicit
sign-off** (deferral decision under OQ-019), not unilaterally decided in-code.

### Additional test gaps (covered)

- Failed-op persistence (`succeeded: false` + non-null `reasonCode`) — new unit test.
- `taskId` threading (`task_id` on both the payload and the row) — new unit test + integration tests
  pass real `taskId`.
- Pre-existing `receiptId` preservation at linkage (`documentActivity.receiptId ?? receiptId`) — new
  unit test.
- `read` / `reconcile` operation types exercised — new unit test.
