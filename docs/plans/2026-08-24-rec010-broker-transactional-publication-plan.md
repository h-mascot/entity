# Plan: REC-010 broker transactional publication + build lock (repair round 2)

Run: `entity-deploy-reconciliation-20260824` — bounded repair round 2 of 3.
Round 3 addendum: generation 9's RED run deadlocked — the holder fixture
orphaned the blocking compiler wrapper, which kept the test runner alive via
inherited stdio pipes after the TAP summary. Round 3 makes holder teardown
deterministic (owned process group/session, gate-file release + SIGTERM/SIGKILL
escalation + stream destroy on every path, bounded subtest timeouts) before
implementing GREEN. Acceptance criteria unchanged.
Round 4 addendum (Henry-authorized, final of max 4): Luna-high generation 11
settled CHANGES_REQUESTED at 08c5653 — `readLockRecord()` treated parseable
but structurally/semantically invalid same-host lock JSON as stale because
invalid/missing pids flowed into `isPidAlive()` and were reclaimed. Round 4
validates the complete writer schema (plain non-array object; positive
int32-range integer `pid`; non-empty string `hostname`; canonical ISO-8601
`startedAt` that round-trips through `toISOString()`; non-empty string
`nonce`; no unknown fields) inside `readLockRecord()` BEFORE stale evaluation,
so every malformed record fails closed untouched. Live-holder, foreign-host,
stale-dead-holder, symlink, transaction, rollback, and cleanup behavior is
unchanged; stale/foreign/live fixtures now carry writer-consistent nonces.
Branch: `fix/clean-checkout-broker-build` at clean HEAD `2e4f1f8526d720c2a3d8f3051ec71e74b0f54294`.
Scope: exactly the two Luna-high findings on `scripts/build-managed-storage-broker.mjs`.
Not in scope: push/merge/deploy, server consumer module, dirty canonical Entity, sandbox runtime.

## Findings (fixed contract)

- P1 mixed generations: four independent publish renames (`.o`, `test`, source
  `broker`, runtime `broker`); a failure after an earlier rename leaves mixed
  generations. Consumers: runtime `broker` (prod candidate 1) and source
  `broker` (dev candidate 1 / prod fallback) via
  `resolveManagedStorageBrokerExecutable`. `.o`/`test` are not consumed.
- P2 single-writer assumption documented but not enforced.

## Design (smallest robust)

Publication transaction (P1), order preserved object → test → broker → runtime:

1. Snapshot: for each existing final (validated regular under lock), same-dir
   hardlink backup `.name.bak-<nonce>`; verify backup inode === final inode
   (fail closed on swap). Prior generation is never absent from its path.
2. Publish: atomic same-dir `renameSync(temp, final)` per artifact.
3. Rollback on any failure: reverse order, `renameSync(backup, final)` restore
   (or `rm` final when no prior generation); collected rollback errors become a
   loud combined `rollback incomplete` failure and remaining backups are kept as
   forensics. Clean rollback removes leftover backups; success removes backups.
4. Deterministic injection `ENTITY_BROKER_BUILD_FAIL_AT` (comma-separated,
   fires once each) at labels `snapshot-*/publish-*/rollback-*`
   `{object,test,broker,runtime}`; unknown label fails immediately.

Exclusive build lock (P2):

- `broker-build.lock` inside validated real source `.build/` dir; held from
  staging (compile) through publication and cleanup.
- Atomic creation: write full JSON record (`pid`, hostname, startedAt, nonce)
  to unique temp, `linkSync(temp, lockPath)` — no empty-lockfile window.
- EEXIST analysis: symlink/non-regular → fail closed; live pid (EPERM counts as
  alive), foreign hostname, unparseable record → fail fast non-blocking with
  holder details. Stale (same hostname + dead pid) → steal via
  re-verify + `renameSync` claim + claim-content check (restore-if-absent when
  a live lock was claimed by race) + one retry.
- Release only when lock content still equals ours.

## Steps

- [x] 1. RED: `scripts/entity-build-broker-transaction.test.mjs` — per-boundary
      publish failure restores prior generation (all 4 byte-identical);
      no-prior-generation failure publishes nothing; snapshot failure no-op;
      rollback-incomplete fails loud with combined error.
- [x] 2. RED: lock tests — concurrent invocation fails fast without disturbing
      holder; stale dead-pid same-host lock stolen; live-pid/foreign/garbage
      lock fails closed; lock removed after failure; symlinked lock path fails
      closed.
- [x] 3. Extract shared fixtures to `scripts/broker-build-test-helpers.mjs`
      (preserveOutputs now excludes lock/backup/temp names); rewire
      `entity-build-broker-wiring.test.mjs`; add new file to `test:release-deploy`.
- [x] 4. GREEN: implement transaction + lock + injection in
      `scripts/build-managed-storage-broker.mjs`.
- [x] 5. Focused suites serially under node@22: `npm run test:release-deploy`.
- [x] 6. Native broker direct C tests run inside build (existing) + verify
      source/runtime broker executable + byte-identical after success.
- [x] 7. Node 22 exact-worktree root build (`npm run build`).
- [x] 8. `git diff --check`; full `5169cce..HEAD` diff + status review;
      secret/private-default scan (`node scripts/scan-private-defaults.mjs`);
      refresh `openwiki/.entity-openwiki.json` fingerprint metadata only
      (page content unchanged, matching the 2e4f1f8 precedent) and re-run
      `npm run docs:wiki:verify`.
- [x] 9. Commit locally (no push/merge/deploy). Final report (no self-approval).
- [x] 10. Round 4 RED: table-driven malformed same-host lock-schema subtests
      (missing/zero/negative/fractional/string/out-of-range pid; missing/empty/
      non-string hostname; missing/empty/non-string nonce; missing/numeric/
      unparseable/non-canonical startedAt; extra field; null/array/string/
      number/boolean records) assert nonzero exit + byte-identical lock + no
      publication. Verified failing against 08c5653 (missing-pid case stolen).
- [x] 11. Round 4 GREEN: `lockRecordSchemaError()` + wiring in
      `readLockRecord()`; transaction suite 12/12 under node@22.
- [x] 12. Round 4 proofs: full `test:release-deploy`, root build,
      fingerprint-metadata refresh + `docs:wiki:verify` (08c5653 precedent),
      `git diff --check`, private-default scan, full diff review, commit.

## Files touched (expected)

- scripts/build-managed-storage-broker.mjs
- scripts/broker-build-test-helpers.mjs (new)
- scripts/entity-build-broker-transaction.test.mjs (new)
- scripts/entity-build-broker-wiring.test.mjs (fixture import only)
- package.json (test:release-deploy adds new test file)
- docs/plans/2026-08-24-rec010-broker-transactional-publication-plan.md

## Verify commands (all under node@22: /opt/homebrew/opt/node@22/bin)

- `npm run test:release-deploy`
- `npm run build`
- `git diff --check`

## Resume

`git status`; find first unchecked step; continue. Do not push/merge.
