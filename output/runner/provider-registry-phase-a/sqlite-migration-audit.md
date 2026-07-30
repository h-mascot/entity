# PR-A-05 — SQLite Schema & Migration Framework Audit

**Issue:** THE-737 / PR-A-05  
**Proof type:** Schema/migration receipt (SuperSpec §4.5)  
**Source SHA:** SuperSpec `4eaafc6815db1d731b0683ae4bf54096e64cc30e91a2b89d984fccc520ebd733`  
**Worktree HEAD:** `a87a6fd9527f06654291be174c88f7271ad5db66`

## §4.5 checklist

| Item | Answer |
| --- | --- |
| Migration framework | Core: idempotent `CREATE TABLE IF NOT EXISTS` + ad-hoc `ALTER` in TS (`packages/db/src/*`, `settings-store.ts`). Plugin: SQL files + `plugin_migrations` ledger (`packages/server/src/plugins/migrations.ts`). `PRAGMA user_version` unused (=0). |
| Transaction conventions | Plugin migrations wrap `exec(sql)` + ledger insert in `db.transaction()`. Core ensure-schema paths are generally non-transactional multi-statement `exec`. Data helpers in `db/src/index.ts` use explicit transactions for some inventories. **Phase B DDL should use a single transaction per migration file** mirroring plugins. |
| `foreign_keys=ON` every app connection? | **Yes** — `packages/db/src/entity-db.ts` `configureDatabase`. |
| Journal mode / backup method | App sets `journal_mode=WAL`. Operational backup: **SQLite online `.backup`** (rehearsed). Raw live file copy while writing is **not** acceptable. |
| Online backup supported? | **Yes** — verified with `sqlite3 <db> ".backup '…'"`. |
| How migrations tested in sandbox | No dedicated core migration test harness found. Plugin migrations have unit tests (`plugins/migrations.test.ts`). Sandbox practice today: deploy release + boot. **Phase B must add migration tests + sandbox apply.** |
| Old code vs additive unknown tables? | Old code uses ensure-on-open and ignores unknown tables; SQLite permits extra tables. SuperSpec §11.10 requires normal rollback to **retain** additive tables. Compatible if new code is feature-flagged off. |
| Current schema copy (secrets omitted) | `schema-redacted-sandbox.sql`, `schema-redacted-canonical-mac.sql` |
| Row-count + settings-key inventory | `row-counts-sandbox.txt`, `row-counts-canonical-mac.txt`; sandbox `app_settings` keys: `onboarding.state` only |
| Backup location / retention / checksum / restore | See `provider-registry-backup-restore-receipt.md` |

## Database path model

| Mechanism | Behavior |
| --- | --- |
| `resolveEntityDbPath()` | `ENTITY_TASK_DB_PATH` else `packages/db/entity-tasks.db` |
| Server config | May set env from `server.databasePath` (default `./data/entity.sqlite`) |
| Sandbox live path | `/Users/enterprise/Code/entityprivate/packages/db/entity-tasks-sandbox.db` |
| Documents DB | Optional `ENTITY_DOCUMENTS_DB_PATH` |

## Implications for Phase B

1. Add additive registry migration ledger (mirror `plugin_migrations`).
2. Do not rely on `user_version` unless introduced deliberately.
3. Keep `app_settings` intact for legacy fallback.
4. Normal rollback: **never drop** registry tables.

## Acceptance

- [x] §4.5 inventory answered
- [x] Redacted schema + row counts attached
- [x] Online backup proven (see backup-restore receipt)
