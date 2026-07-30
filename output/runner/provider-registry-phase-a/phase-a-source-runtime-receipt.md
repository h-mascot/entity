# PR-A-01 — Source / Runtime Receipt

**Issue:** THE-733 / PR-A-01  
**Generated:** 2026-07-29T16:15:00Z (approx)  
**Coder:** Cursor Agent `grok-4.5`  
**Lane:** audit / design-freeze only (no implementation)

## Source authority verification

| Artifact | Expected | Observed | Status |
| --- | --- | --- | --- |
| Oracle SuperSpec path | `.../2026-07-29-entity-provider-registry-task-master-superspec-oracle.md` | Present | OK |
| Oracle SuperSpec SHA-256 | `4eaafc6815db1d731b0683ae4bf54096e64cc30e91a2b89d984fccc520ebd733` | `4eaafc6815db1d731b0683ae4bf54096e64cc30e91a2b89d984fccc520ebd733` | MATCH |
| Linear load receipt | `.../2026-07-29-provider-registry-linear-load-receipt.json` | Present; `status=loaded`; 9 parents / 90 children | OK |
| Linear live map | `.../2026-07-29-provider-registry-linear-live-map.md` | Present; Phase A children THE-733..THE-744 under THE-724 | OK |
| Entity context | `/Users/enterprise/Enterprise/Crew Home/Memory/Projects/entity/context.md` | Present | OK |
| Entity LIVE | `/Users/enterprise/clawd/memory/Projects/entity/LIVE.md` | Present (2026-07-29 Doc Hub PR #51 note) | OK |

Linear issue mapping for Phase A matches the approved queue and live map: THE-733..THE-744 ↔ PR-A-01..PR-A-12, parent THE-724.

## Repository / git state

| Field | Value |
| --- | --- |
| Worktree | `/Users/enterprise/Code/entity-provider-registry-phase-a-runner` |
| Branch | `runner/provider-registry-phase-a-grok45-20260729` |
| HEAD SHA | `a87a6fd9527f06654291be174c88f7271ad5db66` |
| `origin/main` | `a87a6fd9527f06654291be174c88f7271ad5db66` |
| Base (prompt) | `origin/main` at `a87a6fd9527f06654291be174c88f7271ad5db66` |
| Dirty state (start) | Clean (`git status --porcelain` empty) |
| Fresh fetch | `2026-07-29T17:15:09Z` — `git fetch origin main` succeeded |
| Upstream divergence (`origin/main...HEAD`) | `0 0` (identical); HEAD = `origin/main` = `a87a6fd9527f06654291be174c88f7271ad5db66` |
| Dirty/untracked (final) | Only force-added Phase A artifacts under `output/runner/provider-registry-phase-a/` (25 staged paths); no unrelated code dirty |
| Canonical source workspace | `/Users/enterprise/Code/entity` |
| Unrelated dirty changes | None outside Phase A runner artifacts |

## Runtime / host

| Field | Value |
| --- | --- |
| Host OS | macOS 26.4 (Build 25E246), darwin arm64 |
| Shell Node (audit host) | `v26.5.0` / npm `11.17.0` |
| Worktree `node_modules` | Absent at start (canonical `/Users/enterprise/Code/entity/node_modules` present) |
| Worktree `entity.config.yaml` | Absent (gitignored; not created — audit-only) |
| Canonical `entity.config.yaml` | Present; `server.port=3000`, `databasePath=./data/entity.sqlite` |
| Root `package.json` scripts | Has `build`, `test` (e2e browser), `test:unit`, `ctrl:gate`; **no** root `typecheck` script |
| Production runtime edits | Not performed |

## Database paths (read-only inspection)

| Role | Path | Notes |
| --- | --- | --- |
| Config default | `./data/entity.sqlite` | schema default / canonical config |
| Env override | `ENTITY_TASK_DB_PATH` | runtime.ts |
| **Sandbox live DB** | `/Users/enterprise/Code/entityprivate/packages/db/entity-tasks-sandbox.db` | From `com.claw.entity-sandbox`; `user_version=0`, WAL; ~7.2MB |
| **Prod live DB** | `/Users/enterprise/Code/entityprivate/packages/db/entity-tasks.db` | From `com.claw.entity-server`; `user_version=0`, WAL; ~245MB |
| Canonical Mac data | `/Users/enterprise/Code/entity/data/entity.sqlite` | Dev checkout DB; `user_version=0` |
| Canonical packages DB | `/Users/enterprise/Code/entity/packages/db/entity-tasks.db` | Package default file |
| Worktree DB | None | Fresh runner worktree |

Schema version mechanism: **`PRAGMA user_version` unused (=0)** on sandbox, prod, and canonical. Migrations are ensure-on-open / plugin ledger (see sqlite audit).

**Boundary:** Live DBs inspected read-only / online-backup to `/tmp` only. No production runtime source files edited.

## Live runtime identity (observed, not mutated)

| Endpoint | Result |
| --- | --- |
| `http://127.0.0.1:3000/api/version` | Reachable; reports `environment=prod`, `gitSha=65727f5584fe5ad9ab0b307541e5706c7c853e21`, release under `entity-prod/releases/96ad2bab63f02bc47041a58565e5397dee36c7a5`, Node `v22.22.1` |
| `http://sandbox.entity/api/version` | Reachable; `environment=sandbox`, `gitSha=b8e3c12108028afb5180c79468eaee2d83d79bd1` |
| Sandbox `current` symlink | `.../entity-sandbox/releases/b8e3c12108028afb5180c79468eaee2d83d79bd1` |
| Prod `current` symlink | `.../entity-prod/releases/96ad2bab63f02bc47041a58565e5397dee36c7a5` |

**Note vs LIVE.md / live sandbox current:** LIVE.md recorded sandbox at `a87a6fd` after Doc Hub PR #51. At audit wall-clock, sandbox `current` may be newer (`b8e3c121`). **Phase A code audit and application restore proof are pinned to `a87a6fd`** (worktree HEAD + `entity-sandbox/releases/a87a6fd…`). Do not mix auth/security conclusions across SHAs.

## Commands run (PR-A-01)

```bash
cd /Users/enterprise/Code/entity-provider-registry-phase-a-runner
git status --short
git rev-parse HEAD
shasum -a 256 "<SuperSpec path>"
# path existence checks for load receipt, live map, context, LIVE
# read-only ls/file on canonical DB paths
# curl /api/version (local :3000 and sandbox.entity)
```

**Install deviation:** `npm install` not run for PR-A-01. Dependencies absent in this worktree; audit-only receipt does not require install. Documented for later verification steps. Root has no `typecheck` script (`npm run typecheck --if-present` would no-op).

## Secret redaction check

- No API keys, tokens, or credential values copied into this receipt.
- Config inspection limited to non-secret keys (`host`, `port`, `databasePath`, URLs).
- `gh auth status` showed masked token form only; not recorded beyond “gh logged in”.

## Acceptance

- [x] Repository, SHA, dirty state recorded
- [x] Runtime and DB paths recorded
- [x] Source SHA tied to SuperSpec `4eaafc68…ebd733`
- [x] No secrets exposed
- [x] No prod runtime files edited
