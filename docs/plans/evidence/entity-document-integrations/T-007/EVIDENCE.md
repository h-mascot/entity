# T-007 — Implement provider destinations and write policy

Issue: THE-948 ([LOOM-DOCS T-007] Implement provider destinations and write policy)
Run marker: `loom-run:entity-doc-integrations-20260809`
Worker model: `citadel/daystrom/deepseek` (medium) — pinned externally, not substituted.
Branch: `runner/entity-document-integrations-20260818`
Pre-issue reviewed base (T-006 approved HEAD): `9ffd549f48ff4461d4dfa3b9cccb2f55ba9db18b`
Node: `nvm use 22` (v22.22.2) — required for better-sqlite3 native bindings (Node 26
`ERR_DLOPEN_FAILED` ABI mismatch).

## 1. Acceptance requirement (verbatim authority)

T-007 section of the canonical PRD (`docs/loom/entity-document-integrations/phase2-canonical-prd.md`),
quoted verbatim (not paraphrased into new defaults):

> ### T-007 — Implement provider destinations and write policy
>
> Goal/value: Prevent uncontrolled write locations.
>
> Dependencies: T-003, T-006.
>
> Acceptance: R-003.
>
> Automated proof: allowed/denied destination tests.
>
> Security: workspace/tenant isolation.

R-003 acceptance criteria quoted verbatim (the authority this task implements):

> ### R-003 — Provider destination and policy model
>
> Entity must model where newly created artifacts are stored and which writes are authorized.
>
> Logical policy must support:
>
> provider;
>
> connection;
>
> artifact type;
>
> allowed destinations;
>
> default destination;
>
> write mode;
>
> optional confirmation policy;
>
> workspace/tenant scope.
>
> Minimum write modes:
>
> disabled
>
> create_only
>
> create_and_update
>
> Default after migration is disabled unless an existing explicit write authorization can be proven.
>
> Acceptance criteria
>
> A workspace cannot create into an unapproved destination.
>
> A read-only connection cannot be converted into write-capable merely because the OAuth token
> has broad scopes.
>
> Missing destination policy blocks creation with a typed configuration error.
>
> Policy can be disabled without deleting existing document records.
>
> Validation
>
> Policy unit tests.
>
> Negative create tests.
>
> Settings UI tests.
>
> Revocation/disable integration test.

Supporting authority quoted verbatim:
- Destination Policy Service component (§~line 2103): **Destination Policy Service** / **Resolves
  where creation is allowed.**
- `document_provider_destinations` (11.6) logical fields: id, connection_id, workspace_id,
  provider, artifact_type or wildcard, destination_kind, external_id or local managed-storage
  identity, display_name, write_mode, confirmation_policy, enabled.

## 2. Scope delivered (named paths)

| Path | Action |
| --- | --- |
| `docs/loom/entity-document-integrations/phase2-canonical-prd.md` | **Read-only authority — NOT modified.** Ruled out this round (see §9). |
| `packages/server/src/document-providers/destinations.ts` | **Added** — the R-003 destination model (workspace/tenant-scoped storage locations). |
| `packages/server/src/document-providers/write-policy.ts` | **Added** — the R-003 write policy (write modes, allowed/default destinations, confirmation policy, scoping, typed fail-closed errors). |
| `packages/server/src/document-providers/write-policy.test.ts` | **Added** — R-003 acceptance + negative-create + workspace/tenant-isolation tests (TDD RED→GREEN). |
| `docs/plans/evidence/entity-document-integrations/T-007/EVIDENCE.md` | Added — this file. |
| `packages/server/src/document-providers/capability-resolver.ts` | **Carry-forward fixes (THE-947 r1 F1, F2)** — see §8. |
| `packages/server/src/document-providers/capability-resolver.test.ts` | **Carry-forward RED/coverage tests (THE-947 r1 F2 RED, F3a, F3c)** — see §8. |
| `packages/server/src/document-providers/fake-adapter.ts` | **Carry-forward fix (THE-947 r1 F5)** — see §8. |
| `packages/server/src/phase2-flags.test.ts` | **Carry-forward coverage (THE-947 r1 F3b)** — see §8. |

No change outside these named paths was made (worktree diff at §10).

## 3. What T-007 delivers

**Goal/value: prevent uncontrolled write locations.** Delivered as a two-module logical model:

- **`destinations.ts`** — the destination records (R-003/11.6 `document_provider_destinations`):
  a workspace/tenant/provider/connection/artifact-scoped set of storage locations
  (`DocumentDestination`), with a single fail-closed applicability predicate
  `destinationServesScope` (every axis must match, else the destination never serves the scope).
- **`write-policy.ts`** — the authorization (`Destination Policy Service`, "resolves where
  creation is allowed"). A scoped `WritePolicy` pairs allowed destinations, a default
  destination, a write mode, an optional confirmation policy, and an explicit-write-authorization
  proof with workspace/tenant scope. Decisions are:

  - `resolvedWriteMode(policy)` — R-003's "default after migration is disabled unless an existing
    explicit write authorization can be proven": effective mode is `disabled` when the policy is
    disabled OR `writeAuthorizationProven` is false, regardless of any stored `writeMode`.
  - `findGoverningPolicy(policies, scope)` — workspace + tenant + provider + connection exact
    match, artifact type exact-or-`'*'` wildcard; a cross-workspace/tenant policy never governs.
  - `resolveCreateAllowance(...)` — throws a typed `MissingDestinationPolicyError` when no policy
    governs (acceptance 3); otherwise the create is authorized only when the effective write mode
    permits creation **and** the requested destination is approved (acceptances 1 and 2).
  - `resolveMutationAllowance(...)` — only `create_and_update` authorizes mutations.
  - `resolveDestinationAllowance(...)` — `allowed` only for an explicitly approved destination;
    `denied` outside the approved set; `unknown` when no approved set exists or no destination was
    chosen (fail closed — never an implicit allowance).
  - `requiresConfirmation(...)` — optional confirmation policy (R-003 logical model); only
    `'required'` gates on human confirmation. OQ-003 exact default is open downstream
    (null/auto_approve/not_required = no confirmation demanded).

**Destination-record gating (THE-948 r1 F1).** `resolveCreateAllowance(policies, destinations, scope)`
now CONSULTS the destination records via `destinationsServingScope` (the production caller it was
written for): every approved destination ID must resolve to a destination record that (a) exists,
(b) has `enabled === true`, and (c) serves the request scope exactly (workspace/tenant/provider/
connection/artifact type — `destinationServesScope`, fail closed on any mismatch/missing). An
explicit destination that is unapprovable — absent from the policy's approved set OR lacking an
enabled, scope-serving record — makes `resolveCreateAllowance` throw the typed
`UnapprovedDestinationError` (THE-948 r1 F5b: the exported error now has a genuine library caller).
Disabling a destination record therefore genuinely blocks creation, and a record that mismatches
the workspace/tenant/provider/connection/artifact type never authorizes a write. Destination-record
`write_mode` / `confirmation_policy` (PRD §11.6) remain UNMODELED this round (carried to T-008;
policy-level modes remain authoritative) — see §8a.

**Resolver integration.** The decision functions yield a `DestinationAllowance` / `PolicyAllowance`
that are consumed directly by the T-006 Capability Resolver's destination/policy folds. The
`write-policy.test.ts` proves end-to-end that defeating the policy/destination decision makes the
resolver's `create` (and every write/embed lane) non-actionable. The T-006 pass-through boundary is
closed for the *destination allowance* only to the extent this round's real model feeds it: a
`denied` destination hard-vetoes every `FAIL_CLOSED_CAPABILITIES` lane in the resolver (proven by
feeding `resolveDestinationAllowance`'s pure `'denied'` into `resolveCapabilities`); a
missing/disabled/mismatched destination record now throws inside `resolveCreateAllowance`, so such
a create never reaches the resolver as an allowance at all.

## 4. Automated proof — allowed/denied destination tests

`write-policy.test.ts` proves each R-003 acceptance + negative create + isolation:

1. **Write modes** — `disabled | create_only | create_and_update` are the minimum mode set;
   `resolvedWriteMode` returns `disabled` unless `writeAuthorizationProven`.
2. **Acceptance 1 (unapproved destination)** — a create into a destination absent from the
   approved set yields `destination: 'denied'` and `policy: 'denied'`; feeding the decision into
   `resolveCapabilities` makes `create` non-actionable. The approved/default destination is
   allowed and `create` is actionable.
3. **Acceptance 2 (read-only not write-promotable)** — a policy with stored `create_and_update`
   but `writeAuthorizationProven: false` resolves to `disabled`; the create decision is `denied`
   even when a fabricated `runtime.oauthScopes: ['create','write_all']` is present — broad OAuth
   scope alone never enables a write.
4. **Acceptance 3 (missing policy → typed error)** — no governing policy makes
   `resolveCreateAllowance` throw `MissingDestinationPolicyError` (instanceof `Error`, typed,
   carries the scope); a policy for a *different* artifact type likewise does not govern.
5. **Acceptance 4 (disabled preserves records)** — flipping `enabled:false` blocks new create
   (decision `denied`) while the policy record and its default destination remain intact — no
   deletion path exists in the write-policy module.
6. **Mutation lanes** — `create_only` allows create but denies update; `create_and_update`
   allows both; `disabled` denies every write lane.
7. **Workspace/tenant isolation** — a policy in another workspace/tenant never governs (typed
   error); a tenant-less request cannot claim a tenant-scoped policy (fail closed).
8. **Default destination + confirmation policy** — defaults resolve per policy; confirmation is
   required only when `confirmationPolicy: 'required'`.
9. **Destinations model** — `destinationServesScope` requires workspace/tenant/provider/
   connection/artifact all to align and the destination enabled.
10. **F4 decision** — a `denied` destination blocks every `FAIL_CLOSED_CAPABILITIES` lane (create,
    agent_text_mutation, permission_write, embed_editor) through the resolver, while `human_edit`
    is left to policy/runtime fail-closure (its fake baseline is the honest `unsupported`).

## 5. RED → GREEN proof (TDD)

RED was established against the current HEAD `9ffd549` **before** the T-007 model and carry-forward
F1/F2 fixes were implemented:

```sh
cd packages/server && nvm use 22 && npx vitest run src/document-providers/write-policy.test.ts
#   ❯ write-policy.test.ts (0 test) — "Cannot find module './write-policy'"   [exit 1]
cd packages/server && nvm use 22 && npx vitest run src/document-providers/capability-resolver.test.ts src/phase2-flags.test.ts
#   × F2 RED: a malformed/partial baseline report resolves to typed unknown, never throws
#       TypeError: Cannot read properties of undefined (reading 'state')  → capability-resolver.ts:214
#   × F2 RED: malformed baseline hostile `null` entries follow the same fail-closed default
#       TypeError: Cannot read properties of null (reading 'state')       → capability-resolver.ts:214
#   → Test Files 1 failed | Tests 2 failed | 38 passed (40)               [exit 1]
```

The RED failures prove the F2 carry-forward gap (a malformed/partial adapter baseline threw
`TypeError` instead of failing closed to `unknown`) and the absent T-007 model. After implementing
`destinations.ts` + `write-policy.ts` and the F1/F2/F5 carry-forward fixes:

```sh
cd packages/server && nvm use 22 && npx vitest run src/document-providers/write-policy.test.ts src/document-providers/capability-resolver.test.ts src/phase2-flags.test.ts
#   → Test Files 3 passed (3) | Tests 60 passed (60)                     [exit 0]
```

### 5a. GLM 5.3 r1 findings RED → GREEN proof (F1, F2)

RED was established by adding failing tests on the unmodified reviewed HEAD `fc0cd38` **before**
the F1/F2 fixes. New tests asserting the DESIRED behavior were added; on HEAD they fail because
the current code exhibits the buggy behavior, then pass after the fix.

```sh
cd packages/server && nvm use 22 && npx vitest run src/document-providers/write-policy.test.ts
#   — RED on fc0cd38 (4 new tests fail) —
#     × RED F1: an approved destination whose record is disabled does not authorize the create
#     × RED F1: an approved destination whose record mismatches the workspace does not authorize the create
#     × RED F1: an approved destination whose record mismatches the artifact type does not authorize the create
#     × exact policy governs even when the wildcard precedes it in the array
#   Test Files 1 failed (1) | Tests 4 failed | 24 passed (28)            [exit 1]
```

F1 RED: an approved ID whose destination record is `enabled:false` (or workspace/artifact-type
mismatch) still yielded `policy:'allowed'` today because `_destinations` was ignored. F2 RED: a
`'*'` policy preceding an exact policy wrongly governed the exact request.

```sh
cd packages/server && nvm use 22 && npx vitest run src/document-providers/write-policy.test.ts
#   — GREEN after F1 + F2 fixes (existing tests updated to the corrected behavior) —
#   Test Files 1 passed (1) | Tests 33 passed (33)                       [exit 0]
```

## 6. Per-acceptance negative proof (fail closed)

- **Unapproved destination rejected** — `write-policy.test.ts` "a workspace cannot create into a
  destination absent from the approved set (policy veto)": `decision.policy === 'denied'`,
  `decision.destination === 'denied'`, and `resolveCapabilities` leaves `create` non-actionable.
- **Read-only connection stays read-only** — "broad OAuth scope does not convert a read-only
  connection into write-capable": `resolvedWriteMode()==='disabled'` and the create decision is
  denied even with `runtime.oauthScopes: ['create','write_all']` present.
- **Missing policy → typed configuration error** — "no governing policy raises a typed
  configuration error": `resolveCreateAllowance` throws `MissingDestinationPolicyError`
  (instanceof `Error`; carries workspaceId), never silently allows.
- **Disable without deletion** — "disabling a policy blocks new writes but does not delete the
  policy/document records": `enabled:false` yields `policy:'denied'` while the policy record and
  its default destination remain intact.

## 7. F4 design decision (reviewer-mandated, settled explicitly)

**Decision: destination gating stays mutation/create-lane only — it does NOT extend to
`human_edit`.** `destinations.ts`/`write-policy.ts` implement exactly this, consistent with the
T-006 `capability-resolver.ts` fold inputs.

ADR-level rationale:
- **Fold-input consistency (primary).** The resolver's `destinationEvidence` gates precisely
  `FAIL_CLOSED_CAPABILITIES` (create, agent_text_mutation/range/slide_mutation, permission_write,
  embed_editor). Destination gating is a *where can a created artifact be stored* concern and is
  therefore a destination-scoped veto over provider write/embedding lanes. Extending the
  destination allowance to `human_edit` would require the resolver's destination fold to also gate
  `human_edit`, diverging from the capability model (`REQUIRES_SUPPORTED_CAPABILITIES` already
  covers `human_edit` through the **policy** fold, not destination).
- **`human_edit` is not a storage-destination write.** `human_edit` is the local client editing
  surface (R-019). Its fail-closure — "no local Edit action appears functional when the runtime
  cannot complete it" — is governed by **policy + runtime** readiness, not by the storage location
  an artifact is created into. A human Edit action does not select a provider destination for a
  *new* artifact; it edits an *existing* artifact whose destination was already fixed at creation.
- **No double-gating / no promotion.** `policyEvidence` already folds `REQUIRES_SUPPORTED_CAPABILITIES`
  (incl. `human_edit`); adding `human_edit` to destination gating would be redundant and would risk
  an inconsistent veto chain. The resolver is authoritative; T-007 keeps destination gating exactly
  inside the `FAIL_CLOSED_CAPABILITIES` lane set so the destination decision and the resolver's
  destination fold are one and the same.

This is proven in `write-policy.test.ts` ("destination gating covers mutation/create lanes and is
consistent with the resolver fold"): a `denied` destination blocks create/agent_text_mutation/
permission_write/embed_editor, while `human_edit` stays governed by its own (policy/runtime)
fail-closed baseline.

## 8. Carry-forward disclosures (reviewer-sanctioned, exact findings only, THE-947 GLM 5.3 r1)

Every edit below is a disclosed carry-forward from the referenced reviewed finding. No history was
rewritten (new commit on top of `9ffd549` only).

| Finding | File | Disclosed edit |
| --- | --- | --- |
| **F1** | `capability-resolver.ts:176-183` | `foldCapabilityReport`: assign `reasonCode = layer.reasonCode` unconditionally when a layer wins, so a winning fold layer that carries no `reasonCode` clears a stale one from an earlier (tied/lower) layer instead of inheriting a code that no longer applies to the resolved state. |
| **F2** | `capability-resolver.ts:214` | `resolveCapabilities` baseline fold: default a missing/null capability entry to `unknown` (`resolved?.state ?? 'unknown'`) instead of throwing `TypeError` on `baseline[name].state` — a malformed/partial adapter baseline fails closed to typed `unknown`, never crashes. |
| **F2 RED test** | `capability-resolver.test.ts` | New RED tests: a malformed/partial baseline report and a hostile-`null` baseline both resolve to `unknown` (never throw) and leave the affected lanes non-actionable. |
| **F3a** | `capability-resolver.test.ts` | Extended partition-exhaustion/coverage: `mutationGateOpen:false` vetoes ALL six `FAIL_CLOSED_CAPABILITIES` lanes (create, agent_text_mutation, agent_range_mutation, agent_slide_mutation, permission_write, embed_editor) with `source:'runtime'`; `healthy:false` coverage completed across every capability class with the correct fold invariant (supported→degraded+source runtime, adapter-unsupported→stays unsupported, never promoted); open gate + healthy runtime leave the baseline intact. |
| **F3b** | `phase2-flags.test.ts` | Coverage for `capability_resolver_enforcement` (default-enabled, `ENTITY_PHASE2_CAPABILITY_RESOLVER_ENFORCEMENT` env override, `coverage.capability_resolver` diagnostics key, presence in `groups.enforcement`) and the documented `capabilityResolutionEnabled` rollback switch (default on; disable-list and env-off both return `false`). Landed before T-008 routes through the flag. |
| **F3c** | `capability-resolver.test.ts` | Tightened the end-to-end unknown-connection admission-lane rejection from `rejects.toBeInstanceOf(Error)` to `rejects.toBeInstanceOf(UnsupportedAdapterMutationError)` (in the existing `:332` spot and a new dedicated `F3c` test) so the fail-closed path is the explicit typed error. |
| **F5** | `fake-adapter.ts` | `buildReport` connection-fold labeling now matches the resolver: an `unknown` connection folds write/human_edit lanes to `unknown` (not `degraded`), degraded/unauthorized fold a supported lane to `degraded`, and `source:'connection'` is tagged only when the fold actually changed the lane (cosmetic — resolver stays authoritative). |

## 8a. GLM 5.3 review round 1 findings disposition (THE-948 r1 → r2, new commit on top of `fc0cd38`)

The independent GLM 5.3 round-1 review (verdict CHANGES_REQUESTED) found one blocking
architecture/correctness gap (F1), one blocking correctness/test gap (F2), and several minor
findings (F3–F5). Disposition:

| Finding | Severity | Disposition |
| --- | --- | --- |
| **F1** — dead `_destinations`; destination records not in the authorization decision | Medium (blocking) | **Fixed.** `resolveDestinationAllowance` now takes the destination records and `resolveCreateAllowance` consults them via `destinationsServingScope` (the production caller it was written for), requiring every authorizing destination ID to resolve to an existing, `enabled`, scope-serving record. RED→GREEN proven in §5a. |
| **F2** — `findGoverningPolicy` first-match-wins, no exact-over-wildcard specificity | Medium (blocking) | **Fixed.** Encoded deterministic precedence: exact `artifactType` match governs over `'*'` regardless of array order; ties within a specificity class stay first-match-wins; wildcard governs only when no exact policy exists. Rule documented in the function's doc comment. RED→GREEN proven in §5a. |
| **F3** — carry-forward `reasonCode = layer.reasonCode` change untested | Low | **Fixed.** Added focused `reasonCode` tests in `capability-resolver.test.ts`: a tied-severity higher-precedence layer with no code clears a stale code; a layer carrying a code sets it; a non-winning layer's code is preserved when it remains the winner. |
| **F4** — vacuous tests (`write-policy.test.ts:101–105` tautology; `:118–121` duplicate) | Low | **Fixed.** Removed the tautological containment loop (the `WriteMode` union enforces the mode set at compile time — stated in the test) and removed the exact-duplicate block. |
| **F5a** — `resolveMutationAllowance` missing-policy throw path untested | Low | **Fixed.** Added a focused test asserting the mutation path throws `MissingDestinationPolicyError` (including a different-artifact-type no-govern case). |
| **F5b** — `UnapprovedDestinationError` exported but never thrown by library code | Low | **Fixed — thrown.** `resolveCreateAllowance` now throws `UnapprovedDestinationError` (typed, consistent with the taxonomy) for any explicit unapprovable destination. The export is no longer dead. |
| **F5c** — `defaultDestinationId` data-only in the decision path (record-only) | Low (record-only) | **Recorded.** Remains data-only (consistent with R-007 explicit-destination letter). No change — disclosed here. |
| **F5d** — wholly-null baseline report guard not covered (record-only) | Low (record-only) | **Recorded.** The disclosed threat model is entry-level (per-entry omissions/nulls), not wholly-null reports. No code change. |

Design questions carried to T-008 (not modeled this round, per ticket): destination-record
`write_mode` / `confirmation_policy` (PRD §11.6) are intentional gaps — policy-level
`writeMode` / `confirmationPolicy` remain authoritative; the exact OQ-003 default stays open.
T-008 route wiring will use the now-deterministic `findGoverningPolicy` precedence.

## 9. Rule-outs

- **PRD (`phase2-canonical-prd.md`) — READ-ONLY this round.** T-007 lists it as a named path, but
  the operator-side authority-pin reconciliation (`83cacbc…` vs in-tree PRD hash `c82e82d…`) is
  pending Henry's decision; per the ticket the in-tree PRD content is this task's read-only
  authority. Not modified.
- **No persistence layer / migrations / registry edits.** ISSUE-MAP names no db or migration path
  for T-007. The logical model in `destinations.ts`/`write-policy.ts` is a pure, serializable shape
  (documented so T-013/T-034 can persist it later into e.g. `document_provider_destinations`); this
  round adds NULL database code. `registry.ts`, `document-integrations.ts`, `migrations.ts` are
  untouched.
- **No routes / API namespace / provider registry / receipt store / event table.** T-008 wires
  routes through the resolver; T-020/T-013 add provider-specific destination discovery/UX;
  T-034 builds the admin UX. This round adds the pure policy model only.
- **Settings-UI and revocation/disable integration tests deferred.** R-003 lists these under
  Validation, but they are explicitly assigned to later UX tickets (T-013 settings-UI, T-034 admin
  UX, and the disable/revocation integration path); T-007's sanctioned automated proof is policy
  unit tests + negative create tests, both delivered here.
- **No competing receipt store, provider registry, or event table**; honors all applied MUST-FIX
  constraints in the PRD.
- No Linear/GitHub/deploy/production writes; no push; no merge to main; no OpenWiki regeneration;
  no next-issue selection; no test allowlists or gate weakening; no time/network/randomness
  dependence (deterministic, injected/static fixtures).
- Privacy: no credentials, raw tokens, tenant secrets, document contents, or operator-specific
  absolute paths in code, fixtures, evidence, or output.

## 10. Verification commands (Node 22 — v22.22.2)

Round 1 (reviewed HEAD `fc0cd38`, as recorded by the reviewer and this worker):
```sh
# Focused (ticket §1) — GLM 5.3 r1 reviewed gate
cd packages/server && nvm use 22 && npx vitest run src/document-providers/write-policy.test.ts \
  src/document-providers/capability-resolver.test.ts src/phase2-flags.test.ts   # 60/60 exit 0
# Full (ticket §2)
cd packages/server && nvm use 22 && npm run build                                 # tsc strict exit 0
cd packages/server && nvm use 22 && npx vitest run                                # 207 files / 1807 tests exit 0
git diff --check                                                                    # clean (exit 0)
```

Round 2 (r1-fix review, this file at final HEAD) — commands actually run:
```sh
cd packages/server && nvm use 22 && npx vitest run src/document-providers/write-policy.test.ts \
  src/document-providers/capability-resolver.test.ts src/phase2-flags.test.ts   # 70/70 exit 0
cd packages/server && nvm use 22 && npm run build                                 # tsc strict exit 0
cd packages/server && nvm use 22 && npx vitest run                                # 207 files / 1817 tests exit 0
git diff --check                                                                    # clean (exit 0)
git status --short                                                                  # only scoped paths (clean after commit)
```

Note on `npm run ctrl:gate`: the ctrl-gate runner does not itself select a Node runtime, so under
the PATH-default Node 26 it fails with the known `better-sqlite3` `ERR_DLOPEN_FAILED` ABI mismatch.
Running the gate in a shell that has selected Node 22 (`source ~/.nvm/nvm.sh && nvm use 22`) passes:
`[ctrl] unit tests passed` / `[ctrl] gate passed ✅` (exit 0). This is exactly the Node-22
requirement stated at the top of this ticket and in BUILD-CONTEXT.

## 11. Worktree / diff hygiene

```sh
git status --short   # only scoped paths, clean after commit (worktree clean)
git diff --check     # clean (exit 0)
```

Final commit: `FINAL_SHA` recorded in the commit message / final answer (GLM 5.3 r2 fix commit on
top of `fc0cd38`).
