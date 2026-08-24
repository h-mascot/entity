# T-040 Final Integration Repair — Truthful Evidence

Base SHA: `9f093e99b54fb12d5ece0d6c97936fdb1dbe76a8`
Environment: Node 22 (`/opt/homebrew/opt/node@22/bin`), monorepo `packages/server` Vitest.

## Regressions reproduced

The accepted descriptor-bound managed-storage broker seam introduced three
integration regressions, all confirmed before the repair:

1. `src/fs/routes-files.test.ts` oversized local read returned **500** (expected **413**).
2. `src/fs/routes-files.test.ts` deleted/missing local file returned **500** (expected **404**).
3. `src/routes/legacy-files.test.ts` symlink escape on a source read returned **400** (expected **403**).

## Root cause

The native broker (`native/managed-storage-broker`) reports failures through a
small typed error-code vocabulary (`not_found`, `invalid`, `limit`, `io`,
`exists`), surfaced by `ManagedStorageBrokerClient` as
`ManagedStorageBrokerError`. The pre-broker filesystem adapter produced the
human-readable errors whose messages the route error mappers keyed their HTTP
statuses on:

- a missing file threw an `ENOENT`-style message → `isMissingPathError` → **404**;
- a symlink escape threw `"Access outside source root is not allowed."` → **403**;
- an oversized read threw `SourceReadLimitError` → **413**.

After the broker seam, `ManagedStorageBrokerError` messages
(`managed storage broker: not_found` / `invalid` / `limit`) were not recognized
by the route mappers, so they fell through to **500** (or **400** for `invalid`).

## Repair (narrowest correct seam: the local adapter + broker error class)

`packages/server/src/fs/adapters/local.ts`:

- `readBytes` now applies the shared default read ceiling
  (`DEFAULT_SOURCE_READ_LIMIT_BYTES`, 16 MiB) when no explicit `maxBytes` is
  supplied, throwing `SourceReadLimitError` with the standard
  `Source file exceeds the configured read limit of 16777216 bytes.` message →
  route maps to **413** (fixes regression 1).
- Broker typed failures on the read path are re-surfaced as
  `ManagedStorageBrokerError` that keeps the same typed `.code` but carries the
  route-recognized message:
  - `not_found` → `"ENOENT: no such file or directory"` → **404** (fixes 2);
  - `invalid` → `"Access outside source root is not allowed."` → **403** (fixes 3, fail-closed).

`packages/server/src/fs/managed-storage-broker.ts`:

- `ManagedStorageBrokerError` gains an optional message argument so a typed
  broker error can keep its `.code` while carrying a route-readable message.
  Default message is unchanged (`managed storage broker: <code>`),
  backward-compatible.

No symlink/root isolation was weakened: `invalid` (the broker's
symlink/`ELOOP`/descriptor-invalid code) is mapped fail-closed to a 403
source-root violation. No broad string matching was introduced. No unrelated
tests were altered.

## Follow-up: unhandled `write EPIPE` on broker stdin races (manager finding)

After the 2505/2505 green run, `npm run ctrl:full` under Node 22 surfaced two
unhandled `write EPIPE` exceptions at
`packages/server/src/fs/managed-storage-broker.ts:88` (`this.child.stdin.write`)
from the routes-docs missing-file tests. All assertions passed but Vitest exited
1 because a `stdin.write(...)` racing a broker child exit emitted an unhandled
stream `'error'` instead of rejecting the affected request Promise(s).

### Root cause

`ManagedStorageBrokerClient` attached no `'error'` listener to
`this.child.stdin`. The child can disappear between requests (or mid-batch)
while a write is in flight; the pipe then breaks and the `write()` call emits an
`EPIPE` `'error'` event on stdin. With no handler that becomes an unhandled
exception (Node's default `uncaughtException`/vitest unhandled-error path), even
though the request Promise was never settled.

### Repair (`packages/server/src/fs/managed-storage-broker.ts`)

- `this.child.stdin.on('error', ...)` rejects every queued pending request
  (shared `failPending`) with `managed storage broker input failed`, so the
  failure surfaces on the request Promise(s) instead of an unhandled stream error.
- `request()` wraps `this.child.stdin.write(payload)` in try/catch and rejects
  the exact entry on a synchronous write failure (e.g. write-after-end), removing
  it from the queue — no pending-queue corruption.
- Consolidated the exit drain into `failPending` (drain-once via `shift()`), so
  stdin-error and child-exit paths never double-settle a request; exit now also
  closes the readline interface. `closed` gating (already present) still rejects
  any later `request()` immediately.
- No descriptor-relative authorization logic was touched: the guard is purely on
  the I/O transport race, not on path/descriptor validation. Ordering preserved
  (FIFO `shift()`), close behaviour unchanged (graceful `stdin.end()` then await
  exit).

### Tests added (focused, deterministic — `managed-storage-broker.test.ts`)

Inject a controllable fake child (real `PassThrough` stdio via `spawn` option), so
the races are reproduced deterministically with no real subprocess timing:

- **EPIPE/exit race**: break stdin, the in-flight read rejects with
  `managed storage broker input failed` (no unhandled EPIPE); after emitting
  `exit`, subsequent reads reject with `closed`.
- **Exit with queued requests**: two in-flight reads each reject exactly once
  with `managed storage broker exited`; post-exit reads reject with `closed`;
  `close()` is idempotent.

### Required proof — command results (this run)

```
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
cd packages/server

npx vitest run src/fs/adapters/local.test.ts src/fs/adapters/local.integration.test.ts src/fs/managed-storage-broker.test.ts src/fs/routes-files.test.ts src/routes/legacy-files.test.ts
  # Test Files  5 passed (5), Tests  41 passed (41)

npm run build
  # tsc: no errors

npx vitest run
  # Test Files  232 passed (232), Tests  2507 passed (2507), exit code 0
  # no unhandled EPIPE/error; Vitest exits cleanly

git diff --check
  # clean
```

Supervisor final gate proof after this repair:

- `ctrl:gate` under Node 22 passed with **232/232 files, 2507/2507 tests** and no unhandled EPIPE.
- configured `test:live` passed against sandbox `127.0.0.1:3007` (49 tasks and effective config).
- configured read-only `test:deploy` passed against production (task-count and DB-symlink integrity only; no deployment or mutation).
- one intermediate full-suite attempt hit an unrelated loopback `ETIMEDOUT` in `agent-registry-routes.test.ts`; its isolated suite immediately passed **9/9**, and the next full unit gate passed **2507/2507**.

Immutable external receipts/logs live under the runner root; exact final commit SHA is recorded there because a commit cannot embed its own SHA.

## Tests added (adapter — prove the typed mapping)

`src/fs/adapters/local.test.ts` new cases:

- broker `not_found` read → `"ENOENT: no such file or directory"` (for `read`
  and `readRaw`);
- broker `invalid` (symlink escape) read → `"Access outside source root is not allowed."`;
- oversized read without explicit `maxBytes` → 16 MiB `SourceReadLimitError`.

## Required proof — command results

```
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
node scripts/build-managed-storage-broker.mjs
  # -> "native core and IPC entrypoint: compile and direct tests passed; installed broker ..."

cd packages/server
npx vitest run src/fs/routes-files.test.ts src/routes/legacy-files.test.ts
  # Test Files  2 passed (2), Tests  19 passed (19)

npx vitest run src/fs/adapters/local.test.ts src/fs/adapters/local.integration.test.ts src/fs/managed-storage-broker.test.ts src/fs/routes-files.test.ts src/routes/legacy-files.test.ts
  # Test Files  5 passed (5), Tests  39 passed (39)

npm run build
  # tsc: no errors

npx vitest run                       # full server suite (time permitted)
  # Test Files  232 passed (232), Tests  2505 passed (2505)

git diff --check
  # clean (no whitespace errors)
```

`ctrl:full` was NOT rerun, per instructions.

## Files changed

- `packages/server/src/fs/adapters/local.ts`
- `packages/server/src/fs/adapters/local.test.ts`
- `packages/server/src/fs/managed-storage-broker.ts`
- `packages/server/src/fs/managed-storage-broker.test.ts` (new focused EPIPE/exit-race tests)
- `docs/plans/evidence/entity-document-integrations/T-040/FINAL-INTEGRATION-REPAIR.md` (this file)
