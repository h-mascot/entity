# T-027 N1 native managed-storage broker core

## Scope recorded before edits

Selected paths and reasons:

- `packages/server/native/managed-storage-broker/managed_storage_broker.h` — bounded C API for the standalone native broker core and protocol seam.
- `packages/server/native/managed-storage-broker/managed_storage_broker.c` — POSIX implementation that opens the managed root once and performs all path operations relative to trusted directory file descriptors.
- `packages/server/native/managed-storage-broker/test_managed_storage_broker.c` — deterministic direct functional, malformed-input, and parent/child symlink-swap tests.
- `scripts/build-managed-storage-broker.mjs` — narrow reproducible compile/test entry point using the system C compiler.
- `docs/plans/evidence/entity-document-integrations/T-027/N1-NATIVE-CORE.md` — this scope and later proof receipts.

Explicitly excluded from N1: Node/N-API adapter, document providers, persistence, routes, runtime packaging, deployment, and production changes.

The first pre-edit compiler smoke test was run with `/usr/bin/cc -std=c11 -Wall -Wextra -Werror` and passed.

## Proof receipts

_To be filled only after implementation and verification._
