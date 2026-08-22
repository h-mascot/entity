# T-023 (THE-964) — Evidence disposition: no Microsoft structured mutation enabled

## Review target

- **Candidate reviewed:** `393cb57f44cf7c392277859e87e002825e93654c`
- **Exact review range:** `a05028e7516ffd1d549221eec8f22b0212a705a2..393cb57f44cf7c392277859e87e002825e93654c`

The focused test, build, and diff-check results below are the results recorded for this exact candidate and review range.

## Disposition

**Blocked by governing evidence; no product-source implementation is warranted.** The governing T-021 ADR (`docs/adr/2026-08-microsoft-document-capabilities.md`) explicitly records all three structured Microsoft mutation lanes as unsupported:

- Word text mutation (`agent_text_mutation`) — `unsupported`
- Excel range/workbook mutation (`agent_range_mutation`) — `unsupported`
- PowerPoint slide mutation (`agent_slide_mutation`) — `unsupported`

The ADR states that Graph storage/upload proves only file storage and must never be represented as structured mutation. It also records no approved format engine, exact mutation route, concurrency semantics, or sanitized round-trip fixture for any lane. The existing executable spike consequently returns `false` for every `microsoftMutationAllowed(...)` call and resolves unknown capability/artifact pairs to `unknown`.

The T-022 create adapter is intentionally a creation seam only: it returns `editorOpenProof: 'unproven'`, performs no structured mutation, and does not provide mutation evidence. The requested `mutation-adapter.ts` and colocated test do not exist in this checkout; creating them would invent unsupported behavior and violate the ADR. No product source or test source was added.

## Fail-closed and stale-revision proof

- `cd packages/server && npx vitest run src/document-providers/microsoft/capability-spike.test.ts src/document-providers/revision-coordinator.test.ts` — exit 0 for candidate `393cb57f44cf7c392277859e87e002825e93654c`; **2 files, 27 tests passed**.
  - The capability spike tests cover all three mutation lanes across applicable and wrong artifact types, unknown fallback, and denial.
  - The revision coordinator tests cover pre-mutation stale rejection and no-concurrency-token fail-closed behavior for the shared mutation contract. Since no Microsoft lane is enabled, there is no enabled lane requiring a separate stale-revision adapter test.
- `cd packages/server && npm run build` — exit 0 for candidate `393cb57f44cf7c392277859e87e002825e93654c`.
- `git diff --check` — exit 0 for the exact review range and evidence-only correction.

No provider calls, credentials, secrets, tenant data, document contents, or external network behavior were used.

## Acceptance mapping

- **Proven Microsoft structured mutation:** none exists in the ADR evidence; none enabled.
- **Capability honesty:** preserved; unsupported and unknown states remain non-callable.
- **Unknown/degraded/unsupported fail closed:** existing capability and coordinator tests pass.
- **Stale revision behavior:** shared coordinator rejects stale writes before adapter execution; no Microsoft mutation lane is callable, so no lane-specific stale behavior can honestly be claimed.
- **Whole-file overwrite:** not introduced or represented as structured mutation.
- **Isolation/secrets:** no product data path, credentials, or tenant/document fixtures added.

## Scope and delivery

Bounded scope expansion: evidence-only disposition at this required path because the governing ADR makes implementation impossible without new provider/engine proof. No product-source files were changed. This correction is one focused evidence-only commit; no deploy, push, merge, Linear mutation, or provider call was performed.
