# Plan: REC-010 broker transactional publication + build lock (repair round 2)

Run: `entity-deploy-reconciliation-20260824` — bounded repair round 2 of 3.
Generation 17 addendum (Henry-authorized bounded repair of the two accepted
generation-15 P1 findings, clean base 2071998): dangling final symlinks were
treated as absent (`existsSync` follows links) and publication/rollback were
pathname-based TOCTOU. Fixed by ENOENT-only absence semantics plus the
descriptor-anchored no-replace design described in steps 13–15 and the script
header comment; acceptance = the new preservation/swap tests plus every
existing lock/transaction/rollback/cleanup/wiring behavior unchanged.
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
- [x] 13. Generation 17 (Henry-authorized, manager-run, bounded, non-
      production): RED table-driven preservation test over all four final
      artifacts × two flavors (dangling symlink / symlink to an outside
      canary) — dangling flavor proven failing against 2071998 (the build
      succeeded and renamed over the symlink). GREEN: `lstatOrNull()` makes
      ENOENT the only absence everywhere `existsSync()` was used on a
      build-owned path (final artifacts, rollback backups, lock-steal claim
      and restore check, output-directory components). Commit f2a7223.
- [x] 14. Generation 17 GREEN (second P1): descriptor-anchored ownership —
      per-final `{dev, ino}` pinned via open/fstat (lstat-classified first,
      cross-checked against the fd), per-directory anchors re-verified at
      every mutation boundary, absent finals published via `linkSync`
      no-replace (EEXIST + pre-check fail closed), existing finals identity-
      verified immediately before the atomic rename and post-verified as the
      staged inode, rollback only renames/removes the exact file this run
      published (unexpected replacement/vanished final/changed backup/
      swapped parent dir fail closed with forensics kept), backups dropped
      only while still anchoring the exact hardlink this run made. Test-only
      swap hooks (`ENTITY_BROKER_BUILD_SWAP_AT`, `_SWAP_DIR_AT`,
      `_SWAP_AT_ROLLBACK`) drive deterministic publish/rollback/parent-dir
      swap cases with outside-canary preservation. Commit 7dd7407.
- [x] 15. Generation 17 proofs (serial node@22.22.2): transaction+wiring
      suites 31/31 with `--test-concurrency=1`; `npm run test:release-deploy`
      97/97; root build green (direct native C broker tests exit 0);
      `npm run scan:private-defaults` exit 0; fingerprint-metadata refresh
      only (`writeGenerationMetadata`, 7d00bbfe…) + `docs:wiki:verify` green;
      `git diff --check 5169cce..HEAD` clean; full diff + status review.

## Generation 17 residual limits (as recorded then — CORRECTED by generation 20 below)

- Node 22 has no conditional-rename binding (`renameat2`/`renamex_np`) and no
  `flock`/`linkat(fd)`. The interval between the last identity pre-check and
  the replace rename is the exact boundary pure Node cannot close; every
  post-check converts a lost race there into a loud fail-closed with forensic
  backups kept. Closing it fully would need a native helper (out of scope).
- The pre-check→rename window is the only unclosable one. A swap landing
  between the anchor-open and the backup hardlink is caught by the backup
  inode cross-check (fail closed); a swap landing between the anchor and the
  publish pre-check is caught by the pre-check; a swap landing between the
  pre-check and the rename is caught by the post-check. Each guard fails
  closed rather than publishing over an entry the run cannot account for.
- `scripts/build-managed-storage-broker.mjs` is now 596 lines, above the
  ~500-line style guideline; kept intact for auditability of the security
  boundary rather than split mid-repair.

## Generation 20 correction (repair round 1 of 3, Luna generation-19 P1)

Luna generation 19 rejected the two claims above as a security conclusion:
**detection after an unconditional destructive syscall is not prevention** —
`renameSync`/`rmSync` executing after the last ownership check could already
have overwritten or removed an unexpected replacement before any post-check
ran. That boundary is now closed by the native `fs_guard` helper
(`packages/server/native/managed-storage-broker/fs_guard.c`, plan
`2026-08-25-rec010-kernel-guarded-publication-plan.md`): every publish/rollback
mutation is a kernel-conditional, dirfd-anchored operation (atomic
`RENAME_SWAP`/`RENAME_EXCHANGE` exchange reversed with the unexpected entry
restored byte-identically in place on drift; kernel no-replace `linkat` /
conditional move). Deterministic `ENTITY_BROKER_GUARD_INNER_SWAP` tests inject
the swap exactly inside the former interval. The honest residual is now only
the tomb-unlink adjacency documented in the generation-20 plan — never the
publication/rollback mutation itself.

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
