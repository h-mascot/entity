# T-037 — Independent Architecture & Security Review (Entity Document Integrations)

**Status:** COMPLETE — zero unresolved release blockers
**Runner:** T-037 Runner Local / Citadel `daystrom/deepseek` (sole audit worker)
**Range audited:** `e7d026010810d34421c13158f61323b67ee2ed0b..5a342b240f83fded42a5fe2ec1449922364a0a4d`
**Immutable base HEAD:** `5a342b240f83fded42a5fe2ec1449922364a0a4d`

## Acceptance Axes — final disposition

Each finding classified BLOCKING or NONBLOCKING_FOLLOWUP and mapped to an axis.

- [x] A1 Auth / tenant / workspace isolation — **PASS (0 blockers)** — workspace-scoped registry,
      provider-mismatch fail-closed, multi-gate enablement.
- [x] A2 Stale writes / idempotency / conflict handling — **PASS (0 blockers)** — R-024/25
      precondition before write, typed conflict no blind retry; R-026 create reconcile.
      NONBLOCKING N1, N3.
- [x] A3 Local bridge and managed-storage security — **PASS for changed range (0 blockers)** —
      no bridge code in range; matrix asserts capability-honest `LocalBridgeSecurity` non-ready
      gate.
- [x] A4 Secret / private-default handling — **PASS (0 blockers)** — value-level redaction,
      structured telemetry, 4 error-severity scan guards. NONBLOCKING N2 (defense-in-depth).
- [x] A5 Additive migrations and rollback / data safety — **PASS (0 blockers)** — no migration in
      range; composes additive T-003/4 tables; flag-gated reversible write gate.
- [x] A6 Provider-capability honesty and fail-closed behavior — **PASS (0 blockers)** — matrix
      ledger rejects empty/fabricated and past-tense-manual proof; MS mutations capability-honest
      unsupported. NONBLOCKING N4 (deferred §20 cells → T-039).

## Deliverables
- Architecture/correctness: `docs/reviews/entity-document-integrations-codex.md`
- Adversarial security: `docs/reviews/entity-document-integrations-thermo-nuclear.md`
- This evidence log (commands, results, dispositions).

## Findings register
- **BLOCKING: 0.**
- **NONBLOCKING_FOLLOWUP:**
  - **N1 (A2)** — no Entity-side operation-scoped create-idempotency store; depends on
    provider idempotency + registry identity uniqueness (documented BUILD-CONTEXT scope gap).
  - **N2 (A4)** — `redactSensitiveText` operator-path allowlist + sensitive-key are whole-value/
    embedded-key matched; a bare non-allowlisted absolute path with no sensitive key passes
    value-truncated (defense-in-depth, not a live leak).
  - **N3 (A2)** — `mutateLane` overwrites registry `current_revision` after accepted adapter
    mutate; consistent because adapter re-checks revision atomically; add a two-mutations-one-accept
    concurrency test as follow-up.
  - **N4 (A6)** — live M365/Google/local surfaced §20 cells are UNEXECUTED/maintenance-deferred
    and must be proven by T-039 live-sandbox verification before approval.

## Working log (commands executed, Node v22.22.2 via nvm)

Environment: fresh `npm ci` (1758 packages), better-sqlite3 verified loading (`node -e` open
`:memory:`, exit 0). All server commands from `packages/server`.

- `npx vitest run src/phase2-observability.test.ts src/agent/log.test.ts` → **20/20 pass**
  (T-035 redaction/classification + agent logging seams; emitted structured telemetry showed
  `reasonCode:"provider_fault"`, no raw tokens).
- `npx vitest run src/agent/tools.test.ts src/document-providers/e2e.test.ts` → **56/56 pass**
  (T-032 cross-provider agent tools 13/13; T-036 §20 matrix 43/43 incl. ledger-honesty and
  Microsoft capability-honest denial).
- `npx vitest run src/document-providers/write-policy.test.ts src/document-providers/registry.test.ts src/document-providers/revision-coordinator.test.ts src/document-providers/capability-resolver.test.ts src/document-providers/contract.test.ts` → **152/152 pass** (composed seams the tools depend on).
- Independent adversarial redaction/classification edge probe (temporary file,
  `phase2-observability.TEMP-PROBE.test.ts`) → **8/8 pass** (embedded token, whole-value operator
  path, revision-token value, operator-path telemetry, conflicting signals, budget-exhaustion,
  unknown). Probe removed after execution.
- `npx tsc -p tsconfig.json` (server strict typecheck) → **exit 0**.
- `git diff --check` over accepted range → **clean (exit 0)**.
- `node scripts/scan-private-defaults.mjs --enforce` → **scanned 941 files; errors=0;
  warnings=242 (benign identifiers; no real credentials).**

## Limitations
- Did NOT run the full server suite (T-038 owns exact-SHA CI), per ticket scope. Focused
  highest-risk seams proven above.
- No live auth/desktop proof executed; none claimed. Live §20 cells remain honest
  UNEXECUTED/maintenance-deferred (T-039 owns live verification).
- No git metadata was mutated (`git add`/`commit`/etc. not used) per DSH policy.

Canonical PRD, `.project-gate.json`, and `AGENTS.md` treated as read-only — no scope-expansion
edit required. Final exact SHA is recorded in the immutable external supervisor receipt, not
self-referentially here.
