# T-035 — Add observability and redaction proof — Evidence

Ticket: Linear THE-976 / T-035 — Entity Document Integrations, P-06 Observability and
cross-provider QA.
Base HEAD: `665d4ec3d3b5ea7519adc7e28b7afa07021a33f6` (immutable).
Scope: R-031 (secrets/credentials), R-033 (rate limiting / provider resilience — retry
classification), R-038 (telemetry and diagnostics) — the **shared observability, redaction,
and fault-classification seam** this ticket owns. No provider transports, no competing
registry/store/event table/UI, and no unrelated adapter behavior were added.

## Scope (primary ticket paths touched)

- `packages/server/src/phase2-observability.ts` — added the provider-neutral observability,
  redaction, and retry-classification seam: `redactSensitiveText`, `buildProviderTelemetryEvent`
  (R-038), and `classifyProviderFault` (R-033), composing the canonical R-001
  `DocumentProvider`/`DocumentArtifactType` vocabulary via type-only import
  (`../../../db/src/document-integrations`) with no competing namespace.
- `packages/server/src/phase2-observability.test.ts` — RED-before-GREEN sanitized-log and
  fault-classification tests.
- `packages/server/src/agent/log.ts` — threaded the shared seam into the agent logging seam as
  `writeBridgeReadinessTelemetry` (R-038 bridge readiness) and `traceClassifiedProviderFault`
  (R-033), emitting structured, redacted telemetry only.
- `packages/server/src/agent/log.test.ts` — new colocated test for the two agent-log seams.
- `scripts/scan-private-defaults.mjs` — added repository secret/credential leakage guards
  (real credential shapes only, never the placeholder fixtures).
- `docs/plans/evidence/entity-document-integrations/T-035/EVIDENCE.md` — this file
  (issue-required same-scope expansion).

The canonical PRD was not modified. No competing API namespace, store, registry, event table,
UI, deployment, or unrelated refactor was introduced.

## Contract delivered

### R-031 / R-038 sanitized telemetry (`buildProviderTelemetryEvent`)
Structured, allow-listed, non-sensitive dimensions: provider, artifact_type, operation,
outcome (success/failure), latency_ms, retry_count, retry_after_ms, and boolean flags for
conflict, auth_failure, throttled, preview_failure, indexing_failure, bridge_ready, plus
reconciliation_lag_ms where evidence exists. Free-form text is never a valid dimension, and
every emitted string passes through `redactSensitiveText`, which redacts secrets/tokens,
`revision`/`etag`/`change token` values (unsafe revision tokens), operator-specific absolute
paths (`/Users/enterprise`, `/home/henrymascot`, `/home/jamify`), and the existing
sensitive-key marker set.

### R-033 retry classification (`classifyProviderFault`)
Deterministic classifier over a normalized fault signal plus HTTP status. Stale revision →
`conflict`, authorization denial → `auth`, unsupported capability → `unsupported`, invalid
request → `invalid` — NONE are ever retried (R-033 explicit non-retryables). Throttling/quota
and transport faults (5xx/timeout/network) → `transient` retryable, with `Retry-After`
honored (bounded at 60s). Retry budget is bounded (`DEFAULT_MAX_RETRIES = 3`); once exhausted,
even a transient fault stops retrying. Unproven faults → `unknown`, never retried (fail-closed).

### Secrets/credentials (`scripts/scan-private-defaults.mjs`)
Added `google-oauth-token` (`ya29.`), `github-personal-token` (`gh[pousr]_`), `jwt-credential`,
and `raw-credential-assignment` (access/refresh/client-secret) error-severity guards. Verified
to match real credential shapes and not to match the repository's intentional placeholder
fixtures (`abcdefghijklmnopqrstuvwxyz01234567`), so `--enforce` stays green.

## Proof (Node 22, `packages/server`, Vitest)

Environment note: the checked-in shared `node_modules` is a symlink whose `better-sqlite3`
native binding is unbuilt. To run the DB-backed `agent/log.ts` module (which opens the agent
log repository at import), the Node 22.22.2-compiled binding was reused into workspace-local,
git-ignored `packages/server/node_modules/better-sqlite3` and `packages/db/node_modules/
better-sqlite3` (test-infrastructure adaptation, no git-tracked source changed). `better-sqlite3`
was verified resolving and opening `:memory:` with `node -e`.

RED-before-GREEN: `phase2-observability.test.ts` new T-035 blocks were written first; the new
imports (`buildProviderTelemetryEvent`, `classifyProviderFault`) did not exist, so the run
reported `14 failed | 4 passed (18)`. After implementation the file passes.

### T-035 sanitized log + fault classification tests
```text
npx vitest run src/phase2-observability.test.ts
✓ src/phase2-observability.test.ts (18 tests)              # 4 base + 14 new T-035
Tests  18 passed (18)
```
Covers: secrets/tokens/document-content/absolute-path redaction never leaking into telemetry;
structured non-sensitive dimensions preserved; preview/indexing failure and bridge
readiness/reconciliation-lag dimensions; retry-count and Retry-After telemetry; transient vs
conflict/auth/unsupported/invalid classification; HTTP-status mapping; bounded-retry
exhaustion; and fail-closed `unknown`.

### agent/log seam tests
```text
npx vitest run src/agent/log.test.ts
✓ src/agent/log.test.ts (2 tests)
Tests  2 passed (2)
```

### Relevant existing observability / agent / provider tests
```text
npx vitest run src/phase2-observability.test.ts src/agent/log.test.ts \
  src/doc-hub-telemetry.test.ts \
  src/document-providers/contract.test.ts src/document-providers/registry.test.ts \
  src/document-providers/revision-coordinator.test.ts \
  src/document-providers/write-policy.test.ts \
  src/document-providers/capability-resolver.test.ts src/agent/tools.test.ts
Test Files  8 passed; Tests  192 passed (192)     # observable + provider subset
```
Broader run of `src/document-providers/ src/agent/tools.test.ts src/agent/log.test.ts
src/phase2-observability.test.ts src/doc-hub-telemetry.test.ts`: `28 passed / 29 files; 679
passed / 682 tests`. The only 3 failures are in `local/managed-storage.test.ts`, which spawns
the native `managed-storage-broker` binary (`native/managed-storage-broker/.build/broker`
ENOENT) — a pre-existing environmental gap (uncompiled native broker in this isolated worktree)
unrelated to this ticket's changed files.

### Server build / typecheck (strict)
```text
cd packages/server && npx tsc -p tsconfig.json    # exit 0, no errors
```

### Repository private-default scan
```text
node scripts/scan-private-defaults.mjs --enforce
[scan:private-defaults] scanned 940 files; findings=242; errors=0; warnings=242
```
The 4 new secret-pattern guards added 0 findings (no real credentials present) and were
separately unit-verified to fire on real credential shapes (`ya29.`, `ghp_`, JWT,
`client_secret = "…"`) and not on the placeholder convention. `git diff --check` is clean.

## Limitations

- The fault classifier is a **shared seam**, not wired into any provider transport: adapters
  remain auth/rewrite/resilience owners (their tickets). Calling adapters will feed normalized
  signals (`isStaleRevision`, `isAuthDenial`, … or `httpStatus`) into `classifyProviderFault`.
- `managed-storage.test.ts` (3 tests) cannot run here because the native
  `managed-storage-broker` binary is not compiled in this isolated worktree (ENOENT). This is
  pre-existing and out of this ticket's scope; the affected tests do not import this ticket's
  code.
- Telemetry is emitted via `console.info` structured JSON in `agent/log.ts` (matching the
  module's existing `console.error` style); no new log store/event table was added.

Final commit SHA is recorded in the external receipt, not self-referentially in this file.
