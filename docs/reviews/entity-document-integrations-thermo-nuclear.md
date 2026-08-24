# Entity Document Integrations — Adversarial Security Review (Thermo-nuclear)

**Reviewer:** T-037 independent audit worker (Citadel `daystrom/deepseek`)
**Immutable base HEAD:** `5a342b240f83fded42a5fe2ec1449922364a0a4d`
**Range audited:** `e7d026010810d34421c13158f61323b67ee2ed0b..5a342b240f83fded42a5fe2ec1449922364a0a4d`
**Companion artifact:** `entity-document-integrations-codex.md` (architecture/correctness)

This is the adversarial security deliverable of T-037, emphasizing authority boundaries,
tenant isolation, local filesystem/bridge attack surface, secrets/logs, migrations, stale-write
and idempotency races, and capability fail-closed behavior. Findings are classified under
Runner Lean thresholds: a BLOCKER requires material correctness/security/data-loss/destructive/
explicit-acceptance failure with a reproducible focused proof or exact code path.

## Summary

**BLOCKERS: 0.** **NONBLOCKING_FOLLOWUP: 3 (N2, N3, N4).** **Zero unresolved release-blocking
findings.**

## Authority-boundary review (caller can never escalate)

The new `createDocumentAgentTools` orchestrator (`packages/server/src/agent/tools.ts:761-1253`)
is the whole new write surface. Its threat model: a caller may supply provider string, target id,
expected revision, idempotency key, and optional association/confirmation toggles. Verified
fail-closed properties:

- **Provider string never confers authority.** `create` uses `input.provider` only to select the
  transport adapter (`tools.ts:879`); enablement still requires write-gate flag + R-003 policy +
  destination + confirmation + capability + workspace. On `revise/range/slide`, a caller provider
  that does not EQUAL the trusted registry record returns `denied` (`tools.ts:1142-1146`). A
  caller cannot redirect a write to another lane/provider.
- **Document target is workspace-scoped.** `read`/`mutateLane` fetch via
  `registry.get(input.documentId, workspaceId)`; a foreign-workspace id returns `not_found`
  (`tools.ts:1032`, `1123-1130`). Registry enforces scope atomically (`registry.ts:308-336`) with
  an isolation error for cross-workspace identity and a post-write ownership assertion.
- **No second receipt/registry/store/event table.** Confirmed against the only-in-range
  additions; matches the delivery boundary.

## Tenant / workspace isolation

The global R-001 provider-identity uniqueness is enforced defensively in the registry: a
registration/rediscover/create whose `(provider_connection_id, external_id)` already maps to a
record in a DIFFERENT workspace throws `DocumentRegistryIsolationError` (fail closed, no read/
mutate) inside one `BEGIN IMMEDIATE` transaction (`registry.ts:218-267`, `278-300`), and the
conflict type never reveals which workspace owns an identity (`registry.ts:85-97`) — not an
existence oracle. No cross-tenant read/write path found in the range. Fails-closed on missing
workspace (`tools.ts:790-804`).

## Local filesystem / bridge attack surface

No bridge/managed-storage production code is in this range (pre-existing T-026/T-027 base).
Interaction is limited to the T-036 matrix, which asserts `LocalBridgeSecurity` rejects
handshake/authorize when readiness != ready (`e2e.test.ts:576-609`, executed and passing).
The new tools treat `local_office` via the same adapter/capability contract; there is no new
path by which a caller string selects a local file, and no new filesystem read/write primitive
was added. The agent `validateArtifactReference`/`resolveOutputPath` logic in the pre-existing
task-tool portion of `tools.ts` constrains reviewable paths to workspace/docs roots
(`tools.ts:404-421`), unchanged from base.

## Secrets / logs / private defaults

- `phase2-observability.ts` redaction: `redactSensitiveText` collapses values matching the
  sensitive-key pattern (`secret|token|api[-_]?key|authorization|password|credential|content|
  snippet|body|raw|metadata`) or an operator absolute path to `redacted`, and scrubs
  revision/etag/change-token/versionid values (`phase2-observability.ts:118-129`, `217-229`).
- `agent/log.ts` emits only structured allow-listed landmarks via `console.info` JSON
  (`[document-integrations:obs]`, `[document-integrations:classify]`) — no raw provider text.
  `getAgentStatus` returns only booleans/source-enum for apiKey (`agent/log.ts:47-58`), never the
  key value.
- `scripts/scan-private-defaults.mjs` adds four error-severity real-credential guards
  (`ya29.`, `gh[pousr]_`, JWT, raw `access_token|refresh_token|client_secret` assignment),
  verified not to fire on the repo's intentional placeholder fixtures. Run: **errors=0**.
- Independent adversarial probe (8 cases, executed then removed): embedded
  `access_token=ya29...` in a longer operation string, whole-value operator path, revision-token
  value in free text, and telemetry operator-path leakage all redacted to the marker; conflicting
  fault signals resolve to the non-retryable class; unknown/transient-exhausted never retry.
  **8/8 pass.**

**N2 (NONBLOCKING_FOLLOWUP, A4 defense-in-depth):** `redactSensitiveText` treats the operator-path
allowlist (`/Users/enterprise`, `/home/henrymascot`, `/home/jamify`) and the sensitive-key pattern
as whole-value-or-embedded-key matches; a bare absolute path NOT in that allowlist (e.g.
`/tmp/userdata`) that also contains no sensitive key would pass through value-truncated at 160
chars. The telemetry/operation fields are design-intent allow-listed bounded landmarks and R-031
targets operator-specific paths, so this is not a live leak, but a broader path-collapse would
harden it. No blocker.

## Migrations / rollback / data safety

No migration is in the range. New modules compose the existing additive T-003/T-004 tables; no
competing schema. Rollout stays behind the audited `capability_resolver_enforcement` flag,
so revert is reversible (`tools.ts:885`, `1154`). No delete/destructive/data-loss path found.

## Stale-write and idempotency races

- **Mutation (R-024/R-025):** precondition enforced by `preflightMutation` before the adapter
  write (`tools.ts:1201-1208`), with the adapter re-checking the revision atomically. Stale →
  typed `conflict`, no blind retry (`tools.ts:1241-1243`). Verified stale-rejection across
  tools/e2e/revision-coordinator suites (passed).
- **Create (R-026):** provider reports `created===false` on replay → reconcile to existing
  canonical record (`tools.ts:942-969`); registry identity conflict is typed. A same-window
  concurrent duplicate create can surface a benign transient `conflict`/reconcile, never
  duplicate canonical identity. **N1** (architecture companion) documents the absence of an
  Entity-side operation-scoped idempotency store — a recognized, non-regressing scope limit.
- **N3 (NONBLOCKING_FOLLOWUP, A2):** in `mutateLane` the canonical record is read once
  (`tools.ts:1123`) and its `current_revision` is then overwritten unconditionally after a
  successful `adapter.mutate` (`tools.ts:1218-1221`). Because the adapter re-checks the revision
  atomically (rejecting a stale-write before this update runs), the last genuinely-accepted
  mutation's revision wins and the registry stays consistent; a mid-flight registry read is not
  itself a contradiction. Worth a follow-up concurrency test that two mutations against the same
  base revision serialize to only one accepted write. Not a blocker.

## Capability fail-closed behavior

- Unknown/degraded/unsupported capability → `unsupported`; missing authority → `denied`; unsafe
  payload / no concurrency evidence → `unsupported`; unknown document → `not_found`; disabled
  gate → `denied` (`tools.ts` throughout).
- `classifyProviderFault` never retries conflict/auth/unsupported/invalid/unknown; only proven
  transient with budget remaining is retried, Retry-After bounded at 60s
  (`phase2-observability.ts:272-319`). Confirmed by tests and probe.

## Provider-capability honesty (A6)

The matrix ledger (`e2e.test.ts`) rejects empty/fabricated automated proof and, after `5a342b2`,
rejects any past-tense executed-manual claim (`verified manually`/`exercised on`/…) in a
manual/deferred cell. Microsoft mutation lanes are capability-honest `unsupported`
(`microsoftMutationAllowed===false`, state never `supported`; `e2e.test.ts:519-520,647`).
**N4 (NONBLOCKING_FOLLOWUP, A6):** several §20 cells remain UNEXECUTED/maintenance-deferred
(live M365 edit/open + OneDrive/SharePoint search; Google Drive discovery beyond discover/
reconcile; local create/preview/search/version-UI). These are honest and must be proven by
T-039 live-sandbox verification before approval gate. Not a blocker — no fabricated parity is
claimed.

## Verification executed (Node v22.22.2)

- `npx vitest run src/phase2-observability.test.ts src/agent/log.test.ts` — **20/20**
- `npx vitest run src/agent/tools.test.ts src/document-providers/e2e.test.ts` — **56/56**
- composed primitives (`write-policy`, `registry`, `revision-coordinator`, `capability-resolver`,
  `contract`) — **152/152**
- independent redaction/classification probe — **8/8** (removed after execution)
- `npx tsc -p tsconfig.json` — **exit 0**
- `git diff --check` — **clean**
- `node scripts/scan-private-defaults.mjs --enforce` — **errors=0**

## Honesty statement

No live auth/desktop proof was claimed or executed. Exact final SHA is recorded in the immutable
external supervisor receipt. **Zero unresolved release-blocking security findings.**
