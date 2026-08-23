# T-027 Evidence — Local managed storage / File Sources

- Ticket: Linear THE-968 / LOOM-DOCS T-027
- N2 baseline HEAD: `be0caf14edda761be31e94a8c8a0b8435d74e35c`
- N2 scope: thin Node line-oriented IPC client plus native broker IPC entrypoint; no LocalFileSourceAdapter integration, root authorization, fallback Node fs, routes, or persistence.
- Exact base HEAD: `be0caf14edda761be31e94a8c8a0b8435d74e35c`
- Exact final HEAD: `e43c541590cbfb319cf3b4f096be390c652f9186`
- Exactly one focused commit; no reset/revert, push, merge, production, deployment, external calls, routes, migrations, watcher/T-028 behavior, or Linear mutation.

## Changed paths and reasons

- `packages/server/src/fs/managed-storage-broker.ts` — typed Node client; startup-only root binding, explicit stat/read/write/exclusive-create/mkdir/list request mapping, typed error propagation, and fail-closed response parsing.
- `packages/server/src/fs/managed-storage-broker.test.ts` — controlled fake-process protocol tests for broker errors and malformed responses.
- `packages/server/native/managed-storage-broker/broker_main.c` — minimal stdin/stdout IPC entrypoint that opens the root from argv exactly once and delegates all operations to N1 APIs; no authority refactor.
- `scripts/build-managed-storage-broker.mjs` — builds the IPC entrypoint alongside the N1 direct test.

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

## N2 Verification

Commands ran from the repository root:

```sh
node scripts/build-managed-storage-broker.mjs
# exit 0 — native core and IPC entrypoint compiled; direct native tests passed

printf 'write\\t612e747874\\t6869\\nread\\t612e747874\\nstat\\t612e747874\\nmkdir\\t646972\\t700\\n' | packages/server/native/managed-storage-broker/.build/broker "$TMP_ROOT"
# exit 0 — IPC smoke returned explicit ok/data/stat responses

cd packages/server && npx vitest run src/fs/managed-storage-broker.test.ts
# blocked: dependencies are absent in this worktree; npx could not resolve vitest/config (no network install attempted)

cd packages/server && npm run build
# blocked: dependencies are absent; tsc not found (no network install attempted)

git diff --check
# exit 0 — no whitespace errors
```

The focused native build remains runnable independently of Node dependencies. The protocol parser rejects unknown response shapes/codes and the client never includes the startup root in operation requests.

## Prior N1 Verification

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
