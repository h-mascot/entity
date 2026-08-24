# T-025 / THE-966 evidence

## Scope

Repaired the R-017 local engine candidate matrix and pure selection seam. `selectLocalEngine` now fails closed unless the candidate disposition is exactly `candidate`, every required format is evidence-backed as `verified`, and fidelity, structured mutation, headless operation, licensing, security boundary, and maintenance are production-ready. No provider route, registry, database/schema/migration, credential, network, Electron, or public API work was performed.

## Decision

The concrete engine is deferred. A document-scoped desktop bridge is the recommended reversible boundary, behind the pure `LocalOfficeEngine` seam. GenOffice, ONLYOFFICE, and Univer remain candidates requiring licensing, fidelity, runtime, and security proof.

## Automated proof

- Focused test: `packages/server/src/document-providers/local/engine-spike.test.ts`
- Covers candidate matrix, evidence-backed success selection, bridge-unavailable degradation, evidence-backed unverified-format degradation, deferred-with-favorable-fields rejection, rejected/unmeasured candidate rejection, and a fake `LocalOfficeEngine` integration exercising `probe`, `open`, `inspect`, `mutate`, and `save` with readiness/revision propagation.
- Readiness is not caller-attested: `verifiedFormats` was removed from the selection input; format verification is part of candidate evidence and must be `verified`.

## Capability-honesty boundary

The fixture README records manual open/edit/save/reopen as **not performed**. No runtime/manual result is claimed. Security/file access is an ADR design review only; bridge implementation and attack tests belong to T-026.

## Bounded path expansion

Added/expanded the mandatory colocated focused test `packages/server/src/document-providers/local/engine-spike.test.ts`. This is the same bounded expansion: acceptance explicitly requires focused automated success plus negative/degraded proof and R-016 explicitly requires fake-engine integration coverage, while the named T-025 paths omitted the test path.

## Verification

- `cd packages/server && npx vitest run src/document-providers/local/engine-spike.test.ts` — PASS (1 file, 6 tests).
- `cd packages/server && npm run build` — PASS (TypeScript build).
- `git diff --check` — PASS.
- Focused commit: recorded in the final response; no push, merge, deploy, or Linear mutation performed.
