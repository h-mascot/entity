# Curacel Pilot — Clean-Target Database Restore Runbook (R7)

Authority scope: **Curacel pilot data-layer restore only**. This runbook
materializes a verified SQLite backup into a DISTINCT, ABSENT target database
file and repoints the Entity service at it, with an immutable-backup proof.

> ⚠️ **PRODUCTION AUTHORITY WARNING**
>
> This procedure, on its own, **does NOT authorize any change to the production
> Entity database** (`packages/db/entity-tasks.db` on the production host, or the
> production `ENTITY_TASK_DB_PATH`). Per repo policy, the production database is
> a forbidden target unless an explicit production change authority is granted by
> the maintainer, and even then changes must land through the canonical
> Mac → git → GitHub Actions CTRL Gate → `deploy.sh` flow. **Never** run this
> against production files by hand, never `rsync` without `--exclude='*.db'`,
> and never `git checkout`/`git stash` on `ada-gateway` (it overwrites the
> production DB). In cloud/dev VMs, operate only on throwaway temp paths.
>
> If you only have a local/dev DB and need to recover it, this runbook is safe
> against any **non-production** path.

## Deterministic proof

The file-level restore helper and its full behavior contract are proven by
`packages/db/src/curacel-restore.test.ts` (validation refusals, exclusive
publish via `linkSync` — including a concurrent target created after
validation, temp-partial cleanup, SHA-256 metadata, source immutability). The
executable CLI that wraps the helper is proven by
`packages/db/src/curacel-restore-cli.test.ts` (pure-core success/refusal/usage
**and** real `ts-node` subprocess execution). The end-to-end operational
restore is proven by `packages/db/src/curacel-backup-restore.test.ts` (SOURCE →
BACKUP → DISTINCT TARGET, app-layer verification, post-restore mutation,
immutable-backup proof). Run them with:

```bash
cd packages/db && npx vitest run src/curacel-restore.test.ts src/curacel-restore-cli.test.ts src/curacel-backup-restore.test.ts
```

## Helper

`restoreCleanTarget(sourcePath, targetPath)` in `packages/db/src/curacel-restore.ts`
performs the restore with these guarantees:

- Refuses `SAME_PATH` (target must differ from the backup).
- Refuses `TARGET_EXISTS` (never overwrites a real database).
- Refuses `SOURCE_NOT_FOUND` / `SOURCE_NOT_FILE`.
- Streams the backup into an `O_CREAT | O_EXCL` temp partial next to the target,
  `fsync`s it, then **exclusively hard-links** it onto the target (`linkSync`),
  which fails with `EEXIST` if a concurrent writer created the target after
  validation — a partial target is never visible at `targetPath`, and a
  concurrently created target is never overwritten.
- On any failure (validation, I/O, an `EEXIST` refusal from a concurrent
  publisher, or a post-publish checksum mismatch) the temp partial is removed;
  no `.curacel-restore.*.partial` litter.
- The backup is **only ever read** (read-only); it is never written, truncated,
  or appended.
- Returns SHA-256 checksum metadata for source and target plus a post-copy source
  stat so the caller can prove the backup is byte-for-byte immutable.

## Preconditions

1. You have a **canonical online backup** produced by the SQLite online `backup()`
   API (a single, self-contained snapshot file with **no** `-wal`/`-shm` sidecars).
   A live WAL database file copied directly is NOT a valid restore source — run
   `backup()` first.
2. The backup is on stable storage and you have recorded its SHA-256.
3. You are operating on a **non-production** path (dev/cloud VM throwaway paths).
4. Node 22 and the repo's `ts-node` toolchain are available on `PATH` (the CLI
   is plain TypeScript executed via `ts-node`, not a hand-rolled `cp`/`mv`).

## Step 1 — Stop the service (quiesce writers)

Before producing the backup (or before restoring), stop the Entity server so no
writes race the snapshot:

```bash
# stop the dev server (cloud VM dev topology)
pkill -f "packages/server" || true
# confirm port 3000 is free
lsof -iTCP:3000 -sTCP:LISTEN || true
```

The service is the only long-running writer; with it stopped the database is
quiescent and the online `backup()` snapshot is consistent.

## Step 2 — Record the backup SHA-256 (immutable-backup baseline)

```bash
BACKUP=/tmp/curacel/backup-20260804/entity-backup.sqlite
test -f "$BACKUP" || { echo "backup missing"; exit 1; }
BACKUP_SHA256=$(shasum -a 256 "$BACKUP" | awk '{print $1}')
BACKUP_SIZE=$(stat -f%z "$BACKUP" 2>/dev/null || stat -c%s "$BACKUP")
echo "backup=$BACKUP sha256=$BACKUP_SHA256 size=$BACKUP_SIZE"
```

Write `BACKUP_SHA256` and `BACKUP_SIZE` down. They are the immutability baseline —
the backup must read back these exact values after the restore.

## Step 3 — Prepare a DISTINCT, ABSENT target path

The target must be a **distinct** path that **does not exist yet**. The helper
refuses `SAME_PATH` and `TARGET_EXISTS`, so prepare an empty location:

```bash
TARGET=/tmp/curacel/restore-20260804/entity-restored.sqlite
test -e "$TARGET" && { echo "REFUSE: target already exists — pick a distinct empty path"; exit 1; }
# parent directory may exist and be empty; the file itself must NOT exist
mkdir -p "$(dirname "$TARGET")"
```

## Step 4 — Restore the backup into the clean target

Use the audited, **executable TypeScript CLI**
(`packages/db/src/curacel-restore-cli.ts`) through the repo's `ts-node`
toolchain. It invokes `restoreCleanTarget()` and emits exactly one JSON object.
**The exit code is nonzero on any refusal** (e.g. `TARGET_EXISTS`), so a script
branches on it directly.

From the repository root:

```bash
npx ts-node --transpile-only --project packages/db/tsconfig.json \
  packages/db/src/curacel-restore-cli.ts "$BACKUP" "$TARGET"
echo "restore exit=$?"
```

(Equivalent shorthand from inside `packages/db`:
`npm run restore:target -- "$BACKUP" "$TARGET"` — it runs the same
`ts-node --transpile-only --project tsconfig.json src/curacel-restore-cli.ts`.)

Output contract:

- **Success** → exit `0`, one JSON object on **stdout**:
  ```json
  { "ok": true,
    "result": {
      "sourcePath": "...", "targetPath": "...",
      "sourceSha256": "...", "targetSha256": "...",
      "sourceBytes": 1234, "targetBytes": 1234,
      "sourceStat": { "size": 1234, "mtimeMs": 1.0, "ino": 1, "dev": 1 } } }
  ```
- **Refusal / failure** → exit `2`, one JSON object on **stderr**:
  ```json
  { "ok": false, "error": { "code": "TARGET_EXISTS", "message": "..." } }
  ```
  `code` is one of `SAME_PATH`, `TARGET_EXISTS`, `SOURCE_NOT_FOUND`,
  `SOURCE_NOT_FILE`, `SOURCE_EQUAL_TARGET`, `IO_ERROR`, `CHECKSUM_MISMATCH`.
- **Usage error** (wrong argument count) → exit `64`, a help message on stderr.

On a `0` exit the CLI has already verified `targetSha256 == sourceSha256`
internally (a mismatch exits `2` with `CHECKSUM_MISMATCH` and removes the
corrupt target). Prove the **immutable backup** was not mutated by the
read-only restore:

```bash
test "$(shasum -a 256 "$BACKUP" | awk '{print $1}')" = "$BACKUP_SHA256" \
  || { echo "BACKUP_MUTATED"; exit 1; }
test "$(shasum -a 256 "$TARGET" | awk '{print $1}')" = "$BACKUP_SHA256" \
  || { echo "TARGET_MISMATCH"; exit 1; }
```

> ⚠️ **Do NOT fall back to a manual `cp`/`mv` onto the target.** A plain `mv`
> (rename) silently **overwrites** a target that a concurrent writer may have
> created after the pre-existence check, defeating the exclusive-publish
> guarantee. And a hand-rolled `cp` skips the streamed-checksum / `fsync` /
> temp-partial-cleanup invariants the helper enforces. The CLI's `linkSync`
> publish is the only supported path: it creates the target exclusively and
> refuses with `EEXIST` (`TARGET_EXISTS`) rather than overwriting. (Do **not**
> run the helper via `node -e ... require('./packages/db/src/curacel-restore')`
> either — plain `node` cannot load a `.ts` file; always go through `ts-node`.)

## Step 5 — Start the service pointed at the restored target

Point the service at the **target** (never at the backup — the backup is an
immutable artifact and must never be opened for writes):

```bash
ENTITY_TASK_DB_PATH="$TARGET" \
ENTITY_CLICKCLACK_SIDECAR=0 \
PORT=3000 \
npm run dev
```

`getEntityDatabase()` resolves `ENTITY_TASK_DB_PATH` to an absolute path and opens
it with WAL + `foreign_keys=ON`. The application repositories run their additive
`CREATE ... IF NOT EXISTS` schema ensure against the target — schema is **ensured,
not wiped**, and restored rows survive.

## Step 6 — Validate the restored target through the application

Run the deterministic restore proof (it exercises the full SOURCE → BACKUP →
TARGET path against throwaway temp DBs):

```bash
cd packages/db && npx vitest run src/curacel-restore.test.ts src/curacel-restore-cli.test.ts src/curacel-backup-restore.test.ts
```

Then smoke the running service:

```bash
curl -fsS http://localhost:3000/api/diagnostics | head
# spot-check a known restored pilot object through the API you normally use
```

Expect the restored orgs, tasks (including Task-Master lease ownership), task
handoffs, and evidence artifacts to read back through the application layer, and
a fresh task created post-restore to persist.

## Step 7 — Rollback

The restored target is a new file; rollback is simply to repoint the service at
the previous database path (or to re-run this runbook from the same backup into
another distinct empty target). **Do not delete the immutable backup** — it is
the recovery artifact.

```bash
# stop the service on the target
pkill -f "packages/server" || true
# repoint at the previous DB path and restart
ENTITY_TASK_DB_PATH="<previous-db-path>" ENTITY_CLICKCLACK_SIDECAR=0 PORT=3000 npm run dev
```

If the restore itself is bad, the helper never left a partial target (it removes
the temp partial and the corrupt target on checksum mismatch), so the previous DB
is untouched and you can retry from the same backup into a fresh distinct path.

## Out of scope

- **Production restores** require explicit production authority and must go
  through the Mac → git → CTRL Gate → `deploy.sh` pipeline. This runbook does not
  grant that authority.
- This runbook does not authorize destructive overwrites, broad deletions, or any
  mutation of the immutable backup artifact.
- Pointing the service at the backup file directly is forbidden: only the target
  is a writable service database.
