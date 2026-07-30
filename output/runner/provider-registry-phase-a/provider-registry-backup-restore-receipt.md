# provider-registry-backup-restore-receipt.md

**Phase A / SuperSpec §4.7 #6 & §11.2**  
**SuperSpec SHA:** `4eaafc6815db1d731b0683ae4bf54096e64cc30e91a2b89d984fccc520ebd733`  
**Audited / proof release SHA:** `a87a6fd9527f06654291be174c88f7271ad5db66`  
**Migration identifier:** `phase-a-audit-restore-rehearsal-20260729`

## Method

1. Online backup of sandbox DB file → owner-only `/tmp/entity-provider-registry-phase-a-review/` (`chmod 700`)
2. Isolated restore + sentinel `taskAgent.settings` (fake key only in the copy)
3. **Real Entity server from release `a87a6fd…`** (matches worktree audit SHA; path `…/entity-sandbox/releases/a87a6fd9527f06654291be174c88f7271ad5db66`)
4. Prove `/api/health` (`service: entity-server`) and `/api/agent/settings` redaction over HTTP

Note: live sandbox `current` may point at a newer SHA (`b8e3c121`); Phase A application proof deliberately used the **a87a6fd** release artifact to match the audited source tree.

Prod `/tmp` DB copies from an earlier pass were **deleted**. Prod path metadata remains recorded without retaining copies.

## Sandbox DB backup

| Field | Value |
| --- | --- |
| Source DB | `/Users/enterprise/Code/entityprivate/packages/db/entity-tasks-sandbox.db` |
| Journal / user_version / size | `wal` / `0` / `7200768` bytes |
| Backup retained path | `/Users/enterprise/Services/entity-sandbox/backups/provider-registry/20260729T170500Z-phase-a-rehearsal/entity-tasks-sandbox.db.bak` |
| Backup SHA-256 | `84058218948db55ba026dddb8c0e78bb70e8d9249c5f98f35ddcfed885e65cdb` |
| Retention | Dedicated sandbox backups dir; keep ≥5 rehearsals (this is #1 for provider-registry) |
| integrity_check | `ok` |
| Evidence | `schema-redacted-sandbox.sql`, `row-counts-sandbox.txt` |

## Application proof @ `a87a6fd`

| Probe | Result |
| --- | --- |
| Release cwd | `/Users/enterprise/Services/entity-sandbox/releases/a87a6fd9527f06654291be174c88f7271ad5db66` |
| `GET /api/health` | `status=ok`, `service=entity-server` |
| `GET /api/agent/settings` | Redacted DTO; `apiKeyConfigured=true`, `apiKeySource=database`; **no `apiKeys`**; sentinel string absent |
| Module path | `packages/server/dist/server/src/agent/settings.js#getTaskAgentSettings` also redaction-ok |

Sentinel restore DB copies deleted after proof.

## Prod identity (metadata only)

| Field | Value |
| --- | --- |
| Path | `/Users/enterprise/Code/entityprivate/packages/db/entity-tasks.db` |
| user_version / journal / tables | `0` / `wal` / `57` |

## Acceptance

- [x] Backup + checksum + size + schema version + migration id
- [x] Real entity-server health + HTTP settings redaction on **same SHA as audit**
- [x] Prod tmp copies purged
- [x] No raw secrets in receipt
