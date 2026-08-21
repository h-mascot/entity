# T-020 (THE-961) — Microsoft destination discovery/policy — EVIDENCE

Branch: `runner/entity-document-integrations-20260818`. Base: `df38a8a2` (T-019 approved).
Allowed paths honored: `packages/server/src/document-providers/microsoft/destinations.ts` (new),
`packages/server/src/document-providers/microsoft/destinations.test.ts` (new), this evidence
directory. FINAL_SHA is stated only in the worker's final answer, never in tracked files.

## R-011 acceptance criteria + validation (verbatim, from `phase2-canonical-prd.md`, "R-011 — Microsoft OneDrive/SharePoint destination model", ~lines 1009–1030)

Acceptance criteria:

1. "Creation always identifies an allowed destination."
2. "SharePoint site/library identity is retained sufficiently for rediscovery."
3. "An artifact moved or renamed does not automatically become a new Entity document if provider identity remains stable."

Validation: "Destination fixture tests." / "Rename/move synchronization test." / "Sandbox OneDrive/SharePoint proof where available."

**Rule-out:** the third validation item (sandbox OneDrive/SharePoint live proof) is DEFERRED to T-038/T-039 per `BUILD-CONTEXT.md:38` ("sandbox/manual-proof deferral"). This round delivers the two REQUIRED module-level test classes; no live network calls were made.

## RED → GREEN per acceptance element

RED was confirmed at base before implementation (`npx vitest run src/document-providers/microsoft/destinations.test.ts` → `Test Files 1 failed (1) / Tests no tests` — module did not exist). GREEN after implementation:

| R-011 element | RED→GREEN test |
|---|---|
| 1. Creation always identifies an allowed destination | `resolves exactly one allowed OneDrive destination`; `resolves an allowed SharePoint library destination` |
| 1-negative: denied/missing/unresolvable/ambiguous | `policy-denied destination rejects with a typed error (fail closed)`; `missing workspace policy rejects with a typed configuration error`; `unresolvable destination rejects and never coerces to a default`; `ambiguous permitted set rejects instead of guessing a destination` |
| 2. SharePoint identity retention for rediscovery | `retains SharePoint site/library identity sufficient for rediscovery` (retainDestinationRecord → rediscoverDestination through the same injected seam) |
| 3. Rename/move identity stability | `rename/move keeps provider identity — NOT a new Entity document` (`sameEntityDocumentIdentity`: stable driveId+itemId ⇒ same Entity document; changed itemId ⇒ different) |

Required negative-path tests:

- Cross-tenant rejection: `cross-tenant observed destination rejects (fail closed)` — shared `TenantMismatchError` from connection.ts.
- Degraded path: `degraded connection never resolves any destination capability`; plus `unauthorized connection never resolves any destination`, `admin-consent-pending connection blocks destination resolution`, `revoked connection blocks destination resolution`, `no granted write scope never lifts destination resolution`.
- Structural fail-closed: `malformed retained record (missing both identities) fails closed`.

## Destination fixture tests

All tests use hand-rolled fakes with recorded fixture sequences (`fakeTransport` script map); every identifier (`ws-fixture-1`, `tenant-fixture-a`, `drive-fixture-1`, `site-fixture-1`, …) is an opaque fixture string with no real-world meaning. No Graph endpoint URLs, site IDs, drive IDs, or scope GUIDs are invented anywhere in code or fixtures.

## Commands run (exit codes)

| Command | Result |
|---|---|
| `cd packages/server && npx vitest run src/document-providers/microsoft/destinations.test.ts` (RED, at base) | exit 1 — module missing (expected RED) |
| same command after implementation | **15 passed (15)**, exit 0 |
| `cd packages/server && npm run build` (strict tsc, Node 22) | exit 0 |
| `cd packages/server && npx vitest run` (full suite, Node 22) | **218 files passed / 2203 tests passed**, exit 0 |
| `npm run ctrl:gate` | `[ctrl] gate passed ✅`, exit 0 — passed on first run; the known doc-intelligence flake did NOT occur |
| `git diff --check` | clean, exit 0 |

Node note: initial full-suite run on Node v26.5.0 produced better-sqlite3 ABI failures across pre-existing suites (environment issue, unrelated to this change); rerun under Node 22 (`/opt/homebrew/opt/node@22/bin`, v22.22.x) per task verification requirements — all green.

## Design summary

- Injected seam: `MicrosoftDestinationTransport.resolveDestination()` — constructor/function-parameter injection with no default, mirroring `MicrosoftIdentityTransport` in connection.ts. No network I/O, no credentials, no tenant data.
- Workspace policy: `MicrosoftWorkspaceDestinationPolicy` is an injected data contract (per-workspace permitted OneDrive and/or SharePoint library destinations). No invented defaults anywhere; empty policy ⇒ typed `DestinationPolicyMissingError`, fail closed.
- Fail-closed resolution order in `resolveCreationDestination()`: connection posture gate → policy-exists gate → per-entry structural+binding validation → exact-scope filter (zero survivors ⇒ `DestinationNotPermittedError`, never a fallback default) → uniqueness (>1 survivor ⇒ `AmbiguousDestinationError`) → transport resolution with observed tenant claims enforced against the binding (`TenantMismatchError` / `DestinationUnresolvableError`).
- Identity retention: `retainDestinationRecord()` produces a pure serializable `MicrosoftRetainedDestinationRecord` carrying driveId/ownerUserId/siteId/libraryId; `rediscoverDestination()` re-resolves through the same injected seam with binding enforcement.
- Rename/move stability: `sameEntityDocumentIdentity()` keys ONLY on opaque (driveId, itemId); paths/display names are deliberately absent from the contract so a move/rename cannot mint a "new" Entity document when provider identity is stable.
- Capability honesty: revoked/degraded/unauthorized/admin-consent-pending/consent-unknown/write-scope-ungranted connections never resolve any destination capability, reusing the shared typed errors from connection.ts (single error vocabulary across the Microsoft lane).
- No raw secrets: opaque identifiers only; typed errors carry reason codes and lengths, never raw values.

## Rule-outs (with observations)

- `phase2-canonical-prd.md` — read-only authority; NOT edited (verified via final `git status`).
- `write-policy.ts` — RULED OUT, not touched. Observation: it is provider-generic; its destination contract already covers Microsoft kinds via `document-providers/destinations.ts:34-35` (`'onedrive' | 'sharepoint_library'` in `DestinationKind`), and its scope/allowance machinery (`resolveCreateAllowance`, `UnapprovedDestinationError`, write-policy.ts:488 total lines) needs no Microsoft-specific addition. The Microsoft fold consumes these shapes without modification, so no shared contract change was required.
- `microsoft/connection.ts` — NOT touched (T-019 surface). Reused exports only: `TenantMismatchError` (:75), `DegradedConnectionError` (:123), `AdminConsentRequiredError`, `RevokedConnectionError`, `InsufficientScopeError`, `MicrosoftConnectionSnapshot`, `MicrosoftTenantBinding`, and the posture doctrine of `writeLaneLifted()` (:416).
- `document-providers/types.ts` (461 lines) — not touched; no provider-neutral type change needed.
- `capability-resolver.ts` — not touched; its `DestinationAllowance` pass-through (:49) is unchanged and OQ-018 (`capability_resolver_enforcement`) remains recorded, no change.
- Routes / `index.ts` / adapters / `registry.ts` / `document-objects.ts` / `db/*` / app code — not touched; route wiring is a later lane (T-022+).
- No new API namespace, receipt store, provider registry, event table, migration, or OpenWiki regeneration.

## Standing items recorded as carries / observations (NOT acted on)

- T-019 follow-ups M1 ("until reauthorization" phrasing), M2 (write-path error conflation), M4 (degraded-recovery test gap): carries — connection.ts was not an allowed path. M3 (scope-entry shape validation) is wiring-lane.
- THE-958 F5 (`ChangeTrackingCapabilityFold` missing `source`) → wiring lane; t016-F1 slide-lane contradiction → route lane.
- Receipt wiring deferral (pending Henry `t010-wiring-deferral-signoff`) — no receipt wiring performed.
- Scoped-AGENTS PRD-hash pin drift 83cacbc5 vs actual c82e82d8 — pending Henry loom-owner re-pin; untouched.

## Secret-reference doctrine note

No tokens, credentials, tenant data, or operator-specific absolute paths appear in code, tests, fixtures, error messages, or this evidence. All provider identifiers are opaque fixture strings; secret handling stays behind the T-019 secret-store reference convention (untouched here).

## Open questions (observations, no invented defaults)

1. Exact live Graph endpoint URL forms and the real semantics tying siteId/libraryId/driveId together require live-documentation re-verification — flagged as a wiring/sandbox-lane step (T-038/T-039). This module intentionally defines only identity SHAPES as opaque injectable strings.
2. Whether SharePoint library destinations should also retain the site's web URL or group id for human-facing display is open downstream; the retained record currently carries only opaque stable identifiers (deliberately minimal).
3. Multi-destination policies currently reject ambiguity rather than accepting caller-selected disambiguation; if a future lane wants explicit per-request destination choice, it should layer on the T-007 `WriteRequestScope.destinationId` mechanism rather than loosening `AmbiguousDestinationError`.

---

# r2 addendum — THE-961 round 2 (GLM 5.3 review fixes), base bdcec705

All findings F1–F8 from the r1 GLM 5.3 verdict addressed; RED→GREEN discipline throughout (RED tests written and confirmed failing at base BEFORE implementation).

## Findings fixed

- **F1 (rediscovery gating/binding)** — `rediscoverDestination` now takes a mandatory `connection` snapshot (same posture gate as creation via `assertConnectionMayResolveDestinations`) and a MANDATORY `tenantBinding` (optional→required: unbound rediscovery is a compile-time impossibility for TS callers, with a runtime `InvalidDestinationRecordError('authority')` guard for JS callers). Binding-vs-record and observed tenant/issuer claims enforced on every rediscovery. Header/EVIDENCE claims updated to match the implemented contract.
- **F2 (result-side allowlist enforcement)** — new `ObservedIdentityMismatchError`: the transport's observed identity is verified against the permitted entry's identity per required fields (kind always; driveId for onedrive; siteId+libraryId, plus configured driveId, for sharepoint) on BOTH creation and rediscovery, BEFORE any retention (`retainDestinationRecord` can no longer persist drifted identities). The transport's echoed `requestedDestinationId` is verified against the requested id on both paths.
- **F3 (authority cross-checks)** — new `DestinationAuthorityMismatchError`: at entry, `policy.connectionId === connection.connectionId` is enforced, and the caller-presented `tenantBinding` must equal `connection.tenantBinding` (tenant + issuer) else `TenantMismatchError`. A mis-wired caller is rejected before any gating or resolution.
- **F4 (honest diagnostics)** — a disabled-only configuration now emits `reasonCode='no_enabled_candidate'`; scope/type mismatches among enabled entries keep the existing codes. The previously-dead code path is now reachable and honest.
- **F5 (redaction consistency)** — `DestinationPolicyMissingError` and `DestinationUnresolvableError` messages now carry lengths only (`workspaceLength=N`, `destinationLength=N`); header invariant ("typed errors carry reason codes and lengths, never raw values") now holds across all typed errors in this module.
- **F6 (truthful consent error)** — `consentState==='unknown'` now throws the new module-local `DestinationConsentUnknownError` carrying `(consentState=unknown, authState=<state>)` instead of a misleading "CONNECTION_NOT_AUTHORIZED (authState=authorized)" `DegradedConnectionError`. No connection.ts edit needed (fix confined to this module's throw site).
- **F7 (explicit destination choice)** — IMPLEMENTED as a small backward-compatible change: optional `requestedDestinationId?` argument to `resolveCreationDestination`. It only NARROWS the already-permitted enabled candidate set (select, never widen); an id outside the permitted set throws `DestinationNotPermittedError('policy_scope_mismatch')`, and omitting it preserves exact r1 semantics including `AmbiguousDestinationError`. This honors T-007's `WriteRequestScope.destinationId` doctrine inside the existing contract; no ceiling enlargement.
- **F8 (test gaps)** — added coverage for: per-entry `TenantMismatchError`, creation-path `InvalidDestinationRecordError('identity.driveId')` and `('identity.siteId/libraryId')`, both issuer-mismatch halves (creation + rediscovery), rediscovery gating/binding (F1), observed-identity drift + echoed-id mismatch on both paths (F2).

## RED→GREEN per finding (RED counts = tests failing at base bdcec705 for the stated reason)

- F1: 3 RED (F1a revoked, F1b degraded, F1c unbound) + 2 confirming tests passing at base (F1d/F1e — binding/issuer enforcement partially pre-existed; now mandatory+gated).
- F2: 4 RED (drift-creation, echoed-id-creation, drift-rediscovery, echoed-id-rediscovery).
- F3: 1 RED (policy/connection divergence). The binding-vs-connection test passes at base transitively (per-entry tenant check) — kept as regression coverage.
- F4: 1 RED. F5: 1 RED. F6: 1 RED. F7: 2 RED (selection works / non-permitted id fails closed).
- F8: 4 confirming tests pass at base (enforcement existed; coverage gap closed).
- Total RED at base: 13 failing / 22 passing; GREEN after fix: 35/35.

## Verification (Node 22)

1. Focused: `npx vitest run src/document-providers/microsoft/destinations.test.ts` → **35 passed (35)**, exit 0.
2. `npm run build` (strict tsc) → exit 0.
3. Full server suite at final HEAD: `npx vitest run` → **218 files passed, 2223 tests passed**, exit 0.
4. `npm run ctrl:gate` → see commit-time record below; `git diff --check` clean; worktree clean after single commit.

## Rule-outs (r2)

- `microsoft/connection.ts` — not edited; F6 resolved entirely within destinations.ts via the module-local `DestinationConsentUnknownError` (documented in the header as the one deliberate addition to the shared error vocabulary, since connection.ts was out of scope and DegradedConnectionError cannot express consent-unknown-with-authorized-auth).
- All other paths unchanged from r1 rule-outs; PRD read-only; no routes/db/types/registry/write-policy/capability-resolver/Google-lane/OpenWiki changes; no network verification attempted (live Graph endpoint re-verification remains the disclosed wiring/sandbox carry; OQ-013 stays injected-data; OQ-018 observation only).
