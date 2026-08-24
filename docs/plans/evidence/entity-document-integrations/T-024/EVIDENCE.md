# T-024 Evidence — Microsoft versions/permissions/change tracking/open

- Candidate SHA: final focused repair commit SHA is reported as `FINAL_SHA` in the task closeout.
- Production action: none. No provider network calls, credentials, secrets, document contents, or absolute paths were used.

## Commands and outcomes

- `cd packages/server && npx vitest run src/document-providers/microsoft/reconciler.test.ts` — PASS, 1 file, 6 tests (including partial forward evidence preservation and unsafe/non-HTTPS URL rejection).
- `cd packages/server && npm run build` — PASS (TypeScript build).
- `git diff --check` — PASS.

## Acceptance mapping (R-014)

- Version normalization: provider-evidenced version IDs, timestamps, and sizes are retained only when the version capability is actionable.
- Permissions: normalized to a bounded sharing summary and explicitly `complete: false`; absent/unrecognized evidence is `Unknown`.
- Preview: thumbnail evidence produces `ready`; absent/unsupported preview is distinct from document unavailability.
- Change tracking: injected provider polling/delta evidence advances revisions, preserves stored optional metadata when forward evidence omits it, ignores duplicates, rejects stale revisions, and degrades on source failure.
- Open: only provider-evidenced HTTPS `sharedUrl`/`webUrl` is exposed; malformed or non-HTTPS reconciliation `webUrl` evidence is discarded and cannot persist an unsafe URL; no URL is fabricated.
- Isolation: reconciliation lookup and update require workspace ID; foreign workspace artifacts are not updated.
- Capability honesty: unsupported/degraded/unknown capability state suppresses derived data; no structured mutation or embedding lane was added.

## Bounded expansion

- Updated only the four named T-024 paths: the read-state validation seam, reconciler, colocated reconciler tests, and this evidence file.
- No routes, persistence schema, migrations, provider transport, or public API were added; injected seams remain network-free and truthful.
- This evidence records proof only and does not claim review approval; targeted review remains manager-owned.
