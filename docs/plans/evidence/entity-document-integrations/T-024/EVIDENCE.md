# T-024 Evidence — Microsoft versions/permissions/change tracking/open

- Commit SHA: exact SHA is the single commit containing this evidence; verify with `git rev-parse HEAD` from the clean worktree (reported as `FINAL_SHA` in the task closeout).
- Production action: none. No provider network calls, credentials, secrets, document contents, or absolute paths were used.

## Commands and outcomes

- `cd packages/server && npx vitest run src/document-providers/microsoft/reconciler.test.ts` — PASS, 1 file, 4 tests.
- `cd packages/server && npm run build` — PASS (TypeScript build).
- `git diff --check` — PASS.

## Acceptance mapping (R-014)

- Version normalization: provider-evidenced version IDs, timestamps, and sizes are retained only when the version capability is actionable.
- Permissions: normalized to a bounded sharing summary and explicitly `complete: false`; absent/unrecognized evidence is `Unknown`.
- Preview: thumbnail evidence produces `ready`; absent/unsupported preview is distinct from document unavailability.
- Change tracking: injected provider polling/delta evidence advances revisions, ignores duplicates, rejects stale revisions, and degrades on source failure.
- Open: only provider-evidenced HTTPS `sharedUrl`/`webUrl` is exposed; no URL is fabricated.
- Isolation: reconciliation lookup and update require workspace ID; foreign workspace artifacts are not updated.
- Capability honesty: unsupported/degraded/unknown capability state suppresses derived data; no structured mutation or embedding lane was added.

## Bounded expansion

- Added the two named Microsoft implementation modules and the required colocated reconciler test because those paths were absent and the existing adapter contract has optional read/version/preview/permission/open/reconcile seams.
- No routes, persistence schema, migrations, provider transport, or public API were added; injected seams are intentional to keep this ticket network-free and truthful.
