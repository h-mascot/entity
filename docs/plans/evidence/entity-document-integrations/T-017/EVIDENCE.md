# T-017 / THE-958 — Google change tracking and reconciliation — EVIDENCE

Worker implementation evidence. Base: `2a0dc371c6023863b85c81afd0405e239988bbfd` (T-016 approved, GLM 5.3 r1). Branch: `runner/entity-document-integrations-20260818`. Final SHA is stated only in the worker final answer (never inside tracked files).

## 1. Verbatim authority quotes (PRD read-only)

`docs/loom/entity-document-integrations/phase2-canonical-prd.md`, R-008 block (~`:927-952`):

> ### R-008 — Google change tracking
>
> Entity must update provider metadata after changes made outside Entity.
>
> Preferred mechanism:
>
> supported provider change notification/watch;
>
> polling reconciliation fallback.
>
> The implementation must tolerate duplicate and delayed notifications.
>
> Acceptance criteria
>
> External edit advances Entity's known revision.
>
> Duplicate notification does not duplicate versions/activity.
>
> Lost notification is recovered by polling/reconciliation.
>
> Change-tracking failure exposes degraded health rather than silently freezing metadata indefinitely.
>
> Validation
>
> Duplicate event test.
>
> Out-of-order event test.
>
> Poll reconciliation test.
>
> Simulated webhook/watch expiration test.

T-017 ticket block (~`:3882`):

> ### T-017 — Implement Google change tracking and reconciliation
>
> Goal/value: Keep Entity current after provider-side edits.
>
> Dependencies: T-012.
>
> Acceptance: R-008.
>
> Automated proof: duplicate, delayed, missing notification tests.

## 2. Commands run (Node 22.22.2 via nvm; system default Node 26 has the documented better-sqlite3 ABI mismatch)

| Command | Result | Exit |
|---|---|---|
| `npx vitest run src/document-providers/google/reconciler.test.ts` (RED, at base, before `reconciler.ts` existed) | `Test Files 1 failed (1) / Tests no tests` — module-not-found import failure = RED reproducible at base | suite-fail (RED as intended) |
| `npx vitest run src/document-providers/google/reconciler.test.ts` (GREEN) | `Test Files 1 passed (1) / Tests 11 passed (11)` | 0 |
| `npm run build` (strict tsc) | clean after fixing one relative import (`'../../types'` → `'../types'`) | 0 |
| `npx vitest run` (full server suite at final HEAD) | **215 files passed / 2151 tests passed** (214 base files + this task's new test file; 2140+ expectation exceeded) | 0 |
| `npm run ctrl:gate` (run 1) | aborted: unrelated pre-existing file `src/routes/doc-intelligence-ask-schema.test.ts` failed 1 of 3 assertions inside the gate's vitest invocation (`[ctrl] unit tests failed`); that file passes solo (3/3) and passed in both standalone full runs — environmental flake under the gate runner, not touched by this diff | gate-abort (documented) |
| `npm run ctrl:gate` (run 2) | `[ctrl] unit tests passed` / `[ctrl] gate passed ✅`, 215 files / 2151 tests green | 0 |
| `git diff --check` | clean | 0 |

## 3. RED → GREEN proof per acceptance element

All tests live in `packages/server/src/document-providers/google/reconciler.test.ts`; all were written FIRST and fail at base because `reconciler.ts` does not exist there (whole-file import failure). After implementation all 11 pass.

| R-008 element | Test name (RED→GREEN) |
|---|---|
| External edit advances Entity's known revision | `R-008.1 external edit advances Entity known revision` — rev 10 → event rev 12 ⇒ registry `current_revision=12`, exactly 1 update, healthy watch-mode health |
| Duplicate notification does not duplicate versions/activity | `R-008 validation: duplicate event test — zero double-write` — same notification twice against known rev 11 ⇒ BOTH outcomes `duplicate-ignored`, **zero registry writes** (`totalUpdateCalls === 0`, zero-double-write asserted, not "no crash"); reinforced by `idempotent re-reconcile` (replayed batch ⇒ exactly 1 lifetime write) |
| Out-of-order/delayed never regresses | `R-008 validation: out-of-order event test — older event discarded, never applied backwards` — late rev 12 vs known rev 15 ⇒ typed auditable `stale-discarded` outcome, zero writes, state stays 15 |
| Lost notification recovered by polling/reconciliation | `R-008 validation: poll reconciliation test — lost notification recovered forward` — empty feed + snapshot observing rev 20 vs known 10 ⇒ `poll-reconciled`, state advances to 20 |
| Watch/webhook expiration → polling fallback with degraded health | `R-008 validation: simulated webhook/watch expiration test — falls back to polling with degraded health` — `watchActive:false` ⇒ health `{degraded, polling, watch_expired}`, and metadata does NOT freeze: polled event still advances state to 13 with a `watch-expired-poll-applied` outcome |
| Change-tracking failure exposes degraded health | `R-008.4 change-tracking failure exposes degraded health, never freezes or crashes` — source throws ⇒ health `{degraded, polling, change_tracking_failed}`, zero writes, no throw escapes |

### Four REQUIRED R-008 validation tests (by name)

1. Duplicate event test → `R-008 validation: duplicate event test — zero double-write`
2. Out-of-order event test → `R-008 validation: out-of-order event test — older event discarded, never applied backwards`
3. Poll reconciliation test → `R-008 validation: poll reconciliation test — lost notification recovered forward`
4. Simulated webhook/watch expiration test → `R-008 validation: simulated webhook/watch expiration test — falls back to polling with degraded health`

### Extra hard-requirement coverage

- `fail-closed: degraded change tracking never lifts a write lane / never marks capabilities supported` — on failure or expiration the folded `change_tracking` capability is `{state:'degraded', actionable:false}` and never `supported`.
- `revision-token strictness...` — inbound token containing U+202E raises typed `UnsafeReconcileRevisionTokenError` carrying field name + code point only; raw token absent from the message; zero writes. Uses the shared canonical `UNSAFE_REVISION_TOKEN_CHARACTERS` from `revision-coordinator.ts`.
- `workspace isolation...` — events/snapshot for another workspace's document resolve to `unknown-document` from this lane's view; zero reads across the boundary, zero writes.
- `typed outcomes are auditable...` — mixed batch yields discriminated `duplicate-ignored` / `stale-discarded` / `applied` outcomes in order.

## 4. Design summary (existing surfaces only)

`createGoogleChangeReconciler({ registry, changeSource, compareRevisions, providerConnectionId? })`:

- **Injected change source** (`GoogleChangeSource.poll()`), constructor-required, no default, no network — mirrors the adapters' injected-transport convention. Tests use hand-rolled fake sources with recorded fixture sequences.
- **Registry is the only persistence**: events reconcile through `findByProviderIdentity` / `update` on the T-004 `DocumentRegistry` (structural view declared for fakeability). Known revision lives in `current_revision` — never a parallel revision store.
- **Ordering policy injected** via required `compareRevisions` over opaque provider tokens (no invented global ordering).
- **Degraded health** exposed as `{state, mode, reason}` plus a capability fold for `change_tracking` following R-002 vocabulary conventions; degraded NEVER marks `supported` nor lifts any write lane.
- **Token strictness** reuses `UNSAFE_REVISION_TOKEN_CHARACTERS` from `../revision-coordinator` (shared constant, no copy).

## 5. Rule-outs (with observations)

- **PRD (`phase2-canonical-prd.md`)**: READ-ONLY authority — quoted above, never edited.
- **`packages/db/src` / `db/index.ts`**: out of allowed paths. THE-953 r1 F3 signature-narrowing carry is REASSIGNED to the next db-owning lane — not executed here.
- **`registry.ts` (T-004)**: out of path; consumed as-is. Observation: its structural shape already supplies everything the reconciler needs (`findByProviderIdentity`, workspace-scoped `update`, `current_revision`); no extension required.
- **`revision-coordinator.ts` (T-008/T-009)**: out of path; imports the exported canonical `UNSAFE_REVISION_TOKEN_CHARACTERS` unchanged.
- **`routes/*`, `index.ts`**: out of path — NO production wiring added (hard requirement).
- **Adapters (`google/docs-adapter.ts`, `sheets-adapter.ts`, `slides-adapter.ts`)**, **`fake-adapter.ts`**, **`types.ts`**, **`capability-resolver.ts`**, **`document-objects.ts`**, **`write-policy.ts`**: out of path, untouched; conventions mirrored, not modified. Note: the adapters' existing `reconcileChanges(input)` discovery-dedupe surface was left untouched — it addresses discovery dedupe, not notification reconciliation; this task's reconciler composes the registry directly rather than altering that contract.
- **`google-docs-metadata.ts`**: RULED OUT, untouched. Observation: degraded change-tracking health is returned by the reconciler's own result object (`health` + `changeTrackingCapability` fold); surfacing it through the legacy external-ref metadata projection would couple a Phase-2 reconciler to the pre-Phase-2 projection and is not required by R-008 acceptance. If a later wiring lane wants it there, that is a wiring decision, not a T-017 requirement.
- **No new event table / receipt store / API namespace**: reconciliation state is derived per-pass from the change source plus the existing registry record; processed-event idempotency rests on revision equality against `current_revision`, so no durable event log is needed and none was invented.
- **Sandbox / manual proof**: DEFERRED per `BUILD-CONTEXT.md:34-40` ("Do not deploy a sandbox or production environment as part of this Loom run", future `ship:sandbox`/`verify:sandbox` path) — cite BUILD-CONTEXT.md:38.
- **Receipt wiring**: deferred — no receipts are minted here; remains pending Henry `t010-wiring-deferral-signoff`.

## 6. Open-question observations (no defaults invented)

- Revision ordering is fully caller-injected (`compareRevisions`); if a production composition root later needs a canonical Google ordering (e.g. numeric change IDs vs opaque tokens), that is an unresolved decision for the wiring lane.
- Duplicate detection is revision-equality-based; a provider that re-emits the same eventId with DIFFERENT revisions would be treated as a new edit (applied forward). No PRD text contradicts this; recorded as an observation, not silently decided.
- Standing observation-only items untouched: OQ-003 `confirmed` boolean caller-attestation; OQ-018 `capability_resolver_enforcement` flag-reuse coupling; scoped-AGENTS PRD-hash pin drift (escalation pending); T-016 r1 F1 slide-lane route/adapter contradiction.

## 7. Unresolved risk

- First `ctrl:gate` run hit a one-off failure in unrelated `src/routes/doc-intelligence-ask-schema.test.ts` under the gate's vitest invocation; it passes solo and in both full-suite runs, and the second `ctrl:gate` run passed cleanly (215 files / 2151 green). Judged environmental, consistent with the documented gate-runner fragility; noted verbatim above rather than hidden.
