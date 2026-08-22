# T-022 (THE-963) — Microsoft create lanes — EVIDENCE

## Repair base and authority

- Repair base was verified exactly as `da2f5e4bf93ef5251b7f5b00f85a72383cddaf3c` on `runner/entity-document-integrations-20260818`; the worktree was clean before repair.
- Read root/scoped AGENTS, BUILD-CONTEXT, canonical T-022/R-013, T-019/T-020/T-021 evidence, the prior T-022 evidence, and the immutable Luna-max review transcript. The transcript file was not present in this checkout; the available immutable review finding record was reconciled conservatively and no finding was silently omitted.
- Only the three named T-022 paths changed. No route change was necessary.

## Implemented repair

`create-adapter.ts` remains an injected, non-network seam and now:

- fails closed before transport unless provider, authorization, consent, write scope, revocation, and `readinessState === 'ready'` all hold;
- validates the resolved destination against every available T-020 authority/identity axis before transport: connection/binding/destination tenant, observed tenant, observed issuer, connection identity, workspace, permitted enablement/type, requested destination echo, and all persisted identity fields;
- applies strict bounded title/content/idempotency-key validation (including non-empty content and printable, trimmed, bounded keys);
- maintains transport-scoped deterministic idempotency reconciliation: same key/request returns the prior result without a second transport call, conflicting reuse typed-fails, in-flight/uncertain reuse typed-fails, and malformed/throwing transport outcomes are never converted into success;
- preserves injected/no-network/no-credential boundaries and validates provider identity, HTTPS URL, and revision output.

The tests add direct zero-transport Prove-It coverage for degraded/unknown readiness and forged observed tenant, issuer, destination echo, and identity values, plus input, conflicting-key, and throw-after-possible-create regressions. They retain the three artifact-shape and existing-result coverage.

## R-013 reconciliation and limits

The named paths cannot honestly complete the full R-013 acceptance contract. They contain no OOXML generation contract, real Microsoft transport, stable Entity document/persistence composition, operation-scoped persistent idempotency store, sandbox tenant, or browser/editor proof seam. `routes/document-integrations.ts` has no strictly necessary T-022 Microsoft composition seam, and adding one would fabricate wiring rather than compose an existing contract.

Therefore this commit proves only the narrow local safety boundary: an already-resolved, already-authorized destination can be handed to an injected transport with fail-closed authority, input, idempotency, and output handling. It does **not** claim Microsoft creation, valid/openable DOCX/XLSX/PPTX artifacts, Entity persistence, provider version capture in the Entity object, or Edit-in-Microsoft-365 proof. Those require a successor wiring/live lane that owns the real Microsoft transport, artifact generation, operation-scoped persistence/idempotency, registry composition, sandbox credentials/tenant, and browser proof (T-038/T-039 boundary).

No Graph call, secret provisioning/read, tenant artifact, sandbox, browser proof, production, route, DB, or deployment action was performed.

## Verification (direct exits)

Node 22.22.2 was used.

- `cd packages/server && npx vitest run src/document-providers/microsoft/create-adapter.test.ts` — **exit 0**, 23 passed.
- `cd packages/server && npm run build` — **exit 0**.
- `cd packages/server && npx vitest run` — **exit 0**, 220 files / 2263 tests passed.
- `git diff --check` — **exit 0**.

## Allowed paths

- `packages/server/src/document-providers/microsoft/create-adapter.ts`
- `packages/server/src/document-providers/microsoft/create-adapter.test.ts`
- `docs/plans/evidence/entity-document-integrations/T-022/EVIDENCE.md`

No other path is authorized or changed. Exactly one commit is required only after the mandatory full-suite and diff checks pass.

## Finding mapping

- **F1:** fixed — exact-ready readiness gate and zero-transport tests.
- **F2:** fixed — bidirectional permitted-vs-observed authority/identity validation and zero-transport forged-value tests.
- **F3:** fixed — bounded title/content/key validation, deterministic repeated/conflicting/in-flight/uncertain key handling, and no fabricated success after transport throw/malformed output.
- **F4:** fixed — no silent duplicate creation or conflicting destination/request reuse; existing result is returned only for the identical request fingerprint.
- **F5:** fixed — transport failure and malformed output remain typed/uncertain, never success.
- **F6:** disposition recorded — full R-013 completion remains blocked on the successor architecture/live seams above; this narrow seam makes no completion claim.
