# T-027 Evidence — Local managed storage / File Sources

- Ticket: Linear THE-968 / LOOM-DOCS T-027
- Exact base HEAD: `9a22f072402d9030ed9d292cd89aee8c7511c7b5`
- Exact final HEAD: `43a3cd11a40acfcee92201c2226db829dcd62861`
- Exactly one focused commit; no reset/revert, push, merge, production, deployment, external calls, routes, migrations, watcher/T-028 behavior, or Linear mutation.

## Changed paths and reasons

- `packages/server/src/document-providers/local/managed-storage.ts`
  - Re-checks the existing managed-source allowlist after adapter filesystem access, closing the pre-check-to-access source-root replacement window and preserving sanitized unavailable behavior.
- `packages/server/src/fs/adapters/local.ts`
  - **Authorized scope expansion:** indispensable access-time hardening. Captures the source root realpath at adapter creation and verifies it is unchanged immediately before and after `stat`; an untrusted root replacement therefore fails closed rather than allowing adapter containment to succeed against an outside target.
- `packages/server/src/fs/adapters/local.test.ts`
  - **Authorized scope expansion:** colocated deterministic regression for the root-swap bypass. It swaps the source root during adapter access, proves sanitized denial, and proves the outside file remains unchanged.
- `docs/plans/evidence/entity-document-integrations/T-027/EVIDENCE.md`
  - Updated after the implementation commit with exact base/final SHAs and verification results.

No roots, routes, migrations, credentials, external calls, or new persistence were added.

## B3-security mapping

- **B3-security CLOSED:** managed storage still performs the pre-adapter allowlist check, while the local adapter now binds access to the real source root captured at construction and revalidates that identity around filesystem `stat`. A replacement of the authorized source root with a symlink to an outside directory is rejected with a sanitized unavailable result; no host path or filesystem error is returned. Valid in-root files remain readable and register successfully.

## Verification

All commands ran from the repository root under Node 22.22.2:

```sh
source .nvm/nvm.sh && nvm use 22 >/dev/null && cd packages/server && npx vitest run src/document-providers/local/managed-storage.test.ts src/fs/adapters/local.test.ts
# exit 0 — 2 files, 11 tests passed

source .nvm/nvm.sh && nvm use 22 >/dev/null && cd packages/server && npm run build
# exit 0 — TypeScript build completed

git diff --check
# exit 0 — no whitespace errors

git status --short
# exit 0 after the final evidence amendment — clean
```

The root-swap regression is deterministic: the test replaces the source root at the adapter's `lstat` boundary, then asserts `basePath changed during access` and confirms the outside fixture remains unchanged. The focused managed-storage test also preserves valid allowed-source success.
