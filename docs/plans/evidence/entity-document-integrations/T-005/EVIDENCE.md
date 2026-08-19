# T-005 — Implement provider adapter contract and fake adapter

Issue: THE-946 ([LOOM-DOCS T-005] Implement provider adapter contract and fake adapter)
Run marker: `loom-run:entity-doc-integrations-20260809`
Worker model: `citadel/daystrom/deepseek` (medium) — pinned externally, not substituted.
Branch: `runner/entity-document-integrations-20260818`
Pre-issue reviewed base (T-004 approved HEAD): `a62d17de3c84ad5f6839e9d6a324fdf5006e7dd5`
Node: `nvm use 22` (v22.22.2) — required for better-sqlite3 native bindings (Node 26
`ERR_DLOPEN_FAILED` ABI mismatch).

## 1. Acceptance requirement (verbatim authority)

T-005 section of the canonical PRD (`docs/loom/entity-document-integrations/phase2-canonical-prd.md`):

> ### T-005 — Implement provider adapter contract and fake adapter
>
> Goal/value: Allow provider-independent development/testing.
>
> Dependencies: T-002, T-004.
>
> Scope: interface plus deterministic fake.
>
> Acceptance: shared contract tests can execute against fake.
>
> Security: unsupported mutation fails closed.

Supporting authority quoted verbatim (not paraphrased into new defaults):

- §10.2 "Proposed provider adapter contract" — the method surface:
  > `interface DocumentProviderAdapter { provider: "google_workspace" | "microsoft_365" | "local_office";
  > resolveCapabilities(...); discover(...); getMetadata(...); create(...); read(...); mutate(...);
  > getVersions?(...); getPreview?(...); getPermissions?(...); getOpenTarget(...); reconcileChanges(...) }`
  >
  > Not every adapter method implies every capability is supported. Capability resolution remains authoritative.
- §19.2 "Provider contract tests":
  > Every adapter must run against the same provider-neutral contract fixture. … register/discover,
  > metadata, create when supported, read when supported, mutate when supported, **unsupported mutation
  > rejection, revision capture, stale-write rejection, preview normalization, permission normalization,
  > open target, connection degradation, idempotent reconciliation**.
  >
  > Unsupported capability is a valid contract outcome. Lying about support is not.
- R-002 "Provider-neutral capability negotiation": "unknown must fail closed for mutation and embedding."
- R-024 "Revision-aware mutation" / R-025 "Standard conflict response" (stale-write rejection) / D-012.
- R-026 "Idempotent creation/retry behavior" (idempotency key persisted before the provider call).

## 2. Scope delivered (named paths)

| Path | Action |
| --- | --- |
| `docs/loom/entity-document-integrations/phase2-canonical-prd.md` | **Read-only authority — NOT modified.** Ruled out this round: T-005 lists it as a named path, but the operator-side authority-pin reconciliation (`83cacbc…` vs in-tree `c82e82d8…`) is pending Henry's decision; per the ticket the in-tree PRD content is the read-only authority for this task. |
| `packages/server/src/document-providers/types.ts` | **Extended (composed, not duplicated)** — adds the T-005 provider adapter contract (§10.2): `ProviderArtifactDescriptor`, `CapabilityContext`, the `DocumentProviderAdapter` interface, typed inputs/results, typed errors (`UnsupportedAdapterMutationError`, `StaleRevisionError`, `AdapterArtifactNotFoundError`), `mutationCapability`, and the shared `assertAdapterActionSupported` fail-closed guard. Reuses the existing T-002 capability model and R-001 db vocabulary (`provider`, `artifact_type`, auth/readiness/preview/conflict state) — no second capability namespace. |
| `packages/server/src/document-providers/fake-adapter.ts` | **Added** — deterministic fake implementing the contract. |
| `packages/server/src/document-providers/contract.test.ts` | **Added** — shared, provider-agnostic contract suite (TDD RED→GREEN). |
| `docs/plans/evidence/entity-document-integrations/T-005/EVIDENCE.md` | Added — this file. |
| `docs/plans/evidence/entity-document-integrations/T-004/EVIDENCE.md` | **Disclosed carry-forward fix (exactly one)** — appended dated correction note correcting the §2/§10 misdescription of `document-integrations.test.ts` as "out of scope, untouched" (GLM 5.3 r3 finding F-2). No history rewritten; no other section touched. |

No change outside these named paths was made (worktree diff at §8).

## 3. What T-005 delivers

Goal/value: **allow provider-independent development/testing.** Delivered as:

- A **shared adapter contract** in `types.ts` that any real provider adapter (Google, Microsoft,
  local Office) implements, composed from the T-002 capability model and the R-001 db vocabulary.
- A **deterministic fake adapter** in `fake-adapter.ts` that satisfies the contract with no network,
  no wall-clock dependence, and no uncontrolled randomness — so provider-independent tests can run
  against it now.
- A **shared, provider-agnostic contract suite** in `contract.test.ts` (`runAdapterContractSuite`)
  that the fake passes and that any future adapter reuses — exactly T-005's acceptance
  "shared contract tests can execute against fake."

### Contract design notes (compose, don't duplicate)

- The contract does **not** re-define capability names or state. It reuses `CapabilityReport`,
  `CapabilityState`, `CapabilityType`, and `capabilityAllowsActionForKey` from the T-002 types, and
  reuses `provider` / `artifact_type` / auth / readiness / preview / conflict vocabularies from the
  T-003 db layer. There is no competing API namespace, receipt store, provider registry, or event
  table.
- **`provider` and `artifact_type` are exposed explicitly on every adapter-supplied record**
  (`ProviderArtifactDescriptor`), satisfying the T-004 review design constraint (r3 F-1) so the
  registry can later reject cross-provider identity mismatch without any adapter-contract change. It
  also never assumes provider identity is derivable from the connection alone (connless adapters
  exist — `provider_connection_id` is nullable).

### Determinism guarantees (all verified by the suite)

- `create`/`mutate` accept an injected `now` and default to a fixed constant
  (`FAKE_ADAPTER_FIXED_NOW`), so timestamps never depend on the wall clock → identical seed + inputs
  ⇒ identical outputs (the determinism test creates identical fakes twice and asserts identical
  `external_id`, `current_revision`, and `provider_modified_at`).
- External IDs and revisions come from a monotonic deterministic counter (`rev-N`,
  `${provider}-${artifact_type}-N`), never a random UUID.
- The in-memory store is keyed by `external_id`, and `create` is idempotency-keyed for R-026 replay.

## 4. Shared contract suite — coverage

`runAdapterContractSuite(label, factory)` is the provider-neutral fixture (§19.2). Tests:

1. **Truthful capability report (D-003 / R-002)** — every key's `name` equals its key; no provider
   kind is write-authoritative.
2. **Success path** — `create → read → getMetadata` round-trips deterministically; every record
   carries `provider` + `artifact_type`.
3. **Revision capture (R-024 / §19.2)** — the created revision is actually observable through a fresh
   read, not fabricated.
4. **Unsupported mutation fails closed (typed error)** — each mutation lane the adapter does NOT
   advertise as supported is rejected loudly (`UnsupportedAdapterMutationError`), never a silent
   no-op; a write-suppressed adapter rejects `create`.
5. **Capability-mismatch** — an action excluded by the advertised capability report fails closed.
6. **Stale-revision write rejected (D-012 / R-024 / R-025)** — a stale `expectedRevision` throws
   `StaleRevisionError`; never a silent overwrite.
7. **Connection degradation (R-002)** — the deterministic fake folds a degraded connection's write
   lane to `degraded` and mutation fails closed.
8. **Idempotent discover + reconcile (R-001 / R-026 / §19.2)** — repeated identical discovery
   reconciles to the same result (no duplicates).
9. **Preview / permission / open-target normalization (R-034 / §19.2)** — preview is readiness state,
   permissions summary is leaf JSON (no tokens/credentials), open target returns provider+artifact
   type.
10. **Unknown artifact is typed, not fabricated** — `read` throws `AdapterArtifactNotFoundError`;
    `getMetadata` returns `null`.
11. **Determinism** — identical fresh fakes produce identical outputs.

## 5. RED → GREEN proof (TDD)

Shared suite written first against a NON-CONFORMING stub, then the real deterministic fake.

```sh
# RED — shared suite vs stub (stub throws AdapterArtifactNotFoundError / returns empties):
cd packages/server && nvm use 22 && npx vitest run src/document-providers/contract.test.ts
#   → Test Files 1 failed | Tests 10 failed | 1 passed (11)   [exit 1]

# GREEN — shared suite vs deterministic fake:
cd packages/server && nvm use 22 && npx vitest run src/document-providers/contract.test.ts
#   → Test Files 1 passed | Tests 11 passed (11)              [exit 0]
```

The 11 GREEN tests include the four required paths: success, unsupported-mutation fail-closed,
degraded/stale-revision, and capability-mismatch.

## 6. Fail-closed negative proof

The suite's unsupported-mutation, capability-mismatch, and degraded tests all assert
`UnsupportedAdapterMutationError` (typed). An additional one-off probe (not committed) confirmed a
**write-suppressed** build also fails CREATE and TEXT-MUTATION closed, and that an `unknown`
capability state fails closed:

```sh
cd packages/server && nvm use 22 && npx vitest run src/document-providers/_evidence-negative.test.ts
#   [temporary probe, deleted after capture]
#   → Test Files 1 passed | Tests 3 passed (3)               [exit 0]
#     - fake advertising create:'unsupported' → create() rejects (UnsupportedAdapterMutationError)
#     - fake advertising agent_text_mutation:'unsupported' → mutate(text) rejects
#     - fake advertising agent_text_mutation:'unknown' → mutate(text) rejects (R-002 unknown-fails-closed)
```

The probe file was removed before commit; the worktree is clean except the intended paths (see §8).

## 7. Capability honesty / reversibility (rollback note)

- **Single capability namespace:** the fake reports capabilities only through the T-002 capability
  model (`CapabilityReport` / `CapabilityType` / `CapabilityState`); it does not invent a second
  capability vocabulary. The shared `assertAdapterActionSupported` guard routes through T-002's
  `capabilityAllowsActionForKey`, which already fails closed on unknown/unsupported/degraded and on
  mislabeled reports.
- **Honest bounded baseline:** the fake advertises text-mutation-first support (`create`,
  `agent_text_mutation` supported), while `agent_range_mutation`, `agent_slide_mutation`,
  `permission_write`, and `embed_editor` are honestly `unsupported` — it never pretends a read is a
  write and never lies that an unsupported lane works ("Lying about support is not" a valid outcome).
- **Rollback / reversibility (audited flag framework):** the fake performs **no external provider
  writes** and registers **no immutable flag of its own**. Its developer/testing surface sits behind
  the audited Phase 2 flag host (`packages/server/src/phase2-flags.ts`), which T-006 owns registering
  the unified document-integration rollout flag on; flipping that flag off removes the surface with
  no data migration and no legacy recovery, consistent with R-036/R-037. Real provider adapters in
  later tickets must gate their rollout through the same framework.

## 8. Worktree / diff hygiene

```sh
git status --short   # only the intended paths:
#   M  packages/server/src/document-providers/types.ts
#   ?? packages/server/src/document-providers/contract.test.ts
#   ?? packages/server/src/document-providers/fake-adapter.ts
#   ?? docs/plans/evidence/entity-document-integrations/T-005/EVIDENCE.md
#   M  docs/plans/evidence/entity-document-integrations/T-004/EVIDENCE.md
git diff --check     # clean (exit 0)
```

## 9. Verification commands (Node 22 — v22.22.2)

```sh
cd packages/server && nvm use 22 && npx vitest run src/document-providers/contract.test.ts   # 11/11 exit 0
cd packages/server && nvm use 22 && npm run build                                            # tsc strict exit 0
cd packages/server && nvm use 22 && npx vitest run                                           # 206 files / 1762 tests exit 0
npm run ctrl:gate                                                                             # gate passed ✅ (server 1762 + db 184, exit 0)
git diff --check                                                                              # clean
```

`git diff --check` clean and worktree clean after commit.

## 10. Rule-outs / disclosures

- **PRD (`phase2-canonical-prd.md`) — READ-ONLY this round.** T-005 lists it as a named path, but the
  operator-side authority-pin reconciliation (`83cacbc…` vs in-tree `c82e82d8…`) is pending Henry's
  decision; the in-tree PRD content is this task's authority. Not modified.
- **`packages/server/src/document-providers/registry.ts` and db files (`packages/db/src/…`) — OUT.**
  The adapter contract composes the already-approved T-004 registry and T-003 db vocabulary but adds
  no registry, db, migration, or routing code. The T-004 review finding on cross-provider identity
  mismatch (`registry.ts:212` fail-open merge) is assigned to T-008, not this ticket, by design —
  the contract already exposes `provider`/`artifact_type` on every record so T-008's fix needs no
  adapter-contract change.
- No competing API namespace, receipt store, provider registry, or event table added.
- No Linear/GitHub/deploy/production writes; no push; no merge to main; no OpenWiki regeneration; no
  next-issue selection; no test allowlists or gate weakening.
- Privacy: no credentials, raw tokens, tenant secrets, document contents, or operator-specific
  absolute paths in code, fixtures, evidence, or output. The fake stores only leaf R-001 metadata
  and a synthetic placeholder string.

## 11. T-004 EVIDENCE correction disclosure (GLM 5.3 r3 finding F-2)

Per the ticket, the T-004 evidence `docs/plans/evidence/entity-document-integrations/T-004/EVIDENCE.md`
§2 table / §10 statement misdescribed `packages/db/src/document-integrations.test.ts` as "out of
scope, untouched". In fact T-004 (base `0f1f6fd` → `a62d17d`) added 221 lines to that test file as
the companion coverage for the new db `updateDocumentObject` primitive (and the review-round M2
correction). A dated correction note was **appended** to that file (no history rewritten, no other
section changed); see the appended "## 15. Correction notice" there for details.
