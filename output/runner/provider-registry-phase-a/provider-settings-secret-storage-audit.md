# PR-A-04 — Server Provider Settings & Secret Storage Audit

**Issue:** THE-736 / PR-A-04  
**Proof type:** Secret-location map  
**Source SHA:** SuperSpec `4eaafc6815db1d731b0683ae4bf54096e64cc30e91a2b89d984fccc520ebd733`  
**Worktree HEAD:** `a87a6fd9527f06654291be174c88f7271ad5db66`

## Known seam

`packages/server/src/agent/settings.ts` + `packages/server/src/config/settings-store.ts` + `packages/db/src/entity-db.ts`

## Settings persistence model

| Key | Table | Shape | Updated by |
| --- | --- | --- | --- |
| `taskAgent.settings` | `app_settings` | `{ provider, model, apiKeys: Record<provider,string>, baseUrls: Record<provider,string>, staleThresholdHours, maxActionsPerScan }` | Task Master Admin UI via `setSettingJson` |
| `config.runtime` | `app_settings` | Full/partial Entity config blob including optional `providers[id].apiKey` plaintext | Onboarding (`OnboardingFlow.tsx` → `PATCH /api/settings/config/runtime`) and Admin config routes (`config/routes.ts`) |
| `docIntelligence.settings` | `app_settings` | `{ enabled?: boolean }` only | `admin-ui` |
| `docNotes.*` | `app_settings` | note arrays | `doc-intelligence` |

Table DDL (`ensureAppSettingsTable`):

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
```

DB path resolution: `ENTITY_TASK_DB_PATH` else `packages/db/entity-tasks.db` via `resolveEntityDbPath()`; server config may set `ENTITY_TASK_DB_PATH` from `server.databasePath` (`./data/entity.sqlite` default).

## Secret-location map

| Location | What is stored | Exposed to clients? | Notes |
| --- | --- | --- | --- |
| `app_settings` → `taskAgent.settings.apiKeys[provider]` | **Raw API keys** (plaintext JSON) | No — `getTaskAgentSettings` omits keys | Primary Task Master store; Phase C/D must migrate via `legacy_setting_ref` |
| `app_settings` → `config.runtime.providers[id].apiKey` | **Raw API keys** (plaintext JSON) when onboarding/admin saves provider runtime | GET `/api/settings/config*` uses `buildEffectiveConfig` → `redactSecrets` (`[REDACTED]`) | **Second plaintext store.** Write path: `OnboardingFlow.tsx` + `config/routes.ts` `setSettingJson(..., 'config.runtime')`. Prod structure audit (presence-only): `config.runtime` exists; `providers` map empty at audit time (no non-empty apiKey fields). Still in-scope for secret cleanup / migration decision — do not leave orphaned after Task Master migration. |
| Process env (provider `envKeys`) | Raw keys | Names may appear in UI hints | DB key wins over env for Task Agent |
| Base URL DB / env | Non-secret | Yes / source label | Scheme-only validation |
| Managed secret facility | **Not found** | N/A | No `managed_secret_ref` |
| Separate Docs credentials | None | N/A | Docs inherit Task Master |
| Browser `localStorage` / `sessionStorage` / IndexedDB | **No provider API keys persisted** | N/A | `TaskMasterSettings` keeps `draftApiKey` in React component state only (cleared after save). DocsSettings has no key field. App localStorage uses include theme, user profile, chat offline queue, and optional `entity-api-token` (Entity API bearer — not a model provider key). IndexedDB used for offline cache, not provider secrets. |

## Resolution order (Task Master)

1. Normalize provider/model from stored settings (invalid provider → `google` on read; assert on write).
2. API key: `stored.apiKeys[provider]` if non-empty → source `database`; else env walk → `env`; else `none`.
3. Base URL (openai / openai-compatible only): DB → env → default (`https://api.openai.com/v1` for openai) → none.
4. Language model factory (`getTaskAgentLanguageModel`) returns `null` when no key (graceful degrade).

## Redaction behavior

| Surface | Behavior |
| --- | --- |
| `getTaskAgentSettings()` / `GET /api/agent/settings` | Never returns `apiKeys` |
| `GET /api/agent/status` | Booleans + source enum only |
| `PATCH /api/agent/settings` | Accepts `apiKey` write-only; response is redacted view |
| Logs | Settings read failures log message only; keys not intentionally logged |

## Audit-time DB observation (canonical Mac data, read-only)

Canonical `/Users/enterprise/Code/entity/data/entity.sqlite` `app_settings` keys present:

- `onboarding.state`
- `plugin.entity-services.configDefaults`

**No `taskAgent.settings` / `docIntelligence.settings` rows** in that file at audit time (keys configured only via env or never saved in this DB). No raw keys extracted or copied.

## Scope classification (feeds OQ-003)

Current Task Agent settings are **global process/DB scoped** (single `app_settings` key), not workspace-/user-scoped.

## Acceptance

- [x] Secret-location map produced
- [x] No raw secrets copied into artifact
- [x] Managed-secret gap recorded
