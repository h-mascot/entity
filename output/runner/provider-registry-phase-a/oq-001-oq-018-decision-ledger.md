# PR-A-11 — OQ-001–OQ-018 Decision Ledger

**Issue:** THE-743 / PR-A-11  
**Proof type:** Signed decision ledger (audit-proposed; Henry ratification required where noted)  
**Source SHA:** SuperSpec `4eaafc6815db1d731b0683ae4bf54096e64cc30e91a2b89d984fccc520ebd733`  
**Worktree HEAD:** `a87a6fd9527f06654291be174c88f7271ad5db66`  
**Ledger status:** `PROPOSED_FROM_AUDIT` — binding for Phase B+ only after Henry/owner confirmation on Henry-owned rows.

| ID | Question | Decision (audit-resolved) | Evidence | Owner sign-off needed? |
| --- | --- | --- | --- | --- |
| OQ-001 | Doc Hub A/B completed or Henry reordered? | **Treat Doc Hub A/B as completed for sequencing.** LIVE.md records Doc Hub governed fix pack PR #51 merged at `a87a6fd` with sandbox proof; Phase A proceeds on Provider Registry packet as loaded. | LIVE.md 2026-07-29; Linear load receipt | Henry confirm if any reorder intent differs |
| OQ-002 | Migration framework / schema version? | **Core: idempotent `CREATE IF NOT EXISTS` + ad-hoc ALTER; no `user_version`. Precedent: `plugin_migrations(plugin_id,filename)`. Phase B should add an additive registry migration ledger mirroring plugin migrations (or shared core ledger), not invent Flyway.** | `sqlite-migration-audit.md`, `plugins/migrations.ts`, `user_version=0` | Engineering OK as design freeze |
| OQ-003 | Provider settings scope? | **Global (process/DB `app_settings` key). Not workspace/user scoped today.** Registry bindings should start **global**, with future scope keys optional. | `provider-settings-secret-storage-audit.md` | Product confirm |
| OQ-004 | Where credentials live? | **(1)** `taskAgent.settings.apiKeys[provider]` plaintext in `app_settings`; **(2)** optional `config.runtime.providers[id].apiKey` plaintext via onboarding/admin config routes (GET redacted by `buildEffectiveConfig`); **(3)** env vars per provider `envKeys`; **(4)** no separate Docs keys. Phase C/D must cover both SQLite stores or explicitly de-scope `config.runtime` with a cleanup plan. | PR-A-04 | Security acknowledge |
| OQ-005 | Managed-secret facility? | **No.** `managed_secret_ref` not available; Phase C must support `env_ref` + `legacy_setting_ref` only unless a platform secret store is introduced later. | Code search / settings.ts | Platform confirm |
| OQ-006 | Operational adapter kinds today? | **`google`, `openai`, `openai-compatible`, `anthropic`, `xai`, `vercel-gateway`.** Swarm exec providers excluded. | PR-A-06 | — |
| OQ-007 | Task Master capabilities? | **Require `chat` (text generation) only.** `TaskAgent.invokeModel()` uses `generateText` without an AI SDK `tools` option; `TaskAgentTools` are deterministic app operations outside the model request. Do not gate Task Master bindings on provider-native tool calling. | `agent/index.ts` invokeModel | Task Master owner confirm |
| OQ-008 | Docs/Doc Intelligence capabilities? | **Require `chat` only** for ask path. | `doc-intelligence.ts` | Docs owner confirm |
| OQ-009 | Docs vs Doc Intelligence consumers? | **Doc Intelligence is one UI/settings consumer** inheriting Task Master today. **Additional code consumers of the same language-model settings** also exist: task `@mention` responder and document comment responder (both call `getTaskAgentLanguageModel()`). Registry plan: consumer keys at minimum `task_master` and `doc_intelligence`; **map comment responders explicitly** — default proposal: task comment responder → `task_master`; document comment responder → `doc_intelligence` (same model binding family) unless product splits them. Falling back to legacy settings until each mapping is bound. | PR-A-03; `comment-responder.ts`; `document-comment-responder.ts` | Product confirm |
| OQ-010 | Stale threshold source/unit? | **Canonical: `taskAgent.settings.staleThresholdHours.{doing,review}` with defaults 24/48; unit = hours.** | settings + AGENT_CONFIG | — |
| OQ-011 | Last-attempt source? | **Not yet a complete canonical source.** Today’s best existing signal is `agent_log` / `getStatus().lastRun`, but it only records successful `recordActions` paths. Scheduler/trigger failures that throw before `recordActions` log to console only — so `lastRun` can remain stale after a failed attempt. **Phase F must add explicit attempt start/success/failure recording** (extend `agent_log` or a dedicated run-attempt row) before treating any field as SuperSpec §4.4 “last attempt.” Until that lands, freshness must surface `unknown` when no attempt receipt exists. Do not invent a parallel competing store; extend the existing log/status path. | PR-A-08; scheduler `.catch` console-only | Task Master/backend |
| OQ-012 | Scheduler-state source? | **Enabled: `ENTITY_AGENT_ENABLED`. Running: in-memory scheduler handle (not durable). Interval: `scanIntervalMs` 30m.** Phase F adapter must expose enabled/disabled/unknown/error without pretending durable state exists unless added. | PR-A-08 | — |
| OQ-013 | Existing Run Now service? | **`POST /api/agent/trigger` with `event: 'manual'` (UI “Run All Checks”) → `TaskAgent.trigger` → primarily `runStaleScan('manual')`.** Reuse this path. | PR-A-09 | — |
| OQ-014 | Existing Smoke Test? | **None.** Must be newly implemented as non-mutating connectivity/config test in Phase F. | PR-A-09 | — |
| OQ-015 | Permissions for mutation/test/Run Now? | **Today: optional Bearer `ENTITY_API_TOKEN` only; no fine-grained admin permission.** Phase B+ should introduce an explicit admin/provider permission (or document bearer-as-admin until then). | PR-A-10 | Product/security |
| OQ-016 | Custom base URL network policy? | **Today: require `http:`/`https:` only; no private-IP/DNS allowlist.** Phase C must add SSRF policy before expanding Admin custom URL UX. Until then, keep scheme validation + document risk. | `normalizeBaseUrl` | Security |
| OQ-017 | SQLite FK on every connection? | **Yes for app connections** (`entity-db.ts` sets `foreign_keys=ON`). Safe to design FK constraints for registry tables. | entity-db.ts | — |
| OQ-018 | Existing audit-event framework? | **Partial:** `app_settings.updated_by`, `agent_log`, activity events for task actions; **no** dedicated provider-profile audit table/framework. Prefer lightweight audit adapter over new mandatory table unless product requires immutable audit trail — if required, add additive audit table in Phase B. | code audit | Backend/observability |

## Sign-off block

| Role | Status | Notes |
| --- | --- | --- |
| Cursor audit (grok-4.5) | Proposed | This ledger |
| Henry | Pending | Especially OQ-001, OQ-003, OQ-009, OQ-015 |
| Engineering | Pending | OQ-002 adoption for Phase B migration ledger |
| Security | Pending | OQ-004/005/016 |

Phase B must not start schema/UI implementation until Henry accepts or amends this ledger (per SuperSpec §24.1).

## Acceptance

- [x] OQ-001–OQ-018 addressed with evidence
- [x] Blocking owner confirmations marked
