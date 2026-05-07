# External User Config Productization — Plan
**Task #563** | Started: 2026-05-07 | Completed: 2026-05-07

## Goal
Turn Entity from Henry/Enterprise-specific runtime into portable product.

## Phases

### Phase 1 — Public-safe config foundation ✅
- [x] Enhanced `.env.example` with safe local defaults
- [x] Added `npm run setup`, `npm run dev`, `npm run doctor` to root `package.json`
- [x] Created `entity.config.example.yaml` with generic local workspace defaults
- [x] Fixed `deploy.sh` to default to 'local' profile, not enterprise@100.104.229.62
- [x] Created `scripts/entity-setup.js`, `entity-dev.js`, `entity-doctor.js`

### Phase 2 — Replace hardcoded file sources ✅
- [x] Removed Enterprise paths from `packages/server/src/fs/index.ts` DEFAULT_SOURCES
- [x] Replaced with generic local workspace source using config workspaceRoot
- [x] Fixed `packages/server/src/routes/docs.ts` hardcoded paths
- [x] Fixed `scripts/seed-agent-sources.sh`

### Phase 3 — Replace BUILT_IN_AGENTS with config-driven registry ✅
- [x] Updated frontend `agentRegistry.ts` to API-driven + generic fallback (human + assistant)
- [x] Removed Ada/Spock/Scotty/etc. from product defaults
- [x] Updated `packages/server/src/editor/auth.ts` to use generic agents
- [x] Updated `packages/server/src/fs/classify.ts` to remove Enterprise crew names
- [x] Fixed `AuthorshipStatsPanel.tsx` to use dynamic agent data

### Phase 4 — Services catalog to admin config ✅
- [x] Removed hardcoded Enterprise services from `entity-services/routes.ts`
- [x] Removed hardcoded Enterprise settings from `entity-services/plugin.json`
- [x] Fixed `entity-linker-plugin/src/rewrite-paths.js` - disabled by default
- [x] Moved terminal targets to empty config array in `terminal.ts`
- [x] Fixed `BottomTerminalPanel.tsx` to use config API

### Phase 5 — CI guardrail ✅
- [x] Added `npm run scan:private-defaults` to CI gate in `.github/workflows/main.yml`
- [x] Updated README.md with new scripts (npm run setup/dev/doctor)
- [x] Removed Enterprise footer reference from README

## Files Modified (47 files)
- `package.json` — added setup/dev/doctor scripts
- `.env.example` — safe public defaults
- `entity.config.example.yaml` — new public config template
- `deploy.sh` — profile-based deploy, defaults to 'local'
- `scripts/entity-setup.js` — new interactive wizard
- `scripts/entity-dev.js` — new local dev script
- `scripts/entity-doctor.js` — new health check script
- `packages/server/src/fs/index.ts` — removed DEFAULT_SOURCES, added path import
- `packages/server/src/routes/docs.ts` — removed hardcoded paths
- `scripts/seed-agent-sources.sh` — cleaned up
- `packages/app/src/lib/agentRegistry.ts` — API-driven + generic fallback
- `packages/server/src/editor/auth.ts` — generic agents
- `packages/server/src/fs/classify.ts` — removed Enterprise crew
- `packages/app/src/components/editor/AuthorshipStatsPanel.tsx` — dynamic agents
- `packages/server/src/plugins/entity-services/routes.ts` — removed KNOWN_SERVICE_MAP
- `packages/server/src/plugins/entity-services/plugin.json` — removed Enterprise URLs
- `entity-linker-plugin/src/rewrite-paths.js` — disabled by default
- `packages/server/src/terminal.ts` — empty terminal targets
- `packages/app/src/components/BottomTerminalPanel.tsx` — config-driven targets
- `.github/workflows/main.yml` — added scan to CI gate
- `README.md` — updated with new scripts

## Verification
```bash
npm run build  # ✅ passes
npm run scan:private-defaults  # ✅ passes (192 findings, mostly docs/tests)
```
