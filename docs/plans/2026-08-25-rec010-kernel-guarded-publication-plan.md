# Plan: REC-010 kernel-guarded conditional publication (repair round 1 of 3)

Run: `entity-deploy-reconciliation-20260824` — bounded GLM-5.2 repair generation 20,
fixing the exact Luna-high generation-19 P1 finding at clean base `9ff26c5246969e89bbff82569dacd2e4037d7c28`.

## Finding (fixed contract)

Existing-final publication and rollback still perform a last identity check
followed by unconditional `renameSync`/`rmSync`. A final path or parent
directory swapped in that interval lets an unexpected outside canary be
overwritten or removed before the post-check detects it. Post-mutation
detection is NOT prevention.

## Design (smallest correct)

New native helper `packages/server/native/managed-storage-broker/fs_guard.c`,
compiled by the build script (same `CC`/flags) to a staging temp before the
transaction. Every guarded mutation is kernel-mediated, dirfd-anchored, and
either conditional or non-destructive-and-reversible:

1. `exchange <dir> <dirDev> <dirIno> <A> <aDev> <aIno> <B> <bDev> <bIno>` —
   anchor both entries (fstatat NOFOLLOW + openat O_NOFOLLOW/fstat pin), then
   `renameatx_np(..., RENAME_SWAP)` (macOS) / `renameat2(..., RENAME_EXCHANGE)`
   (Linux): an atomic kernel exchange that never overwrites or removes either
   side. Post-verify swapped identities; on drift, swap back and re-verify so
   any unexpected entry is restored byte-identically in place, then fail closed.
   Used for: publish over an existing final (A=temp, B=final) and rollback
   restore (A=backup, B=final).
2. `link-absent ...` — `linkat(dirfd, src, dirfd, dst, 0)`: kernel no-replace
   creation of an absent final (EEXIST fails closed). Used for publish of an
   initially absent final.
3. `remove-owned ...` — anchor `name` (openat O_NOFOLLOW fd-pinned, identity
   + nlink recorded), create a nonce tomb (O_CREAT|O_EXCL), move `name`→tomb
   with `RENAME_NOREPLACE` (kernel-conditional move; a foreign entry is only
   relocated, never destroyed), verify the tomb anchors the expected inode;
   on mismatch move it back (NOREPLACE, never overwriting a recreated name)
   and fail closed; on match unlink the tomb and audit via the pinned fd that
   exactly the verified inode lost its link. Used for: rollback removal of
   newly published artifacts, backup cleanup (rollback + success), and
   tracked-temp cleanup.
4. `selftest <dir> ...` — proves SWAP/NOREPLACE/linkat work on the actual
   volume before the transaction; filesystems without the primitives fail the
   build closed (no unsafe fallback).

All ops verify the parent directory identity against the anchor opened at
build start (parent-directory swaps fail closed), and run relative to the
dirfd they verified. Deterministic test hook `ENTITY_BROKER_GUARD_INNER_SWAP`
(token per guarded mutation, `@a` for the exchange A side) emulates an
attacker INSIDE the actual interval between the final ownership precheck and
the mutation syscall; tests must prove every canary stays byte-identical and
nothing unexpected is removed.

Preserved unchanged: ENOENT-only absence semantics, all-four-artifact
coverage, snapshot/forensic-backup flow, exclusive lock + malformed-lock
fail-closed behavior (the lock's own steal/restore/release mutations are
now also guarded through fs_guard), transaction rollback ordering,
JS-level swap hooks, FAIL_AT labels, native broker build, permissions,
clean-checkout wiring.

Additional hardening from Codex review rounds: run-scoped names carry 128
random bits (pid + ms + crypto random) so no external actor can know a
staging/backup/claim/tomb name before this run creates it exclusively;
every cc staging temp is exclusively pre-created (`wx`) before compile;
never-identity-tracked temps are never blindly removed (exclusively
pre-created ones are removed with the current identity through the
guarded conditional removal; anything else must be provably absent or the
cleanup fails loudly).

## Residual limit (honest, irreducible)

No kernel on any supported host offers unlink-by-inode, so exactly one
terminal `unlinkat` remains inside `remove-owned`: the tomb unlink, guarded
by (a) an unpredictable name that did not exist until the same helper
invocation created it as the destination of the kernel no-replace move,
(b) fd-pinned identity verification of the inode the move placed there,
(c) immediate adjacency of verify and unlink in single-threaded native
code, and (d) a post-unlink link-count audit that converts any replacement
into a loud failure. The same uniform residual class covers cc overwriting
an entry swapped onto an exclusively pre-created, cryptographically
unpredictable staging temp name after pre-creation, and the selftest's
cleanup of entries in its own freshly created unpredictable scratch
directory. No deterministic or schedulable injection point (including the
in-interval hook) can reach any of these; documented rather than hidden.
Defense-in-depth: the helper binary itself is identity-checked before
every execution. Parent-directory swaps inside the helper's own interval
are structurally harmless: every mutation is relative to the verified
directory descriptor, so it lands in the anchored (possibly moved)
directory and never in a replacement directory.

## Steps

- [ ] 1. `fs_guard.c` helper (exchange/link-absent/remove-owned/selftest,
      inner-swap hook) + direct compile proof under the build's exact flags.
- [ ] 2. Build-script integration: guarded publish (existing/absent), guarded
      rollback (restore/remove), guarded backup+temp cleanup, helper selftest
      gate, bigint identities passed exactly to the helper.
- [ ] 3. Tests: direct helper adversarial suite (inner-interval swaps on every
      op) + build-level inner-swap tests (publish first/last, absent-final,
      rollback restore, rollback remove, backup cleanup); existing suites stay
      green unchanged in behavior.
- [ ] 4. Correct generation-17 residual-limit claims in the round-2 plan doc;
      update script header comments.
- [ ] 5. Exact-worktree proof (node@22, serial, bounded): focused suites,
      `npm run test:release-deploy`, root build, wiki prepare/verify only if
      the source fingerprint requires it, `npm run scan:private-defaults`,
      `git diff --check 5169cce..HEAD`, full diff + clean status.
- [ ] 6. Commit in small auditable save-points; report SHAs, files, test
      counts, kernel guarantee, residual limit. No push/merge/deploy.

## Files touched (expected)

- packages/server/native/managed-storage-broker/fs_guard.c (new)
- scripts/build-managed-storage-broker.mjs
- scripts/entity-build-broker-transaction.test.mjs
- scripts/broker-build-test-helpers.mjs (transient-name pattern only)
- docs/plans/2026-08-24-rec010-broker-transactional-publication-plan.md (correction)
- docs/plans/2026-08-25-rec010-kernel-guarded-publication-plan.md (this file)
- openwiki fingerprint metadata (only if prepare requires it)

## Verify commands (node@22: /opt/homebrew/opt/node@22/bin)

- `node --test --test-concurrency=1 scripts/entity-build-broker-transaction.test.mjs`
- `node --test --test-concurrency=1 scripts/entity-build-broker-wiring.test.mjs`
- `npm run test:release-deploy`
- `npm run build`
- `npm run docs:wiki:prepare && npm run docs:wiki:verify` (fingerprint-gated)
- `npm run scan:private-defaults`
- `git diff --check 5169cce5592d930227bb28953c13607d245c5f80..HEAD`
