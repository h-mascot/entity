# PR-A-12 — Final Migration & Rollback Plan

**Issue:** THE-744 / PR-A-12  
**Proof type:** Approved plan (design-freeze proposal)  
**Source SHA:** SuperSpec `4eaafc6815db1d731b0683ae4bf54096e64cc30e91a2b89d984fccc520ebd733`  
**Worktree HEAD:** `a87a6fd9527f06654291be174c88f7271ad5db66`  
**Depends on:** PR-A-01…PR-A-11 artifacts in this folder

## Goals

Migrate Entity from global Task Master plaintext provider settings to a **Provider Registry** with profile/bindings, secret references, health tests, and Task Master stale-health UX — **without** breaking Task Master or Doc Intelligence during rollout.

## Non-goals (Phase A freeze)

- No Admin Inference Providers UI yet (Phase E)
- No Convert-heavy work (Phase H seam only later)
- No prod promotion from this runner
- No execution-engine / TTS unification

## Target end-state (summary)

1. Additive SQLite registry tables (profiles, models, capabilities, bindings, health checks, optional audit).
2. Secret resolution via `env_ref` + `legacy_setting_ref` (no managed secrets yet — OQ-005).
3. Explicit consumer bindings covering **every** current `getTaskAgentLanguageModel()` caller:
   - `task_master` — TaskAgent scans/triggers
   - `task_comment_responder` **or** bind under `task_master` (proposed default: share `task_master`)
   - `doc_intelligence` — Doc Intelligence ask + settings
   - `document_comment_responder` **or** bind under `doc_intelligence` (proposed default: share `doc_intelligence`)
   Product must confirm OQ-009 mapping before removing legacy fallback.
4. Task Master UI binds to profile/model; retains human-gate/review controls; gains health aggregator + Smoke Test + Run Now reuse.
5. Legacy `app_settings['taskAgent.settings']` retained for fallback window (OQ-019 still open for duration).

### Current consumer inventory (SuperSpec §4.3)

| Code path | Settings dependency | Proposed consumer key |
| --- | --- | --- |
| `agent/index.ts` TaskAgent | `getTaskAgentLanguageModel` / settings | `task_master` |
| `agent/comment-responder.ts` | `getTaskAgentLanguageModel` / settings | share `task_master` (confirm) |
| `agent/document-comment-responder.ts` | `getTaskAgentLanguageModel` | share `doc_intelligence` (confirm) |
| `routes/doc-intelligence.ts` ask + settings view | settings + language model | `doc_intelligence` |

## Migration phases (post–Phase A)

| Phase | Work | Rollback posture |
| --- | --- | --- |
| B | Domain types + additive schema + repos + serializers (**only after** restore rehearsal receipt) | **Keep tables**; disable registry resolution / ignore unknown tables in old code (SuperSpec §11.10 — normal rollback must not drop additive tables) |
| C | Secret refs + adapter registry + SSRF + health-test engine | Feature-flag off; legacy settings path unchanged; tables retained |
| D | Backfill profiles/bindings from legacy; dry-run; **repeat** sandbox backup/restore around backfill | Prefer code/feature rollback; **DB restore only** for corruption/failed backfill (see backup section) |
| E | Admin Inference Providers UI/API | Hide nav flag; APIs read-only/disabled; tables retained |
| F | Task Master binding UI + stale health + Smoke/Run Now | Fall back to legacy settings reads; tables retained |
| G | Docs binding UX (break inheritance language) | Re-enable inherit-from-TM fallback; tables retained |
| H | Convert readiness seam only | N/A |
| I | Release gates, secret scan, observation | Promote only verified SHA |

## Data migration rules

1. **Never delete** legacy `apiKeys` during initial backfill; copy to `legacy_setting_ref` pointers.
2. Backfill is **idempotent** (Phase D).
3. Effective config after backfill must match pre-migration provider/model/key-source behavior.
4. Docs remains coupled until Phase G explicit binding exists.
5. No raw keys in API/UI/logs/receipts at any phase.
6. Profiles are **disabled, not deleted**, in v1 (SuperSpec invariant).

## Rollback plan

Treat **code rollback** and **database restore** as separate operations (SuperSpec §11.10).

### Code / feature rollback (normal)

1. Redeploy previous known-good release SHA (sandbox first).
2. Ensure `ENTITY_AGENT_ENABLED` and env keys unchanged.
3. Disable registry resolution (feature flag / resolver falls back to legacy settings).
4. **Retain additive registry tables** — old code must boot against unknown tables; do **not** drop them during normal rollback.
5. New profile/binding edits made after cutover may be ignored by old code; runbook must state this explicitly.

### Database restore (exceptional only)

Use DB restore only for:

- Failed/corrupt backfill
- Accidental destructive data change
- Explicit disaster recovery

Not for ordinary feature rollback.

### WAL-safe backup method (required before Phase D sandbox/prod cutover)

Observed journal mode on app connections: **WAL** (`entity-db.ts`).

**Approved backup procedure (sandbox rehearsal required):**

1. Quiesce writers if operationally required, **or** use SQLite online backup API / `.backup` against a live connection (do **not** raw-copy the main DB file while writers are active without an audited online-backup mechanism).
2. Produce a timestamped backup bundle under a dedicated sandbox path, e.g.  
   `/Users/enterprise/Services/entity-sandbox/backups/provider-registry/<UTC-timestamp>/`  
   containing:
   - `entity.sqlite` (or configured `ENTITY_TASK_DB_PATH` basename) via online backup
   - companion `-wal`/`-shm` only if the chosen method requires a consistent cold copy after checkpoint
3. Record **SHA-256** of the retained backup primary file in the restore receipt. Verify that retained backup by recomputing its checksum; compare live source state separately with logical schema, key-set, and row-count checks because SQLite online backups may not byte-match mutable WAL source files.
4. Retention: keep at least the last **N=5** sandbox rehearsal backups and the pre-cutover prod backup until OQ-019/OQ-028 observation windows close (exact N confirmable by release owner).
5. **Restore verification (mandatory):**
   - Restore into an **isolated** path (never overwrite live `current` in place as the first step)
   - Point a throwaway **real Entity server** (same git SHA as the audited tree) at the restored file via `ENTITY_TASK_DB_PATH`
   - Verify: `PRAGMA integrity_check;`, row-count smoke for core tables, `GET /api/health` → `service=entity-server`
   - Compare `app_settings` **key set** to the pre-backup source snapshot (names only). Require `taskAgent.settings` **only if it existed in the source**; absence is valid when Task Master is env-only / never saved
   - If proving secret redaction, insert a **sentinel** key only into the isolated copy (never into live DB), then confirm `/api/agent/settings` returns `apiKeyConfigured` without `apiKeys` / sentinel material
6. File copy of a live WAL database **without** online backup or a clean checkpointed shutdown is **not acceptable**.

### Feature rollback

1. Resolver order: explicit binding → legacy fallback (D-07).
2. Keep fallback until OQ-019 window ends.

## Preconditions to exit Phase A

- [x] Audits A-01…A-10 complete
- [x] OQ-001–018 ledger proposed (OQ-007/009/011 corrected from review)
- [ ] Henry sign-off on ledger (especially OQ-001/003/009/015)
- [ ] Engineering sign-off on OQ-002 migration ledger approach
- [ ] Security sign-off on OQ-004/005/016
- [x] **Sandbox WAL-safe backup + isolated restore rehearsal receipt** — `provider-registry-backup-restore-receipt.md` (incl. throwaway `/api/health` + redacted settings)
- [ ] THE-743 / THE-744 remain **In Review** until approvals recorded (not Done)
- [ ] No Phase B coding until owner sign-off

## Phase B entry gate (hard)

Phase B additive schema work may start only when **all** are true:

1. Decision ledger accepted/amended by required owners.
2. Backup/restore rehearsal receipt accepted (present; before DDL, verify the retained backup checksum and compare live sandbox separately using logical schema/key-set/row-count checks; do not require backup SHA to equal the mutable live WAL database file).
3. Consumer inventory (including comment responders) accepted.
4. `config.runtime` secret-store decision accepted (migrate vs explicit out-of-scope + cleanup).

## Verification commands (later phases; not run as mutations here)

```bash
cd /Users/enterprise/Code/entity-provider-registry-phase-a-runner
npm run build
cd packages/server && npx vitest run
curl -sS http://sandbox.entity/api/version
```

## Acceptance

- [x] Final migration/rollback plan produced from audit outputs
- [x] §11.10 table-retention rollback posture recorded
- [x] WAL-safe backup/restore procedure specified
- [x] Boundaries respected (audit/design-freeze only)
