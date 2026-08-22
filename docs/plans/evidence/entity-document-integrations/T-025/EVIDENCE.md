# T-025 / THE-966 evidence

## Scope

Implemented the R-017 local engine candidate matrix and ADR only. No provider route, registry, database/schema/migration, credential, network, Electron, or public API work was performed.

## Decision

The concrete engine is deferred. A document-scoped desktop bridge is the recommended reversible boundary, behind the pure `LocalOfficeEngine` seam. GenOffice, ONLYOFFICE, and Univer remain candidates requiring licensing, fidelity, runtime, and security proof.

## Automated proof

- Focused test: `packages/server/src/document-providers/local/engine-spike.test.ts`
- Covers candidate matrix, success selection, bridge-unavailable degradation, unverified-format degradation, unmeasured candidate rejection, and explicit rejected-candidate negative proof.

## Capability-honesty boundary

The fixture README records manual open/edit/save/reopen as **not performed**. No runtime/manual result is claimed. Security/file access is an ADR design review only; bridge implementation and attack tests belong to T-026.

## Bounded path expansion

Added the mandatory colocated focused test `packages/server/src/document-providers/local/engine-spike.test.ts`. This is a same-issue bounded expansion because acceptance explicitly requires focused automated success plus negative/degraded proof, and the named T-025 paths omitted the test path.

## Verification

- `cd packages/server && npx vitest run src/document-providers/local/engine-spike.test.ts` — PASS (1 file, 4 tests).
- `cd packages/server && npm run build` — PASS (TypeScript build).
- `git diff --check` — PASS.
- Focused commit: recorded in the final response; no push, merge, deploy, or Linear mutation performed.
