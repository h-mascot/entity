# T-022 (THE-963) — authorized durable idempotency successor

## Minimum-Viable-Governance follow-up remediation

- Exact base: `31a3985aa0e89766da7645e9e34fedaace68a2ef`; exact remediation head is recorded below after the single follow-up commit.
- B1 disposition: completed replay now parses and structurally/semantically validates persisted `result_json`; malformed JSON, wrong shape, or unsafe URL fails closed as typed `IDEMPOTENCY_UNCERTAIN`, with zero provider calls. Prove-It coverage: 3 invalid persisted-result cases.
- B2 disposition: durable completion/upsert now requires matching request fingerprint and rejects completed/uncertain illegal transitions; direct repository proof covers wrong fingerprint, completion, and wrong-state overwrite.
- Scope audit: only the permitted DB implementation/test, Microsoft adapter implementation/test, and this evidence file changed. No registry/document composition, routes, migrations, providers/network, credentials, or external contracts were added.

## Base and scope

- Base: `5eec1d68afcc9018ecde2e620810236041a93a09`; branch: `runner/entity-document-integrations-20260818`.
- The pre-edit HEAD matched exactly. The pre-existing dirty path was this evidence file; its prior content was preserved in the final record and reconciled with the successor implementation.
- Allowed implementation paths changed: `packages/db/src/document-integrations.ts`, `packages/server/src/document-providers/microsoft/create-adapter.ts`, and its colocated test. No route/registry/migration source changes were necessary because the existing repository is the composition seam; route behavior remains fail-closed and workspace-scoped.
- No network, credentials, Graph/provider call, sandbox, production, deployment, Linear/GitHub, or destructive data operation was performed.

## Exact behavior delivered

- `document_operations` now durably stores a SHA-256 request fingerprint and sanitized completed result JSON, with additive upgrade handling for an existing T-003 table.
- `claimDocumentOperation` atomically inserts `(workspace_id, idempotency_key)` as `in_flight` before transport invocation. It classifies same-fingerprint completed rows for truthful replay, conflicting fingerprints as conflict, and all in-flight/uncertain rows as uncertainty. Workspace is part of every lookup and unique key.
- Microsoft create now requires the injected real `DocumentIntegrationsRepository` and explicit workspace ID. The former transport-local `WeakMap` was removed. Provider throws are converted to typed `IDEMPOTENCY_UNCERTAIN` and durably marked uncertain; malformed provider responses are durably marked uncertain and retain their typed malformed-response error. Completed results are persisted and replayed without another provider call.
- Existing T-019 tenant/binding, T-020 destination, artifact, descriptor, and malformed-response fail-closed validation remains before provider invocation. No provider identity, Entity ID, URL, or editor proof is fabricated.

## Prove-It commands and exits

All focused commands used Node 22.22.2:

- `cd packages/server && npx vitest run src/document-providers/microsoft/create-adapter.test.ts src/document-providers/migrations.test.ts` — exit 0; 2 files, 29 tests.
- `cd packages/db && npx vitest run src/document-integrations.test.ts` — exit 0; 1 file, 36 tests.
- `cd packages/server && npm run build` — exit 0.
- `git diff --check` — exit 0.
- `cd packages/db && /opt/homebrew/opt/node@22/bin/node ../../node_modules/vitest/vitest.mjs run src/document-integrations.test.ts` — exit 0; 37 tests.
- `cd packages/server && /opt/homebrew/opt/node@22/bin/node ../../node_modules/vitest/vitest.mjs run src/document-providers/microsoft/create-adapter.test.ts` — exit 0; 28 tests.
- `cd packages/server && npm run build` — exit 0.
- Node 26 focused invocations were blocked by the pre-existing better-sqlite3 ABI mismatch; Node 22.22.2 rebuild and focused proofs passed. No full suite run.

The focused tests prove pre-call durable claiming, fresh repository/adapter replay with zero provider calls, conflict, uncertainty after throw and malformed response across fresh instances, and workspace isolation. The DB suite retains persistence and schema/migration coverage. The full suite was intentionally not run: the requested focused gate passed and no concrete high-risk reason required expanding it.

## Pre-commit and disposition

- Pre-commit `git write-tree`: recorded immediately before the single follow-up commit and reported in the final response.
- Allowed-path audit: final changes are limited to the two implementation files, their permitted colocated tests, and this permitted evidence file; no out-of-scope source was changed.
- Uncertainty semantics are explicit: after any provider throw or malformed response the durable row is `uncertain`; subsequent same-scope/fingerprint attempts return typed `IDEMPOTENCY_UNCERTAIN` without transport invocation. This is intentionally not a retry or fabricated completion.
- Deferred proof: Microsoft sandbox/live Graph activity, valid/openable DOCX/XLSX/PPTX artifact round trips, Office editor/browser proof, and external/public promotion remain deferred as required by the T-021/T-020 evidence and sandbox deferral policy.
