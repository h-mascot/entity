# Entity Document Integrations — Architecture / Correctness Review (Codex-equivalent audit)

**Reviewer:** T-037 independent audit worker (Citadel `daystrom/deepseek`)
**Immutable base HEAD:** `5a342b240f83fded42a5fe2ec1449922364a0a4d`
**Range audited:** `e7d026010810d34421c13158f61323b67ee2ed0b..5a342b240f83fded42a5fe2ec1449922364a0a4d`
**Companion artifact:** `entity-document-integrations-thermo-nuclear.md` (adversarial security)

This is the architecture/correctness deliverable of T-037. It audits the accumulated Entity
Document Integrations feature **through T-036** for the exact accepted range above. It does NOT
audit superseded/unmerged T-027 attempts or any branch other than the accepted immutable range.

## Scope of the audited range

The accepted range is four commits adding 2,602 insertions across 11 files:

| Commit | Summary | Primary production surface |
|---|---|---|
| `665d4ec` | feat(agent): add provider-neutral document tools (T-032) | `packages/server/src/agent/tools.ts` (+675) |
| `3b2bd28` | feat(document-integrations): add observability redaction proof (T-035) | `packages/server/src/phase2-observability.ts` (+235), `agent/log.ts` (+36), `scripts/scan-private-defaults.mjs` |
| `70a2817` | test(document-providers): add cross-provider acceptance matrix (T-036) | `packages/server/src/document-providers/e2e.test.ts` (+654) |
| `5a342b2` | fix(document-providers): make matrix proof dispositions truthful | `e2e.test.ts` (matrix-ledger honesty) |

Plus colocated tests (`tools.test.ts` +436, `phase2-observability.test.ts` +144,
`log.test.ts` +42) and evidence (`T-032/EVIDENCE.md`, `T-035/EVIDENCE.md`, `T-036/EVIDENCE.md`).

## Produced acceptance-axis disposition

### A1 — Auth / tenant / workspace isolation : PASS (no blocker)

`createDocumentAgentTools` never trusts a caller-supplied provider string for authority
(`tools.ts:876-883` ff.). Every read/mutate resolves the canonical record via
`deps.registry.get(input.documentId, workspaceId)` (`tools.ts:1031`, `1123`), and the registry
enforces workspace scope on every `get`/`create`/`update`/`findByProviderIdentity` with atomic
`BEGIN IMMEDIATE` transactions and a post-write ownership assertion (`registry.ts:209-216`,
`264`, `296-298`, `328-335`).

Provider mismatch on mutation fails closed (`tools.ts:1142-1146`): a caller-supplied `provider`
that disagrees with the trusted registry record returns `denied`. Missing workspace returns
`denied` with a fail-closed warning (`tools.ts:790-804`). Unknown document → `not_found`.

Enablement is consolidated across five independent gates before any dispatch
(`tools.ts:884-933`, `1153-1198`): audited write-gate flag, R-003 write policy + approved
destination, R-005 confirmation, T-006 capability resolver, workspace scope. No competing
registry/receipt store/event table/API namespace is introduced (matches `BUILD-CONTEXT.md`
delivery boundary).

### A2 — Stale writes / idempotency / conflict handling : PASS (no blocker)

Mutation lanes enforce the R-024/R-025 Revision Coordinator precondition BEFORE the adapter
write via `preflightMutation` (`tools.ts:1201-1208`), which reads the authoritative current
revision and throws `UnsafeMutationError` (no concurrency evidence → fail closed) or
`StaleRevisionError` (stale expected revision). The tool maps stale → typed `conflict` with
NO blind retry (`tools.ts:1241-1249`). The adapter re-checks revision atomically as a second
line of defense (`revision-coordinator.ts:188-204`).

Create idempotency (R-026): a replayed create that the provider reports as
`created===false` reconciles to the existing canonical record via
`registry.findByProviderIdentity` (`tools.ts:942-969`); a registry identity conflict is typed
(`DocumentRegistryIdentityConflictError`, `tools.ts:996-999`).

Nonblocking followup N1 (below) records that creation idempotency relies on provider-transport
idempotency + registry identity uniqueness rather than an Entity-side operation-scoped store —
a recognized scope limitation note in `BUILD-CONTEXT.md` and the T-032 evidence, not a
defect introduced here.

### A3 — Local bridge and managed-storage security : PASS for changed range (no blocker)

No bridge/managed-storage production code is IN this accepted range (local bridge is T-026,
managed storage T-027, both pre-existing base code). The only interaction is the T-036 matrix,
which asserts `LocalBridgeSecurity` fails closed on handshake/authorize when readiness != ready
(`e2e.test.ts:576-609`), executed and passing 43/43 in this review. The new agent tools treat a
`local_office` provider exactly like any other via the adapter/capability contract; the local
create/preview/search cells are honestly deferred (see A6/N4).

### A4 — Secret / private-default handling : PASS (no blocker)

`phase2-observability.ts` provides value-level redaction (`redactSensitiveText`,
`buildProviderTelemetryEvent`, `buildPhase2DiagnosticLogEvent`) and `agent/log.ts` emits only
structured, allow-listed, non-sensitive telemetry (`[document-integrations:obs]`,
`[document-integrations:classify]`). `scripts/scan-private-defaults.mjs` adds four real-credential
error guards. Independent review probes (below) confirmed embedded tokens, whole-value operator
paths, and revision-token values never reach the telemetry surface. See adversarial companion
for the defense-in-depth note (N2). This is a hard PASS on the changed code.

### A5 — Additive migrations and rollback / data safety : PASS (no blocker)

No migration/schema change is in this range. The new modules compose the existing additive
T-003/T-004 unified tables with no competing table/namespace. Rollout/rollback stays gated by
the audited `capability_resolver_enforcement` Phase 2 flag (`tools.ts:885`, `1154`), consistent
with the PRD 14.6 reversible write gate. No data-loss path was found.

### A6 — Provider-capability honesty and fail-closed behavior : PASS (no blocker)

The T-036 §20 cross-provider matrix (`e2e.test.ts` `SECTION_20_MATRIX`) is data-driven and
machine-enforced: every cell is `automated` (real seam suite) or an explicit manual/deferred
disposition, and the ledger test rejects empty/fabricated proof (`e2e.test.ts:390-411`). The
final commit `5a342b2` extends that check to forbid past-tense executed-manual claims
(`verified manually`, `exercised on`, `verified against`, …), so UNEXECUTED manual cells must
be stated truthfully. Microsoft's three mutation lanes are asserted `microsoftMutationAllowed
=== false` and capability state never `supported` (`e2e.test.ts:519-520`) — honest denial, no
fabricated parity. Individual capability/unsupported/degraded lanes fold writes fail-closed
(`tools.ts:930-932`, `1194-1197`, `1051-1052`). PASS with honest deferred cells recorded as
N4.

## Verification performed (this run)

All under Node v22.22.2 (nvm) with a fresh `npm ci` (1758 packages) and a working
`better-sqlite3` native binding.

- `npx vitest run src/phase2-observability.test.ts src/agent/log.test.ts` — **20/20 pass**
- `npx vitest run src/agent/tools.test.ts src/document-providers/e2e.test.ts` — **56/56 pass**
- `npx vitest run src/document-providers/write-policy.test.ts src/document-providers/registry.test.ts src/document-providers/revision-coordinator.test.ts src/document-providers/capability-resolver.test.ts src/document-providers/contract.test.ts` — **152/152 pass**
- Independent 8-case redaction/classification edge probe (temporary, removed after execution) — **8/8 pass**
- Server typecheck: `npx tsc -p tsconfig.json` — **exit 0**
- `git diff --check` over the accepted range — **clean (exit 0)**
- `node scripts/scan-private-defaults.mjs --enforce` — **errors=0, warnings=242 (benign identifiers)**

## Nonblocking follow-ups (correctness)

- **N1 (A2)** — Creation idempotency has no Entity-side operation-scoped store; it depends on
  provider-transport idempotency and the global registry identity uniqueness. `receiptId` is
  intentionally `null` and operation correlation rides `operationId`. This is a documented
  scope gap (BUILD-CONTEXT), not a regression; follow-up if a multi-adapter create race must
  converge without a provider round-trip.
- **N4 (A6)** — The §20 cells for live Google search/associations, M365 human-edit/open,
  and local create/preview/search/version-UI are honestly marked UNEXECUTED/maintenance-deferred
  and must be proven by T-039 live-sandbox verification before release promotion.

## Integrity / honesty statements

- Canonical PRD, `.project-gate.json`, and root/`docs/loom` `AGENTS.md` were treated as
  read-only; no scope-expansion edit was required.
- Final exact SHA belongs in the immutable external supervisor receipt, not self-referential
  text here.
- No live auth/desktop proof was claimed — none was executed.

**Zero unresolved release-blocking findings in this architecture/correctness audit.**
