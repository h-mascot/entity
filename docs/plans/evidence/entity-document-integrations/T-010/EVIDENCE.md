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

- `packages/server/src/document-providers/activity-adapter.ts` (new — the integration adapter)
- `packages/server/src/document-providers/activity-adapter.test.ts` (new — colocated TDD tests,
  20 tests; the colocated test for the new module, mirroring the `revision-coordinator.test.ts`
  precedent on the T-009 path)
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

### GREEN — focused (final HEAD)

Command:

```sh
cd packages/server && <repo-root>/node_modules/.bin/vitest run src/document-providers/activity-adapter.test.ts src/receipt-writer.test.ts
```

Result (GREEN, exit 0):

```
 ✓ src/receipt-writer.test.ts (9 tests) 31ms
 ✓ src/document-providers/activity-adapter.test.ts (20 tests) 26ms

 Test Files  2 passed (2)
      Tests  29 passed (29)
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

Result: **210 test files passed, 1924 tests passed** (exit 0) — the 1904 pre-existing full-suite
count plus 20 new activity-adapter tests.

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
