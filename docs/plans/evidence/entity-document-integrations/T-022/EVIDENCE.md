# T-022 (THE-963) — Microsoft create lanes — EVIDENCE

## Scope and authority

- Clean HEAD was verified before editing as exactly `930180640160376515bbcd8f0ca579aa840cf210` on `runner/entity-document-integrations-20260818`.
- The scoped AGENTS contract pins `83cacbc…`, while the local PRD and BUILD-CONTEXT pin the actual in-tree PRD as `c82e82d…`. This authority-pin conflict is accurately recorded and remains manager-owned; no authority document was edited.
- Read before implementation: root/scoped AGENTS, BUILD-CONTEXT, the T-022 PRD contract and R-013, T-019/T-020/T-021 evidence, and the Microsoft capability ADR.
- Node 22 was used (`v22.22.2`).

## Implemented seam

`packages/server/src/document-providers/microsoft/create-adapter.ts` adds a provider-transport-injected, non-network creation seam for exactly `document`/DOCX, `spreadsheet`/XLSX, and `presentation`/PPTX. It:

- accepts bounded explicit descriptors and rejects unknown or mismatched type/format before transport;
- requires an already-resolved T-020 destination and validates the T-019 tenant binding, connection, authorization, consent, write scope, workspace/destination relationship, and tenant isolation;
- has no default transport, destination, capability inference, credential/token storage, persistence, route, registry, event table, DB change, Graph call, or Entity document-id minting;
- forwards idempotency to the injected provider seam and returns an `existing` provider result without retrying, preventing duplicate transport creation when the provider reconciles an existing creation;
- requires opaque provider identity, HTTPS provider URL, and revision identity from the provider response;
- returns `editorOpenProof: 'unproven'` and makes no structured mutation claim.

The transport receives a typed request and returns either `created` or `existing`; transport failures remain transport-owned. Unsafe/malformed output is rejected with a typed error after the single attempted transport call. Authorization, tenant, destination, descriptor, and capability failures reject before transport.

## Tests and proof

Colocated tests: `packages/server/src/document-providers/microsoft/create-adapter.test.ts`.

The focused suite proves all three successful artifact shapes, provider-existing idempotency behavior, tenant mismatch, destination mismatch, missing write capability, revoked connection, mismatched format, and malformed provider identity/URL/revision responses with zero or appropriate transport calls.

Commands and direct results:

```text
export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"
node --version
PASS — v22.22.2

cd packages/server && npx vitest run src/document-providers/microsoft/create-adapter.test.ts
PASS — 1 file, 12 tests, exit 0

cd packages/server && npm run build
PASS — strict TypeScript build, exit 0

git diff --check
PASS — exit 0
```

An initial build attempt exposed a test fixture literal narrowing error (`existing` inferred as `created`); the fixture was corrected and the focused test/build rerun to green. No full suite was run, per instruction.

## Route and live-proof disposition

`packages/server/src/routes/document-integrations.ts` was ruled out: it does not contain a named Microsoft composition seam, and exposing this unproven provider-specific behavior through routes would violate the requested smallest honest seam. No route or index wiring was changed.

Microsoft 365 sandbox creation, per-artifact DOCX/XLSX/PPTX open proof, and browser Edit-in-Microsoft-365 proof were not performed and were not fabricated. They are deferred to the live-environment T-038/T-039 requirements. Live capability activation remains disabled pending that proof. No structured mutation support is enabled or implied; that remains T-023 territory.

## Allowed-path and base evidence

Only these allowed paths are changed:

- `packages/server/src/document-providers/microsoft/create-adapter.ts`
- `packages/server/src/document-providers/microsoft/create-adapter.test.ts`
- `docs/plans/evidence/entity-document-integrations/T-022/EVIDENCE.md`

The route path was not changed. No other source, PRD, ADR, T-019/T-020/T-021 file, DB, app, generated artifact, credential, tenant artifact, or production resource was touched.

The candidate pre-commit tree object is recorded by `git write-tree` immediately before the single conventional commit and is reported in the worker final response. No commit SHA is recorded here before commit creation.

## Scope disposition

**Complete for the local, injected, fail-closed T-022 creation seam.** Provider sandbox creation/open and browser proof remain explicitly unavailable/deferred to T-038/T-039; no claim of valid/openable Microsoft artifacts is made by this ticket.
