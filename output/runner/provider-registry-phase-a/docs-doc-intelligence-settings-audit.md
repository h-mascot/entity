# PR-A-03 — Docs / Doc Intelligence Settings UI & API Audit

**Issue:** THE-735 / PR-A-03  
**Proof type:** Coupling map  
**Source SHA:** SuperSpec `4eaafc6815db1d731b0683ae4bf54096e64cc30e91a2b89d984fccc520ebd733`  
**Worktree HEAD:** `a87a6fd9527f06654291be174c88f7271ad5db66`

## Known seam

`packages/app/src/components/settings/DocsSettings.tsx` → `packages/server/src/routes/doc-intelligence.ts` → reuses `getTaskAgentSettings()` / `getTaskAgentLanguageModel()` from `packages/server/src/agent/settings.ts`

## UI surface

| Control | Behavior |
| --- | --- |
| Enable Doc Intelligence checkbox | `PATCH` settings with `{ enabled }` only |
| Provider / Model / API key / Status tiles | Read-only projections from Task Master settings |
| Missing-key CTA | Opens Task Master settings via `onOpenTaskMasterSettings` or text “Admin → Task Master” |
| Loading / error | Explicit copy; no silent healthy coercion |

UI copy states explicitly: Doc Intelligence **reuses Task Master provider and API key** — no separate credentials.

## APIs

| Method | Path candidates | Purpose |
| --- | --- | --- |
| GET | `/api/doc-intelligence/settings` (via `buildApiCandidates`) | Load `{ settings: DocIntelligenceSettingsView }` |
| PATCH | same | Toggle `enabled` only |

Additional Doc Intelligence routes (not used by DocsSettings UI, but part of coupling):

| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST | `/api/doc-intelligence/notes` | Per-document notes in `app_settings` keys `docNotes.{source}::{path}` |
| POST | `/api/doc-intelligence/ask` (and related) | LLM Q&A using Task Master language model |

Routes dual-registered under `/doc-intelligence` and `/api/doc-intelligence`.

## Coupling map (critical for OQ-008 / OQ-009)

```text
DocsSettings UI
  └─ enabled flag ──► app_settings['docIntelligence.settings']  (only { enabled })
  └─ provider/model/key status ──► getTaskAgentSettings()
                                      └─ app_settings['taskAgent.settings'] + env fallbacks

Doc ask / generateAnswer
  └─ getTaskAgentLanguageModel()  (same Task Master provider key resolution)
```

| Concern | Docs / Doc Intelligence | Task Master |
| --- | --- | --- |
| Enable flag | Independent (`docIntelligence.settings.enabled`) | `ENTITY_AGENT_ENABLED` env (scheduler/triggers) |
| Provider kind | Inherited (no independent selector) | Owned |
| Model id | Inherited | Owned |
| API key | Inherited (DB or env) | Owned; raw stored under `taskAgent.settings.apiKeys[provider]` |
| Ready | `enabled && apiKeyConfigured` | N/A (uses `apiKeyConfigured` + enabled env) |
| Consumer identity today | Single settings key + features under Doc Intelligence | Single Task Agent settings blob |

**OQ-009 preview (audit finding):** Product UI presents “Docs” page with “Doc Intelligence” subsection, but provider binding is **one shared settings blob** today. Additional non-UI consumers of the same language model: `agent/comment-responder.ts` (task @mentions) and `agent/document-comment-responder.ts`.

## Secret handling

- GET returns only `apiKeyConfigured` + `apiKeySource` (never raw key).
- Docs UI has no key paste field (by design / current coupling).

## Acceptance

- [x] Coupling map produced
- [x] APIs listed
- [x] No raw secrets
