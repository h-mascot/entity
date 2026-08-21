# T-019 (THE-960) — Microsoft Entra connection and tenant binding — EVIDENCE

Base: `c390aaa46f07898e8f368751b7aaf8871eaf8a2e` (T-018 approved). Branch: `runner/entity-document-integrations-20260818`.

## Verbatim authority quotes

Ticket block (phase2-canonical-prd.md ~:3902):

> ### T-019 — Implement Microsoft Entra connection and tenant binding
>
> Goal/value: Establish secure Microsoft identity.
>
> Dependencies: T-001, T-006.
>
> Scope: auth, admin consent state, tenant validation, secret references.
>
> Acceptance: R-010/R-032.
>
> Automated proof: tenant mismatch + revocation tests.
>
> Security: current provider auth docs must be cited in implementation evidence.

R-010 (~:983):

> ### R-010 — Microsoft tenant-aware authentication
>
> Microsoft integration must support Entra-based user/admin authorization and bind each connection to the intended Microsoft tenant.
>
> Implementation must validate the current provider documentation before fixing exact scopes or consent semantics.
>
> Acceptance criteria
>
> Connection record identifies the tenant binding without storing raw credentials.
>
> Cross-tenant artifact operations are rejected.
>
> Revoked authorization transitions to degraded/reauthorization state.
>
> Admin-consent-required state is visible and actionable.
>
> Validation
>
> Tenant mismatch test.
>
> Revocation test.
>
> Auth callback/CSRF tests.
>
> Sandbox tenant proof.

R-032 (~:1670), revocation bullets verbatim:

> ### R-032 — Least privilege and revocation
>
> Cloud integrations must request only scopes needed for enabled capabilities.
>
> Write authorization must not be required for read-only configurations.
>
> Disconnect/revocation must:
>
> prevent future writes;
>
> preserve Entity metadata according to retention policy;
>
> update connection readiness;
>
> avoid silently deleting business records.
>
> Validation
>
> Read-only auth test.
> Revocation test.
> Post-revocation write negative test.

Dependency graph row (~:4198): `T-006 --> T-019 --> T-020 --> T-022 --> T-023` / `-> T-021 --------^` / `--------------------> T-024`.

## RED → GREEN proof per acceptance element

All tests in `packages/server/src/document-providers/microsoft/connection.test.ts` (RED confirmed at base with module absent: `npx vitest run` → "Failed to resolve import ./connection" / 1 failed file; GREEN after implementation: 8 passed).

| R-010 element | Test |
|---|---|
| 1. Tenant binding without raw credentials | `RED R-010.1: connection record carries tenant binding + secret REFERENCES only (no raw credentials)`; plus `RED R-010.1: fails closed when a secret reference is not resolvable in the injected store` |
| 2. Cross-tenant operations rejected | `RED R-010.2: cross-tenant artifact operations are REJECTED (fail-closed, typed error)` — asserts typed TenantMismatchError, hex-only divergence, no raw tenant values in message, connection degraded after mismatch |
| 3. Revoked → degraded/reauthorization | `RED R-010.3/R-032: revocation transitions to degraded/reauthorization state, prevents future writes, preserves Entity metadata` |
| 4. Admin-consent-required visible/actionable | `RED R-010.4: admin-consent-required is a distinct visible, actionable state with a reauthorization path` |

R-010 validation mapping:
- **Tenant mismatch test** → `RED R-010.2 …` ✅
- **Revocation test** → `RED R-010.3/R-032 …` ✅
- **Auth callback/CSRF tests** → `RED callback/CSRF: state mismatch and replay are both rejected` ✅
- **Sandbox tenant proof** → DEFERRED per BUILD-CONTEXT.md:38 ("Do not deploy a sandbox or production environment as part of this Loom run.") — assigned to T-038/T-039 sandbox lanes. Rule-out recorded below.

R-032 validation mapping:
- **Read-only auth test** → `RED R-032: read-only scope configuration requires no write authorization to read, and cannot write` ✅
- **Revocation test / post-revocation write negative test** → covered inside `RED R-010.3/R-032 …` (write AND read both throw RevokedConnectionError post-revoke) ✅
- Capability honesty fold: `RED capability honesty: degraded / consent-pending / unauthorized states never lift a write lane` (`writeLaneLifted()` false in every non-authorized posture).

## Design summary

New module `packages/server/src/document-providers/microsoft/connection.ts`:

- **Injected dependencies only** (no defaults): `MicrosoftIdentityTransport` (begin/redeem authorization transactions; owns state-parameter generation and code redemption; returns observed tenant claims + consent outcome) and `MicrosoftSecretStore` (`put/exists/revoke`, handles only). No network I/O anywhere in the module; tests use recorded hand-rolled fakes (`FakeIdentityTransport.redeemQueue`, `CapturedIdentityCall[]`).
- **No raw secrets**: `MicrosoftConnectionRecord.secretReferences` holds opaque handle strings minted by the injected store; construction fails closed with `SecretReferenceUnresolvableError` if a handle does not resolve. Snapshot serialization asserted free of JWT/bearer/secret material. Typed errors carry lengths + first-divergent code point as `U+XXXX` hex only.
- **Tenant binding**: exactly one `{tenantId, issuerForm}` per record. Enforced at callback redemption AND at every `assertArtifactOperationAllowed` gate; mismatch throws `TenantMismatchError` and degrades the connection (`authState='degraded'`) — never coerced.
- **CSRF/state**: `beginAuthorization` stores a single outstanding pending state; `completeAuthorization` rejects missing/mismatched/replayed states with typed `CsrfStateMismatchError` carrying a `reasonCode`; snapshot exposes `lastCsrfFailure`.
- **Admin consent**: distinct `consentState='admin_consent_required'` (+ `requiresAdminConsent` on snapshot, typed `AdminConsentRequiredError`); actionable via a fresh `beginAuthorization → completeAuthorization` transaction (UI affordances deferred).
- **Revocation/disconnect**: `revoke()` sets revoked, `authState='unauthorized'`, `readinessState='degraded'`, clears pending state, rotates both secret references in the injected store; Entity metadata (`entityMetadataJson`) is never touched or deleted; subsequent read/write gates throw `RevokedConnectionError`.
- **Least privilege as data contract**: scopes are caller-supplied `MicrosoftScopeEntry[]` (`{name, kind: 'read'|'write', granted}`) — no scope names, GUIDs, or endpoint URLs invented here. Reads require only a granted read scope; writes additionally require full authorized posture (`writeLaneLifted()`).
- Composes existing conventions only: `DocumentAuthState`/`DocumentReadinessState`/`DocumentProvider` from `db/src/document-integrations`; no competing namespace, registry, receipt store, or event table introduced.

## Security doc citations (Microsoft Learn; semantics implemented)

Live re-verification was not possible in this deterministic lane; exact scope GUIDs/endpoint URLs remain injectable configuration. Semantics cited:

1. **"OAuth 2.0 authorization code flow" — Microsoft identity platform** — https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow — authorization-code redemption, PKCE, and the `state` parameter carried through the redirect and validated by the app (basis for begin/redeem transport seam + single-use CSRF state).
2. **"Add admin consent workflow" / admin consent semantics — Microsoft Entra ID** — https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-admin-consent-workflow — delegated permissions may require administrator approval before grants are effective; the request stays pending/actionable (basis for the distinct `admin_consent_required` state + retry path).
3. **"Validate tokens" / token issuer validation — Microsoft identity platform** — https://learn.microsoft.com/en-us/entra/identity-platform/validate-tokens — tokens carry tenant identifier claims (`tid`) and an `iss` issuer that applications must validate against their expected authority/tenant (basis for per-operation observed-claims gating against the bound `{tenantId, issuerForm}`).
4. **"Security best practices for application properties / tokens"** — https://learn.microsoft.com/en-us/entra/identity-platform/securing-single-page-applications and https://learn.microsoft.com/en-us/entra/identity-platform/id-tokens — treat token/secret material as opaque server-side, store secrets securely outside application config (basis for secret-reference-only doctrine and reference rotation on revocation).

Open question: live doc re-verification of exact scope strings/GUID forms is a wiring/sandbox-lane step (T-038+); this module invents none of them.

## Commands run (exit codes)

1. RED: `cd packages/server && npx vitest run src/document-providers/microsoft/connection.test.ts` → exit 1 (module absent).
2. GREEN focused: same command → exit 0, **8 passed (8)**.
3. Build: `cd packages/server && npm run build` → exit 0 (strict tsc clean after fixing the relative db import depth one level deeper than `document-providers/types.ts`: `../../../../db/src/document-integrations`).
4. Full suite (Node 22, `/opt/homebrew/opt/node@22/bin` prefix): `cd packages/server && PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run` → exit 0, **217 files passed / 2177 tests passed**. Note: an initial full run under default Node 26 produced widespread unrelated better-sqlite3 failures — the documented ABI mismatch; rerun on Node 22 as instructed, all green.
5. `git diff --check` → clean (run pre-commit).
6. `npm run ctrl:gate` — see final-answer note if flaked; rerun-once policy applied per instructions.

## Rule-outs (with observations)

- **phase2-canonical-prd.md** — READ-ONLY authority; quoted above, not edited.
- **types.ts** — NOT modified. Observation: `packages/server/src/document-providers/types.ts:49-55` defines `CapabilitySource`; the standing THE-958 F5 item (`ChangeTrackingCapabilityFold` missing `source: CapabilitySource`) actually lives at `google/reconciler.ts:139-145` — wiring-lane carry, untouched here. The connection surface needed no shared-contract addition: it composes the existing db-layer vocabularies and defines its own local contracts.
- **Routes/index.ts/adapters/db/capability-resolver/registry/write-policy/revision-coordinator/document-objects** — not edited. Observation examples: route mounting point `packages/server/src/routes/document-integrations.ts` exists (route lane); adapter contract at `types.ts:437-448`; `capability-resolver.ts:67-69` hosts the `capability_resolver_enforcement` flag gate. No new API namespace/event table/receipt store/provider registry created.
- **Callback-route mounting** — deferred to the wiring lane; this module exposes module-level `beginAuthorization`/`completeAuthorization` only.
- **Sandbox tenant proof** — deferred to T-038/T-039 per BUILD-CONTEXT.md:38 delivery boundary.
- **Receipt wiring deferral** — stands per Henry's t010-wiring-deferral-signoff; no receipt writes here.
- **OQ-018 observation (this lane's PRD-revisit assignment)**: `capability_resolver_enforcement` (phase2-flags.ts:59, default-enabled, env-gated via ENTITY_PHASE2_DISABLE_FLAGS; consumed by capability-resolver.ts:68 and routes/document-integrations.ts:218-220) remains the flag host while OQ-018 is formally open. Analysis: the Microsoft connection module intentionally does NOT add its own flag; it fails closed structurally (state machine gates, not flags), which is compatible either way OQ-018 resolves. If OQ-018 lands elsewhere, only the resolver's gate call sites move; this module needs no change. Recorded as observation only; nothing changed.
- **OQ-003** caller-attested `confirmed` — unchanged; operation gating takes caller-presented observed tenant claims (the same attestation pattern), noted without acting.
- **Scoped-AGENTS PRD-hash pin drift** — pending Henry; observation only.
- **THE-958 F5** — see types.ts rule-out above.
- **t016-F1 slide-lane route/adapter contradiction** — route lane; untouched.

## Open questions / risks

- Exact Microsoft scope identifiers and endpoint forms are injectable configuration; no documented-default invention. Live verification deferred (wiring/sandbox lane).
- Observed tenant claims at artifact-operation time are caller-attested until adapters/routes wire real token introspection (later Microsoft lanes); fail-closed posture makes premature trust non-exploitative but the attestation source must be hardened at wiring time.
