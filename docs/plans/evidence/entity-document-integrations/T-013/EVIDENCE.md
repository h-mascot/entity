# THE-954 (LOOM-DOCS T-013) — Add Google admin write gate and destination UX — EVIDENCE

## Scope

Make Google write authorization explicit (R-005/R-007): admin authorization, destination,
write mode, confirmation policy, and a reversible audited feature flag. Broad OAuth scope
alone must never enable writes. Writes stay disabled unless every gate independently passes;
every gate fails closed. Carry forward the approved T-012 (THE-953) **F2 test-half** and land
it in this lane.

- Base (reviewed HEAD, T-012 approved): `50ea9839593c6261c8df024e8de370070f0296b3`
- Branch: `runner/entity-document-integrations-20260818` (no merge, no push)
- Node used everywhere: **v22.22.2** (Node 26 has a better-sqlite3 ABI mismatch).
- Runner: repo-root `node_modules/.bin/vitest` v4.0.18 (working runner; the server-workspace
  `npx vitest run` hits the documented pre-existing `std-env` crash — see ctrl:gate below).
- Final SHA: see final answer (this file must not contain its own SHA).

## Allowed paths touched (only)

- `packages/server/src/document-providers/write-policy.ts` — the T-007 write-policy source
  (the task names it `document-providers/google/write-policy.ts`; the `google/` subdir does not
  exist and the T-007 implementation lives at `document-providers/write-policy.ts`, which is
  the same named write-policy object). Added: `adminWriteAuthorized` (R-005 #3 "explicit
  administrator write authorization", folded into `resolvedWriteMode`, default `false` /
  fail-closed) and `resolveConfirmationAllowance` (R-005 #7 "applicable confirmation policy
  satisfied").
- `packages/server/src/routes/document-integrations.ts` — the Document API routes. Added:
  deployment-level feature gate `assertGoogleWriteDeploymentAvailable` (reuses the audited
  `capability_resolver_enforcement` flag; OQ-018 open, no new flag), confirmation gate
  `assertGoogleWriteConfirmationSatisfied` (`CONFIRMATION_REQUIRED` error code), and
  `confirmed` handling on create/mutate.
- `packages/app/src/components/settings/DocsSettings.tsx` — admin destination /
  write-mode / confirmation-policy surface (R-005/R-007, Phase E §14.5 "admin authorization
  UI"), staged/fail-closed (no invented defaults; persistence + flag host pending by
  T-007/OQ-018).
- `packages/server/src/document-objects.test.ts` — the F2 test-half carry (named path):
  pins that unproven lanes (`thumbnail`/`version_history`/`change_tracking`/`permission_read`/
  `export`) are never claimed `supported` by the unified Google mapping, and that `export` is
  included in the legacy `GOOGLE_V1_MUTATION_CAPABILITIES` read-only write vocabulary.
- `packages/server/src/document-providers/write-policy.test.ts` and
  `packages/server/src/routes/document-integrations.test.ts` — colocated test suites of the
  two named write-policy/routes SOURCE paths above (necessary extension of those named paths
  to satisfy one-negative-test-per-gate with TDD; no other test file was touched).
- `docs/plans/evidence/entity-document-integrations/T-013/EVIDENCE.md` (this file).

Not touched (rule-outs below): PRD, `document-objects.ts`, `packages/db/src/index.ts`, other
`document-providers/*` files, feature-flag framework files (`phase2-flags.ts`),
`receipt-writer.ts`, migrations, allowlists/gates, OpenWiki.

---

## Verbatim acceptance & authority quotes

### T-013 ticket block (PRD `### T-013` ~:3822, verbatim)

> **T-013 — Add Google admin write gate and destination UX**
>
> Goal/value: Make write authorization explicit.
>
> Dependencies: T-007, T-012.
>
> Scope:
>
> admin authorization;
>
> destination;
>
> write mode;
>
> confirmation policy;
>
> feature flag.
>
> Acceptance: R-005/R-007.
>
> Automated proof: one-negative-test-per-gate.
>
> Security: broad OAuth scope alone does not enable writes.

### R-005 — Explicit Google write gate (PRD ~:835, verbatim)

> **R-005 — Explicit Google write gate**
>
> Google mutation requires all of:
>
> deployment-level feature availability;
>
> valid Google connection;
>
> explicit administrator write authorization;
>
> required provider scopes;
>
> allowed destination;
>
> capability supported;
>
> applicable confirmation policy satisfied;
>
> non-stale revision for updates.
>
> Feature-flag names are implementation details and must follow the repository's actual flag
> convention after audit.
>
> Acceptance criteria
>
> Removing any one required gate prevents the write.
>
> Validation
>
> Table-driven negative tests covering each missing gate individually.

### R-007 — Google Shared Drive and destination support (PRD ~:907, verbatim)

> **R-007 — Google Shared Drive and destination support**
>
> Google creation/discovery must support destinations approved by policy, including designated
> Shared Drive destinations where the authenticated deployment is eligible.
>
> The implementation must not assume My Drive as the universal destination.
>
> Acceptance criteria
>
> Destination picker/configuration distinguishes approved destinations.
>
> Create request resolves one explicit destination.
>
> Unauthorized Shared Drive destination fails without fallback to another location.
>
> Validation
>
> Destination-policy integration tests.
>
> Sandbox proof against at least one supported destination configuration.

### Validation matrix rows (PRD traceability table ~:3560-3562, verbatim)

> R-005	Google write gate	table-driven gate tests
>
> R-007	Google destinations	destination tests

### Phase E §14.5 + §14.6 (PRD ~:2709-2729, verbatim)

> Enable Google write lane selectively. Only after: explicit feature flag; admin authorization
> UI; provider scopes reviewed; destination configured; write policies tested; negative write
> tests pass; sandbox proof passes.
>
> Disabling Google writes must immediately restore effective read-only behavior without
> requiring schema rollback.

### RK-007 risk row (PRD ~:4421, verbatim)

> RK-007	Provider auth model too broad	Medium	High	Least privilege + explicit admin write gate	Yes

---

## Implementation summary

### R-005 — explicit Google write gate (each gate enforced; any one missing prevents the write)

The write-policy model (T-007) is extended so that the gates that live in the policy are all
enforced through `resolvedWriteMode` / `resolveCreateAllowance` / `resolveMutationAllowance`,
and the two gates that live at the runtime/route boundary (feature availability + confirmation)
are enforced in the Document API routes. The route applies the full gate chain in order, and a
write is dispatched ONLY when every gate passes:

1. **deployment-level feature availability** — the audited `capability_resolver_enforcement`
   flag (`packages/server/src/phase2-flags.ts`, surface `document_capabilities`) is the master
   availability switch. When DISABLED, Google create/mutate is denied (typed `WRITE_DISABLED`),
   restoring read-only without schema rollback (§14.6). No new untracked flag is invented
   (OQ-018 open — see observations).
2. **valid Google connection / required provider scopes** — unchanged T-006 Capability Resolver
   fold (a degraded/unknown connection gates create via `CONFIRMATION`-independent
   `CAPABILITY_UNSUPPORTED`; the route never fabricates `authorized`). This task does not
   rewrite T-004..T-012 semantics.
3. **explicit administrator write authorization** — NEW `WritePolicy.adminWriteAuthorized`
   field (R-005 #3, RK-007). Folded into `resolvedWriteMode` so every decision (create/mutate)
   fails closed unless the policy is explicitly admin-authorized. Broad OAuth scope alone never
   enables writes.
4. **allowed destination** — unchanged T-007 `resolveDestinationAllowance` (R-007; explicit
   destination required, unapproved/wrong-scope denies with typed `DESTINATION_NOT_ALLOWED`,
   no fallback).
5. **capability supported** — unchanged T-006 resolver (create/mutation lane must be
   `supported`; `CAPABILITY_UNSUPPORTED` otherwise).
6. **applicable confirmation policy satisfied** — NEW `resolveConfirmationAllowance` +
   route gate. `confirmationPolicy === 'required'` demands an explicit `confirmed: true`
   (typed `CONFIRMATION_REQUIRED` otherwise); `null`/`auto_approve`/`not_required` need none.
   Fail-closed: a missing governing policy is denied.
7. **non-stale revision for updates** — unchanged T-009 Revision Coordinator (409
   `STALE_REVISION`).

### R-007 — destination support / admin destination UX

- **Create resolves ONE explicit destination** — the Document API already requires an explicit
  `destinationId` for a create (no destination → typed `WRITE_DISABLED`; unapproved/wrong-scope
  → `DESTINATION_NOT_ALLOWED`), and never falls back to another location (R-007). Existing
  behavior preserved; the wrong-scope-negative and create-no-destination tests remain green.
- **Destination picker/configuration distinguishes approved destinations** — implemented in
  the admin surface (`DocsSettings.tsx`): an approved-destination readout (kind + approved/
  disabled), an explicit admin-write-authorization toggle, a write-mode selector
  (`disabled`/`create_only`/`create_and_update`), and a confirmation-policy selector
  (`not_required`/`auto_approve`/`required`). The readout is fail-closed: no destination
  approved → "creation stays locked", and unapproved destinations are never made selectable.

### DocsSettings.tsx — admin write-gate surface

Staged, fail-closed configuration surface (R-005/R-007, §14.5 admin authorization UI). Because
the T-007 write-policy model is PURE and its persistence is deferred, and OQ-018 is open (no
audited Google-write flag yet), the surface is a readout + staged controls that does NOT claim
to be a live persistence/API write path and does NOT invent a PRD-open default (OQ-003
confirmation default, OQ-018 flag host are surfaced as pending decisions). The gate is
"armed" only when admin authorization ON + non-disabled write mode + ≥1 enabled approved
destination; otherwise "locked (fail closed)".

---

## Carry-forward dispositions (reviewer-assigned, from THE-953 approved receipts)

- **F2 test-half (low, reviewer-recommended) — LANDED HERE (GREEN pin, not RED→GREEN).**
  In `document-objects.test.ts` (named path), added "T-013 carry-forward F2 (THE-953):
  unproven read-like lanes and export are never claimed supported (capability honesty pin)":
  (1) `thumbnail`/`version_history`/`change_tracking`/`permission_read`/`export` are pinned
  `unsupported` (never `supported`) by the unified Google mapping, and
  (2) `export` is included in the legacy `GOOGLE_V1_MUTATION_CAPABILITIES` read-only
  write-vocabulary assertion (each of `create`/`update`/`write`/`export`/`sync` is `false`).
  This pins CURRENT CORRECT behavior — GREEN immediately, no implementation change.
- **F1 (open_external parity for revoked-auth/unavailable refs) — RULED OUT (out of path).**
  Requires editing `document-objects.ts` (the `openExternal` read-like fold at
  `document-objects.ts:719` depends on `meta.open_url`, and revoked-auth/unavailable handling
  lives in the mapping/`buildGoogleExternalDocumentMetadata` surface), which is NOT an allowed
  path for T-013. Carries to a later lane.
- **F2 guard-half (`assertGoogleUnifiedWritesDisabled` omits `export`) — RULED OUT
  (out of path).** Fixing `assertGoogleUnifiedWritesDisabled` to iterate `export` requires
  editing `document-objects.ts:756-769` (its `writeLanes` array builds from
  `FAIL_CLOSED_CAPABILITIES ∪ human_edit`), which is NOT an allowed path for T-013. Carries to
  a later lane.

These dispositions are also stated in the commit message body.

---

## TDD: RED → GREEN proof (per gate)

The new gates were authored test-first. For each gate, RED was demonstrated against the
base/not-yet-enforced implementation (a clean assertion failure showing the gate was fail-open
or absent), then enforced and confirmed GREEN. All runs use the working repo-root vitest under
Node 22. The F2 test-half is a GREEN pin (no RED).

### Gate: admin authorization (non-admin denied)

- `write-policy.test.ts` "NEGATIVE admin: a policy without explicit admin authorization
  resolves to disabled (non-admin denied)".
- RED (admin fold temporarily removed): `AssertionError: expected 'create_and_update' to be
  'disabled'` — a non-admin policy provably resolved write-capable, the fail-open bug R-005 #3
  fixes.
- GREEN (fold restored): `resolvedWriteMode` → `disabled`; create/mutate → `denied`.
- Route-level negative: `document-integrations.test.ts` "NEGATIVE admin: a non-admin write
  authorization denies a Google create" → `403 WRITE_DISABLED`.

### Gate: feature flag (flag-off denied)

- The audited flag is the master availability switch. Route negative tests:
  `document-integrations.test.ts` "NEGATIVE flag: audited deployment flag OFF denies a Google
  create" → `403 WRITE_DISABLED`, and the re-based "T-013 (R-005 #1): audited deployment flag
  disabled DENIES a Google mutation".
- RED (deployment gate temporarily removed): the flag-off negative create test failed (create
  reached 201 instead of 403 WRITE_DISABLED), showing the deployment gate was absent.
- GREEN: with the gate restored, flag-off → denied; the flag can never LIFT a write lane.

### Gate: destination (unapproved / wrong-scope denied)

- Existing T-007 negative tests continue to pass. T-013 route negative:
  `document-integrations.test.ts` "R-007: an unauthorized/wrong-scope destination fails without
  fallback" → `422 DESTINATION_NOT_ALLOWED`; and the pre-existing create-with-no-destination →
  `403 WRITE_DISABLED` (R-007 "create resolves one explicit destination") stays green. Denial
  was already correct at base — mapped as gate with RED already proven by the T-007 suite and
  reconfirmed here.

### Gate: write mode (wrong/disabled mode denied)

- Existing T-007 "write mode" negative tests stay green: `disabled` blocks create/mutate,
  `create_only` blocks update. No code change required — T-013 reuses the enforced
  `resolvedWriteMode`; the success-path only lifts when `create_and_update`.

### Gate: confirmation policy (not satisfied denied)

- `write-policy.test.ts` "NEGATIVE confirmation: a required confirmation policy that is NOT
  satisfied denies the write" + route negatives (create + update).
- RED (confirmation gate temporarily removed): the route confirmation-negative create/update
  tests failed (write reached the provider instead of `403 CONFIRMATION_REQUIRED`).
- GREEN: `resolveConfirmationAllowance`/route gate deny when required-but-unconfirmed; allow
  when satisfied (or not required).

### Success path (ALL gates pass)

- `write-policy.test.ts` "SUCCESS: a write that passes EVERY gate ... is allowed" and
  `document-integrations.test.ts` "SUCCESS: a Google create passes when EVERY gate is
  satisfied (flag on + admin + approved destination + create mode + confirmation satisfied)"
  → `201`.

### One-negative-test-per-gate mapping table

| Gate (R-005)                | Negative test (denial)                                                        | Result |
|-----------------------------|------------------------------------------------------------------------------|--------|
| admin authorization         | `write-policy.test.ts` "NEGATIVE admin" + routes "NEGATIVE admin"             | denied (`disabled` / `WRITE_DISABLED`) |
| feature flag (availability) | routes "NEGATIVE flag" + "audited deployment flag disabled DENIES mutation"   | `403 WRITE_DISABLED` |
| destination                 | routes "R-007" wrong-scope + existing T-007 unapproved/no-destination         | `422 DESTINATION_NOT_ALLOWED` / `403 WRITE_DISABLED` |
| write mode                  | existing T-007 `disabled`/`create_only` negative lanes (still green)          | `denied` |
| confirmation policy         | `write-policy.test.ts` "NEGATIVE confirmation" + routes create/update negatives | `403 CONFIRMATION_REQUIRED` |
| success (all gates)         | SUCCESS tests (write-policy + routes 201)                                     | allowed |

---

## Flag reversibility proof

- R-005/§14.6: the write gate is reversible through the audited feature-flag framework only.
  The route's `assertGoogleWriteDeploymentAvailable` reads the existing audited
  `capability_resolver_enforcement` flag (default enabled). Disabling it immediately turns
  Google create/mutate into typed `WRITE_DISABLED` (read-only restored) with NO schema
  rollback — proven by the two flag-off negative route tests.
- **No new untracked flag is invented.** OQ-018 ("Which current Entity feature-flag mechanism
  should host the write gates?") is open and there is no dedicated Google-write audited flag;
  per the task we reuse the existing audited `capability_resolver_enforcement` surface and
  record the observation (below). The flag can only ever DISABLE a Google write; it can never
  lift the admin/destination/write-mode/confirmation gates (those live in the pure write
  policy, enforced regardless of flag state).

---

## Verification (all required, Node 22)

### Focused suites (final HEAD)

```sh
<root>/node_modules/.bin/vitest run \
  packages/server/src/document-providers/write-policy.test.ts \
  packages/server/src/routes/document-integrations.test.ts \
  packages/server/src/document-objects.test.ts
```
Result: **exit 0** — `write-policy.test.ts` (43 tests, was 35), `document-integrations.test.ts`
(53 tests, was 47), `document-objects.test.ts` (38 tests, was 37) → **134 passed**.

Note: the documented server-workspace `npx vitest run` (i.e. `packages/server`) hits the
pre-existing `std-env` hoisting crash, so the working runner (repo-root vitest) is used, as in
T-012/T-011 evidence.

### Server strict build

```sh
cd packages/server && npm run build
```
Result: **exit 0** (strict tsc).

### Full server suite (final HEAD)

```sh
<root>/node_modules/.bin/vitest run packages/server/src
```
Result: **exit 0** — **211 test files passed, 1972 tests passed** (was 1957 at T-012; +15 new
T-013 tests: +8 write-policy, +6 routes incl. the re-based flag mutation test, +1
document-objects F2 pin).

### App build + tests

```sh
cd packages/app && npm run build   # exit 0 (strict tsc + vite build)
cd packages/app && npm test        # exit 0 — 493 passed, 0 fail
```
DocsSettings.tsx was touched, so the app build (strict tsc) and its existing test script
(`node --loader ts-node/esm --test`) both pass. **Observation: the app has NO
component/DOM-level test runner** (its `test` script is `node:test` over `lib/` pure-logic
suites; there is no jsdom/vitest component runner), so the DocsSettings UI is proven by the
strict tsc build + existing app suite; live browser capture is the manager-side fallback and
was not attempted (per task instruction).

### `npm run ctrl:gate`

```sh
npm run ctrl:gate
```
Result: **exit 1 AT THE KNOWN PRE-EXISTING CRASH** — the root build (app + db + server)
**passed**; `@entity/db` unit suite **(185 tests)** passed; `@entity/app` `node:test`
**(493 tests)** passed; then `@entity/server test` (`npx vitest run`) hit the SAME documented
pre-existing `std-env` hoisting crash reproduced verbatim:

```
file:///.../packages/server/node_modules/vitest/dist/chunks/cac.DRKYQDPl.js:8
import { isAgent } from 'std-env';
         ^^^^^^^
SyntaxError: The requested module 'std-env' does not provide an export named 'isAgent'
```

This is a dual-major `std-env` hoisting conflict in this checkout's
`packages/server/node_modules/vitest`, reproducible for ANY task and unrelated to this diff.
The substantive gate content passes under the working repo-root runner equivalents that were
actually run: the full server suite (211 files / 1972 tests), the app build + app suite
(493), and the db suite (185). Per the task, the root-runner equivalents are relied on.

### Additional checks

- `git diff --check` — **exit 0** (no whitespace/EOF errors).
- Worktree: clean after commit (see final answer).

---

## Security / privacy

- **Broad OAuth scope alone never enables writes:** the admin gate (`adminWriteAuthorized`) is
  independent of scopes and defaults false; the existing R-003 "read-only connection is not
  write-promotable" test remains green. The route never fabricates `connection:'authorized'`.
- **Every gate fails closed:** removing any one of the five named gates denies the write
  (one-negative-test-per-gate table above). The audited flag-off and adapter fail-closed paths
  are both covered.
- **No credentials, raw tokens, tenant secrets, document contents, or operator-specific
  absolute paths** in code, fixtures, tests, or this evidence — all synthetic (`ws_A`,
  `tenant_A`, `dest_1`, `dest_allowed`, `op-*`, `t013-*`) deterministic test data, no real
  Google identity.
- **Capability honesty / fail-closed:** unknown/degraded capability or authority never lifts a
  write lane; the F2 pin confirms unproven lanes are never claimed supported. Workspace/tenant
  isolation preserved (T-007 policy scoping unchanged).

---

## Rule-outs

- **PRD is read-only authority.** `docs/loom/entity-document-integrations/
  phase2-canonical-prd.md` was NOT edited. The known open item — authority pin `83cacbc…` vs
  in-tree PRD hash `c82e82d…` — is pending Henry's decision and is not part of this ticket.
  In-tree PRD content used as read-only authority.
- **`document-objects.ts` (T-012 unified Google mapping) is OUT of scope.** T-013 does not
  edit it. The F1 and F2-guard-half carry-forwards would require editing
  `document-objects.ts:719` (openExternal fold) and `document-objects.ts:756-769`
  (assertGoogleUnifiedWritesDisabled write-vocabulary) respectively — both OUT of allowed
  paths, carried to a later lane (see Carry-forward above).
- **`packages/db/src/index.ts` (and all db/migrations), other `document-providers/*` files,
  feature-flag framework files (`phase2-flags.ts`), `receipt-writer.ts`, allowlists/gates, and
  the event/permissions/middleware surfaces are OUT of scope** and were not edited.
- **No receipt wiring (R-027/R-028).** Per the known open item owned by T-014+, receipt wiring
  stays exactly as-is (routes still emit `receiptId: null`); T-013 does not touch receipts.
- **No competing API namespace, provider registry, receipt store, or event table** was
  introduced; the Document API router and write-policy module were extended, not replaced.
- **No new untracked feature flag** was invented (see Flag reversibility proof). OQ-018 open;
  the existing audited `capability_resolver_enforcement` flag is reused.
- **Test-file extension of the two named source paths.** `write-policy.test.ts` and
  `document-integrations.test.ts` are the colocated test suites of the named
  write-policy/routes SOURCE paths (the only way to satisfy one-negative-test-per-gate with
  TDD); no other test file was touched. `document-objects.test.ts` is separately a named
  allowed path.

---

## Unresolved risk / observations (no invented defaults)

- **OQ-018 is open: no dedicated audited Google-write feature flag exists.** This task reuses
  the existing audited `capability_resolver_enforcement` flag (surface `document_capabilities`)
  as the deployment-level availability/master-switch for the Google write gate (14.6
  rollback). It does not invent a new flag. When OQ-018 resolves, a dedicated audited flag
  should replace this reuse with an equivalent fail-closed gate.
- **OQ-003 is open: confirmation-policy default is not settled.** This task enforces
  `confirmationPolicy === 'required'` only when explicitly configured; `null`/`auto_approve`/
  `not_required` require no confirmation. No default is invented.
- **T-007 persistence boundary stands.** The write-policy/destination model is pure and its
  persistence is deferred, so the DocsSettings admin surface is a staged readout + local
  configuration (explicitly not a live persistence/API write path). Persistence wiring to the
  model is deferred to a later lane.
- **App has no component/DOM-level test runner** (only `node:test` pure-logic suites), so the
  DocsSettings UI is proven by the strict tsc build + app suite; live browser capture is a
  manager-side fallback, not attempted here.
- **Test 934 semantic evolution (disclosed).** The approved T-008 test "gap 2: capability-
  resolver disabled (rollback) still fails closed via the adapter (CAPABILITY_UNSUPPORTED)"
  was intentionally re-based to the T-013 master-switch semantics: with the audited flag OFF,
  a Google mutation is now denied at the route (`403 WRITE_DISABLED`) as the deployment
  kill-switch (14.6), rather than failing via the adapter. Its setup (which created a document
  under flag-off) was changed to seed the adapter+registry directly. Its core intent — a
  flag-off write is denied / never dispatched — is preserved and its assertion strengthened to
  prove the master gate denies. This is the one approved-base test the new deployment gate
  supersedes; disclosed here and in the commit message.
