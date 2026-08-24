# T-032 — Implement provider-neutral agent tools — Evidence

Ticket: Linear THE-973 / T-032 — Entity Document Integrations, P-05 Agent tools and product UX.
Base HEAD: `e7d026010810d34421c13158f61323b67ee2ed0b` (immutable).
Scope: R-023 (provider-neutral agent document tools). Same tool contract dispatches to
Google Workspace, Microsoft 365, and local-office lanes based on trusted document/provider
context — never provider-specific UI automation and never direct provider credential access.

## Scope (primary ticket paths touched)

- `packages/server/src/agent/tools.ts` — added the T-032 provider-neutral document agent tool
  orchestrator (`createDocumentAgentTools`) alongside the existing task-agent tools.
- `packages/server/src/agent/tools.test.ts` — RED-before-GREEN cross-provider contract tests.
- `docs/plans/evidence/entity-document-integrations/T-032/EVIDENCE.md` — this file
  (issue-required same-scope expansion).

The route (`packages/server/src/routes/document-integrations.ts`) was NOT modified: the tools
compose the same shared document-providers primitives directly (registry, capability resolver,
write policy, destinations, revision coordinator, phase-2 flags) rather than adding a competing
API namespace, provider registry, receipt store, event table, UI, deployment, or unrelated
refactor. The canonical PRD was not modified.

## Contract delivered (R-023 minimum)

Five provider-neutral tools, each returning a typed data envelope (Entity document ID, stable
Entity URL `/<documentId>`, provider, resulting revision, capability result, operation/receipt
correlation ID, typed warning/degraded information):

- `document.create`
- `document.read`
- `document.revise`
- `spreadsheet.range.update`
- `presentation.slide.update`

Write tools accept: creation/target context, typed operation payload, expected revision on
updates, idempotency/operation ID, optional association context, and confirmation evidence when
required. Dispatch is driven by the trusted registry record (workspace-scoped) and the negotiated
capability/policy/connection evidence — never by a caller-supplied provider string in isolation.
A caller-provided provider that disagrees with the trusted record FAILS CLOSED.

## Fail-closed gates enforced (all writes)

- unknown/degraded/unsupported capability → `unsupported`
- provider mismatch (caller string vs trusted record) → `denied`
- missing authority (missing/unapproved destination, no write policy, write mode disabled,
  non-admin, missing workspace) → `denied`
- unsafe payload / adapter no-concurrency-evidence (R-024) → `unsupported`
- stale expected revision (R-025 standard conflict) → `conflict` (no blind retry)
- unsupported lane / missing adapter → `unsupported`
- audited `capability_resolver_enforcement` flag disabled → `denied` (reversible rollback, 14.6)
- workspace isolation / unknown document id → `not_found` / `denied`
- create idempotency replay (R-026) → reconciles to the existing canonical record (one artifact)

No credentials or tokens are ever exposed; the result envelope carries only leaf metadata and
sanitized revision/warning text.

## Proof (Node 22, `packages/server`, Vitest)

Environment note: the checked-in shared `node_modules` is a symlink whose `better-sqlite3`
native binding is unbuilt (`Could not locate the bindings file`). To run the DB-backed document
tests the native binding was rebuilt into a workspace-local nested `packages/server/node_modules`
(real directory in this worktree, git-ignored) and the suite is run under Node 22
(`~/.nvm/versions/node/v22.22.2`). This is a test-infrastructure adaptation; it does not alter
any git-tracked source.

RED-before-GREEN: `packages/server/src/agent/tools.test.ts` was written first and failed (12/13)
while `createDocumentAgentTools` was absent; it passes (13/13) after implementation.

### T-032 cross-provider agent tool tests
```text
npx vitest run src/agent/tools.test.ts
✓ src/agent/tools.test.ts (13 tests)
Tests  13 passed (13)
```
Covers: create/read/revise/range/slide dispatch across google_workspace, microsoft_365, and
local_office; unsupported-capability fail-closed; provider-mismatch fail-closed; create
without authoritative destination deny; stale-revision conflict; create idempotency replay;
unknown-document not_found; missing-workspace deny.

### Relevant Document API / adapter / local-engine tests
```text
npx vitest run src/document-providers/contract.test.ts \
  src/document-providers/registry.test.ts \
  src/document-providers/revision-coordinator.test.ts \
  src/document-providers/write-policy.test.ts \
  src/document-providers/capability-resolver.test.ts \
  src/routes/document-integrations.test.ts
Test Files  6 passed; Tests  208 passed (208)
```

### Server build / typecheck (strict)
```text
cd packages/server && npm run build     # tsc — no errors
```

### Hygiene
```text
git diff --check                        # clean
node scripts/scan-private-defaults.mjs  # scans repo-wide; changed files introduce no secrets
```
Manual grep of the changed files confirms no API keys/secrets/credentials — matches are benign
identifiers (`tokenize`, comment text) only.

## Limitations

- Association context (`associations`) is accepted by the write/create tools and surfaced as a
  typed warning/degraded outcome rather than silently dropped; it is not yet persisted because
  the active adapters do not expose an association-write lane and no competing store was added
  (consistent with the T-008/T-003 boundary).
- The existing broader `packages/server/src/agent/` suite has 8 pre-existing failing test files
  (ask-flow, chief-routing, invite-kit, presence, review-policy, workplane-attach) that fail at
  BASE HEAD with `Could not locate the bindings file`; they do not import this ticket's code.
  Verified by restoring base files: the failures reproduce identically without these changes.
- `receiptId` is currently `null` (no new receipt store was added in this ticket); the
  operation/receipt correlation is carried by `operationId` (idempotency key), matching the
  T-008 router's `receiptId: null` behavior.

Final commit SHA is recorded in the external receipt, not self-referentially in this file.
