# T-028 Evidence — Local version watcher and safe save coordinator

## Scope and architecture correction

The canonical T-028 files implement R-021 watcher dedupe, stale-save rejection, candidate validation, recovery, atomic replacement, and reopen verification.

The architecture escalation closes both material blockers:

- `SafeSaveRequest` contains only a document ID, candidate bytes, validator, and expected revision. Workspace scope is bound when the server constructs `LocalSafeSaveCoordinator`; caller-supplied workspace, authority, path, or root properties cannot alter the operation. The coordinator resolves an authorized, ready workspace registry record, its opaque managed File Source reference, a healthy local source, and the allowlisted persisted source root before binding the broker.
- The accepted native managed-storage broker adds one operation-bound `replace-if-equal` primitive. Participating `write`, `exclusive-create`, `mkdir`, and conditional-replace operations share a bound-root lock across broker processes. Conditional replacement holds that lock through exact-byte comparison, recovery fsync, separate candidate fsync, atomic rename, and parent-directory fsync.

No unrelated provider, route, schema, UI, production configuration, Linear, main, merge, push, or deployment path was touched.

## Save contract and assumptions

- Watcher revision preconditions compare their SHA-256 `contentHash`; their metadata-rich watcher token remains available for dedupe. Exact expected bytes are supplied to the broker, avoiding metadata-only revision ambiguity.
- Candidate content is validated before the operation-bound replacement request.
- The broker performs the final exact-byte compare, recovery write, candidate fsync, and same-directory rename while holding the bound-root operation lock.
- The lock coordinates multiple Entity broker processes and ordinary native broker writes as well as conditional replacement.
- Generic arbitrary-external-writer filesystem CAS is not claimed. A non-cooperating writer observed at the broker's final comparison fails stale. An OS writer that ignores the broker lock and races after that linearization point is outside the portable contract.
- Final content is reopened and compared with the candidate before the new revision is returned.
- Each save owns and closes its broker process, and the executable is resolved from the server module location rather than the caller's working directory.
- Unknown/degraded authority, cross-workspace lookup, invalid managed references, unhealthy sources, and unallowlisted persisted roots fail closed.

## Verification

Commands run from the assigned worktree:

```sh
node scripts/build-managed-storage-broker.mjs
# PASS: native core and IPC entrypoint compiled; direct native tests passed, including stale/successful compare-and-replace and recovery verification.

cd packages/server && npx vitest run src/document-providers/local/safe-save.test.ts src/fs/managed-storage-broker.test.ts src/fs/adapters/local.integration.test.ts src/fs/adapters/local.test.ts
# PASS: 4 files, 30 tests passed.

cd packages/server && npx tsc --noEmit
# PASS: TypeScript typecheck completed.

cd packages/server && npm run build
# PASS: TypeScript build completed.

git diff --check
# PASS: no whitespace errors.
```

The coordinator test injects a competing write immediately before the broker's final comparison: save returns `stale`, preserves the competitor's content, and creates no recovery artifact. A native barrier pauses one broker process after candidate fsync while the target is still old, proves the root operation lock remains held, starts an independent competing broker process, and verifies that it blocks until the first rename then returns stale. Direct native coverage also proves stale attempts create no recovery artifact, successful recovery, empty expected/replacement framing, and target/recovery symlink rejection.

The full server Vitest suite was also attempted under Node 26.5.0 and the documented Node 22.22.2. Database-backed suites could not load the prelinked dependency because `/Users/enterprise/Code/entity-document-integrations-runner-20260818/node_modules/better-sqlite3` has no `better_sqlite3.node` binding for either runtime. This external dependency state was not modified; all requested T-028 and native broker suites above pass.
