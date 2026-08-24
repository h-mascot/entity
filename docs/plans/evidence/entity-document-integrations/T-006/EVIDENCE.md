# T-006 — Implement Capability Resolver

Issue: THE-947 ([LOOM-DOCS T-006] Implement Capability Resolver)
Run marker: `loom-run:entity-doc-integrations-20260809`
Worker model: `citadel/daystrom/deepseek` (medium) — pinned externally, not substituted.
Branch: `runner/entity-document-integrations-20260818`
Pre-issue reviewed base (T-005 approved HEAD): `24d28e31cc7be4bd9936a1eb7576e8f71ef96f0b`
Node: `nvm use 22` (v22.22.2) — required for better-sqlite3 native bindings (Node 26
`ERR_DLOPEN_FAILED` ABI mismatch).

## 1. Acceptance requirement (verbatim authority)

T-006 section of the canonical PRD (`docs/loom/entity-document-integrations/phase2-canonical-prd.md`),
quoted verbatim (not paraphrased into new defaults):

> ### T-006 — Implement Capability Resolver
>
> Goal/value: Make API/UI actions truthful.
>
> Dependencies: T-002, T-005.
>
> Acceptance: provider + connection + destination + policy + runtime resolution works.
>
> Automated proof: matrix tests.
>
> Not done until: unknown mutation is rejected.

Supporting authority quoted verbatim (not paraphrased):

- Capability Resolver component spec (§~line 2085):
  > **Capability Resolver**
  >
  > Combines:
  >
  > provider baseline;
  >
  > artifact type;
  >
  > authenticated connection;
  >
  > destination;
  >
  > policy;
  >
  > runtime;
  >
  > degraded state.
- R-002 "Provider-neutral capability negotiation": "unknown must fail closed for mutation and embedding."
- PRD gate table `R-002 => Capability Resolver capability matrix tests`.
- Capability ADR §5 (docs/adr/2026-08-entity-document-capability-architecture.md):
  > The Capability Resolver folds evidence in fixed precedence, lowest to highest … `adapter <
  > connection < destination < runtime < policy`.
  >
  > A lower-precedence `supported` is demoted to `degraded`/`unsupported` when a higher-precedence
  > source reports impairment. `unknown` at any source is treated conservatively and fails closed
  > for write/embedding capabilities. Precedence folding is implemented and unit-tested in T-006.

## 2. Scope delivered (named paths)

| Path | Action |
| --- | --- |
| `docs/loom/entity-document-integrations/phase2-canonical-prd.md` | **Read-only authority — NOT modified.** Ruled out this round (see §9). |
| `packages/server/src/document-providers/capability-resolver.ts` | **Added** — the T-006 resolver (single truthful verdict via precedence fold). |
| `packages/server/src/document-providers/capability-resolver.test.ts` | **Extended** — T-006 matrix tests appended to the sanctioned T-002 test plan. |
| `packages/server/src/document-providers/fake-adapter.ts` | **Carry-forward fixes (THE-946 r1 F1/F2/F5)** — see §8. |
| `packages/server/src/document-providers/contract.test.ts` | **Carry-forward probe tests (THE-946 r1 F3 + F4 fake-half)** — see §8. |
| `packages/server/src/phase2-flags.ts` | **Reversibility wiring** — registers `capability_resolver_enforcement` flag (see §7). |
| `docs/plans/evidence/entity-document-integrations/T-006/EVIDENCE.md` | Added — this file. |

No change outside these named paths was made (worktree diff at §10).

## 3. What T-006 delivers

Goal/value: **make API/UI actions truthful.** Delivered as a single Capability Resolver that folds
provider baseline + artifact type + authenticated connection + destination + policy + runtime +
degraded state into one `CapabilityReport` every caller can trust.

The resolver COMPOSES — it does not duplicate — the T-002 capability model (`CapabilityReport`,
`CapabilityState`, `capabilityAllowsActionForKey`, `REQUIRES_SUPPORTED_CAPABILITIES`,
`FAIL_CLOSED_CAPABILITIES`) and the T-005 adapter contract
(`DocumentProviderAdapter.resolveCapabilities`). It invents no second capability namespace, no
receipt store, no provider registry, and no event table.

### Concrete algorithm (`resolveCapabilities`)

1. **adapter (provider baseline + artifact type, `source: adapter`)** — call
   `adapter.resolveCapabilities` (T-005 contract) to obtain the truthful provider baseline for the
   artifact type, including any connection-awareness the adapter honestly reports.
2. **connection (`source: connection`)** — re-assert the authenticated connection state
   (defense-in-depth): `unknown` demotes **every** lane to `unknown` (fail-closed for mutation AND
   reading per R-002); `degraded`/`unauthorized` demote every lane to `degraded` (write/embed/
   human_edit then fail closed; read-like stay degraded-actionable).
3. **destination (`source: destination`, R-003 pass-through)** — `denied` → write lanes
   `unsupported`; `unknown` → write lanes `unknown` (fail-closed).
4. **runtime (`source: runtime`)** — `healthy:false` demotes all lanes to `degraded`;
   `mutationGateOpen:false` vetoes write lanes to `unsupported`.
5. **policy (`source: policy`, highest authority)** — `denied` → every
   `REQUIRES_SUPPORTED_CAPABILITIES` lane `unsupported`; `unknown` → those lanes `unknown`.

Folding is by increasing severity `supported(0) < degraded(1) < unsupported(2) < unknown(3)`: a
worse state always wins, a better state can never resurrect a worse one (R-002 honesty / "lying
about support is not"), and on a tie the highest-precedence contributor claims the `source` tag. A
capability with **no** evidence defaults to `unsupported` (fail closed).

Destination/policy are **minimal pass-through allowances** (allowed/denied/unknown). The real
Destination Policy Service (R-003) is owned by T-007 — see §9 for the boundary.

## 4. Automated proof — matrix tests

The T-002 sanctioned test plan (`capability-resolver.test.ts`) already locks the vocabulary,
state, and fail-closed semantics. T-006 appends a `Capability Resolver (T-006 precedence fold)`
suite that table-drives every capability × relevant fold input and partition-exhausts the matrix
via `REQUIRES_SUPPORTED_CAPABILITIES` (THE-943 r2 F4). Tests:

1. **Acceptance** — provider + connection + destination + policy + runtime resolution works (the
   baseline report is truthful, artifact-type aware).
2. **Connection-state matrix** — `authorized|degraded|unauthorized|unknown` folds every capability
   per its R-002 classification (write/embed/human_edit fail closed on impairment; read-like stay
   actionable when degraded; everything fails closed on `unknown`).
3. **Not-done-until negative** — `unknown` connection never resolves any mutation lane to
   `supported`; end-to-end through a real adapter `mutate` lane the mutation is rejected.
4. **Destination** — `denied`/`unknown` fail closed for create + every write lane; read-only lanes
   are unaffected.
5. **Policy** — `denied` vetoes every `REQUIRES_SUPPORTED_CAPABILITIES` lane even when the adapter
   supports it (highest authority).
6. **Precedence** — a failing connection demotes an optimistic adapter-supported lane; a policy
   veto outranks all (reports `source: policy`).
7. **Runtime** — `healthy:false` reaches all lanes; `mutationGateOpen:false` vetoes writes.
8. **Never-promote** — an adapter-unsupported lane stays unsupported across all downstream folds.
9. **Partition-exhaustion** — 4 connection × 3 destination × 3 policy = 36 full-report rows × 15
   capabilities, asserting every capability obeys its `REQUIRES_SUPPORTED_CAPABILITIES`
   classification (actionable iff `supported` for write/embed/human_edit; iff `supported|degraded`
   for read-like).

## 5. RED → GREEN proof (TDD)

RED was established against the current HEAD `24d28e3` **before** any implementation:

```sh
cd packages/server && nvm use 22 && npx vitest run src/document-providers/capability-resolver.test.ts src/document-providers/contract.test.ts
#   ❯ capability-resolver.test.ts (0 test) — "Cannot find module './capability-resolver'"   [exit 1]
#   ❯ contract.test.ts (17 tests | 2 failed):
#       × READ-LANE honesty: read/getVersions/getPreview/getPermissions fail closed when unsupported
#       × UNKNOWN connection is fail-closed for every mutation lane (R-002 negative probe)
#   → Test Files 2 failed | Tests 2 failed | 15 passed (17)                                  [exit 1]
```

The RED failures prove the carry-forward finding gaps: the fake did not yet guard read lanes on
advertised capability state (THE-946 F1) and did not yet treat `unknown` connection as fail-closed
for mutation lanes (THE-946 F2); the resolver module and its matrix did not exist.

After implementing `capability-resolver.ts` and the fake-adapter carry-forward fixes:

```sh
cd packages/server && nvm use 22 && npx vitest run src/document-providers/capability-resolver.test.ts src/document-providers/contract.test.ts
#   → Test Files 2 passed (2) | Tests 45 passed (45)                                        [exit 0]
```

## 6. Unknown-mutation-rejected negative proof (fail closed)

The ticket's "not done until" is proven in committed tests, not a one-off:

- `capability-resolver.test.ts` — "not-done-until: unknown connection never resolves any mutation
  lane to supported" (asserts every `FAIL_CLOSED_CAPABILITIES` lane is `unknown` and non-actionable)
  and the end-to-end adapter-lane test.
- `contract.test.ts` — "UNKNOWN connection is fail-closed for every mutation lane (R-002 negative
  probe)": after `setConnectionState('unknown')` a real `adapter.mutate` rejects with
  `UnsupportedAdapterMutationError`.
- `contract.test.ts` — "DEGRADED connection is fail-closed for a CREATE lane (negative probe)".

## 7. Capability honesty / reversibility (rollback note)

- **Single capability namespace.** The resolver folds only through the T-002 model and the T-005
  contract; `foldCapabilityReport` reuses `REQUIRES_SUPPORTED_CAPABILITIES` /
  `FAIL_CLOSED_CAPABILITIES` and every produced report satisfies `capabilityAllowsActionForKey`
  (the partition-exhaustion test asserts the invariant per capability).
- **Honest baseline.** A lane the adapter reports `unsupported` can never be promoted by any
  downstream fold (write/embed/human_edit are fail-closed by construction).
- **Reversibility through the audited flag framework.** `capability-resolver.ts` registers the
  rollout behind a Phase 2 flag: `capability_resolver_enforcement` was added to
  `packages/server/src/phase2-flags.ts` (`ENTITY_PHASE2_CAPABILITY_RESOLVER_ENFORCEMENT`,
  `defaultEnabled: true`); `capabilityResolutionEnabled(flags)` is the single reversible switch a
  caller (T-008 wiring) must consult before routing through the resolver. **Rollback:** set
  `ENTITY_PHASE2_DISABLE_FLAGS=capability_resolver_enforcement` (or the env override to `0`) — the
  resolution rollout is un-surfaced with no data migration and no legacy recovery (consistent with
  R-036/R-037); the resolver module itself remains pure and always computes a correct report, so no
  code change is required to revert behavior. This is documented reversibility through the audited
  Phase 2 flag host only — no competing flag store.

## 8. Carry-forward disclosures (reviewer-sanctioned, exact findings only)

Every edit below is a disclosed carry-forward from the referenced reviewed finding. No history was
rewritten (new commit on top of `24d28e3` only).

| Finding | File | Disclosed edit |
| --- | --- | --- |
| **THE-943 r2 F3** | `types.ts:75-83` + `capability-resolver.test.ts:198-219` | `capabilityAllowsActionForKey` already fails closed (returns `false`, never throws `TypeError`) on a missing or null report entry — **already present at base** `24d28e3` (added in T-005's reviewed commit); re-verified GREEN, no further change required this round. |
| **THE-943 r2 F4** | `capability-resolver.test.ts` | Matrix partition-exhaustion imports `REQUIRES_SUPPORTED_CAPABILITIES` and partition-exhausts every capability × fold state (union with T-002's exhaustive `unsupported|degraded|unknown` state matrix). |
| **THE-946 r1 F1** | `fake-adapter.ts` | Read-like lanes (`read`, `getVersions`, `getPreview`, `getPermissions`) now honor advertised capability state via `assertAdapterActionSupported` (fail closed on unsupported/unknown/absent instead of pretending content is available). |
| **THE-946 r1 F2** | `fake-adapter.ts` | Connection fold `degradationActive` now treats `connectionState:'unknown'` (adapter state and `ctx.connectionState`) as fail-closed for mutation lanes per R-002. |
| **THE-946 r1 F3** | `contract.test.ts` | Committed probe tests: R-026 create replay (`created:false`, same artifact); a DIRECT create-lane fail-closed guard test (not only the dead conditional at the shared `:166` spot); read-lane honesty assertions; unknown/degraded negative probes. |
| **THE-946 r1 F5** | `fake-adapter.ts` | Replaced hand-duplicated `WRITE_LANES` with the exported `FAIL_CLOSED_CAPABILITIES`. |
| **THE-946 r1 F4 (fake-side half)** | `contract.test.ts` + `fake-adapter.ts` | Commit-time assertion that every descriptor the fake returns carries `provider === adapter.provider` (create/discover/read/reconcile). |

## 9. Rule-outs

- **PRD (`phase2-canonical-prd.md`) — READ-ONLY this round.** T-006 lists it as a named path, but
  the operator-side authority-pin reconciliation (`83cacbc…` vs in-tree `c82e82d8…`) is pending
  Henry's decision; per the ticket the in-tree PRD content is this task's read-only authority. Not
  modified.
- **Destination Policy Service (T-007 boundary) — NOT implemented early.** Destination/policy are
  minimal `allowed|denied|unknown` pass-through allowances in the resolver. The real R-003
  Destination Policy Service (provider/connection/artifact-type/allowed+default destination/write
  mode/confirmation/workspace-scope) is owned by T-007; the resolver never fabricates an allowance
  from a provider name and treats `denied`/`unknown` as fail-closed until then. This is the
  documented boundary, not early T-007 work.
- **Registry / db / routes untouched.** `registry.ts`, `document-integrations.ts`, `migrations.ts`,
  route files and their tests are not modified. This ticket adds a resolver (pure fold), not a
  provider registry, receipt store, API namespace, or event table. T-008 (Document API) wires routes
  through the resolver.
- No Linear/GitHub/deploy/production writes; no push; no merge to main; no OpenWiki regeneration; no
  next-issue selection; no test allowlists or gate weakening.
- Privacy: no credentials, raw tokens, tenant secrets, document contents, or operator-specific
  absolute paths in code, fixtures, evidence, or output.

## 10. Verification commands (Node 22 — v22.22.2)

```sh
cd packages/server && nvm use 22 && npx vitest run src/document-providers/capability-resolver.test.ts src/document-providers/contract.test.ts   # 45/45 exit 0
cd packages/server && nvm use 22 && npm run build                                                                                            # tsc strict exit 0
cd packages/server && nvm use 22 && npx vitest run                                                                                           # 206 files / 1778 tests exit 0
npm run ctrl:gate                                                                                                                            # gate passed ✅ (app+db+server build; server 1778 + db 184 + other-workspace unit) — Node 22
git diff --check                                                                                                                             # clean
```

Note on `npm run ctrl:gate`: the ctrl-gate runner does not itself select a Node runtime, so under
the PATH-default Node 26 it fails with the known `better-sqlite3` `ERR_DLOPEN_FAILED` ABI mismatch
(85 server test files failed to load the native binding — unrelated to this change). Running the gate
in a shell that has selected Node 22 (`source ~/.nvm/nvm.sh && nvm use 22`) passes:
`[ctrl] unit tests passed` / `[ctrl] gate passed ✅` (exit 0). This is exactly the Node-22
requirement already stated at the top of this ticket and in BUILD-CONTEXT.

## 11. Worktree / diff hygiene

```sh
git status --short   # only intended paths:
#   M  packages/server/src/document-providers/capability-resolver.test.ts
#   M  packages/server/src/document-providers/contract.test.ts
#   M  packages/server/src/document-providers/fake-adapter.ts
#   M  packages/server/src/phase2-flags.ts
#   ?? packages/server/src/document-providers/capability-resolver.ts
#   ?? docs/plans/evidence/entity-document-integrations/T-006/EVIDENCE.md
git diff --check     # clean (exit 0)
```
