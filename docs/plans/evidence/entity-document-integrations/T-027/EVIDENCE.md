# T-027 Evidence — Local managed storage / File Sources

## N4 — Integrated adversarial proof

N4 adds the colocated `local.integration.test.ts` seam, exercising the actual native broker executable through the Node IPC client and `LocalFileSourceAdapter`. Controlled temporary fixtures cover parent and child symlink escapes across `stat`, `read`, `readRaw`, `write`, `writeExclusive`, `mkdir`, and `list`; outside sentinels are checked unchanged and no outside target is created. The same route covers successful metadata/read/write/exclusive-create/mkdir/list behavior, then verifies a deleted managed target returns the typed `not_found` error while the previously returned metadata remains unchanged. Construction remains non-throwing and validation distinguishes unavailable missing roots from existing file roots.

The broker IPC entrypoint now emits a typed startup `not_found` response before exit when its configured root is absent. The adapter maps that startup exit to the existing unavailable validation message, while an invalid existing file root maps to the existing directory contract. No Node filesystem fallback, authority redesign, routes, persistence, provider, or UI paths were added.

## N4 verification

Commands run from the assigned worktree:

```sh
node scripts/build-managed-storage-broker.mjs
# PASS (exit 0): native core and IPC entrypoint compile/direct adversarial tests passed

git diff --check
# PASS (exit 0)

cd packages/server && npx vitest run src/fs/adapters/local.integration.test.ts src/fs/adapters/local.test.ts src/fs/managed-storage-broker.test.ts
# BLOCKED (exit 1): dependency-free worktree; vitest/config unavailable; no network installation attempted

cd packages/server && npm run build
# BLOCKED (exit 127): dependency-free worktree; tsc unavailable; no network installation attempted
```

The focused integration and typecheck commands were attempted but could not execute because this assigned worktree has no installed Node dependencies. The native build/direct tests and whitespace gate passed. Final commit SHA: `687fc464d1ff44189737141575c7d94df4af6c44`.

## N3 — LocalFileSourceAdapter integration

N3 integrates every managed filesystem operation (`stat`, `read`, `readRaw`, `write`, `writeExclusive`, `mkdir`, and `list`) through `ManagedStorageBrokerClient` operations. The adapter does not resolve filesystem pathnames, perform Node root authorization/realpath checks, or provide a Node fs fallback. The broker startup root is bound once by the client; adapter operation requests contain only normalized broker-relative paths.

The missing-root contract is preserved: construction is synchronous and non-throwing even when the root is absent; `validate()` asks the broker to `stat('.')` and maps the typed `not_found` broker error to `Error('Local source path does not exist.')`. Other broker operation errors remain typed and are not rewritten. Validation uses the adapter's broker binding rather than a caller-supplied replacement `base_path`.

Focused N3 tests use a controlled broker double and prove delegation, no root override, construction with an absent root, the exact unavailable validation message, and typed operation error preservation.

## N3 verification

Commands run from the assigned worktree:

```sh
node scripts/build-managed-storage-broker.mjs
# PASS (exit 0): native core and IPC entrypoint compile/direct tests passed

cd packages/server && npx vitest run src/fs/adapters/local.test.ts src/fs/managed-storage-broker.test.ts
# BLOCKED (exit 1): dependencies are absent; vitest/config could not be resolved; no network installation attempted

cd packages/server && npm run build
# BLOCKED (exit 127): dependencies are absent; tsc not found; no network installation attempted

git diff --check
# PASS (exit 0)
```

The focused server tests and typecheck could not execute due to the dependency-free worktree; the native build and whitespace gate passed. The single focused commit is `0ee7dfcdcc07e7d7110cd42303638a8c6452c894`.

Changed paths for N3:

- `packages/server/src/fs/adapters/local.ts` — broker-only adapter implementation.
- `packages/server/src/fs/adapters/local.test.ts` — focused controlled-broker integration and missing-root contract tests.
- `docs/plans/evidence/entity-document-integrations/T-027/EVIDENCE.md` — N3 evidence.

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
