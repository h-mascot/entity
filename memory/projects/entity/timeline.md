# Entity — Session Timeline

---

## 2026-02-17 — Context Restructure & Stabilization

- Moved context files from `.context/` to `memory/projects/entity/` (canonical location)
- Updated `scripts/update-context.sh` to point at new location
- Session cleanup: cron thread fixes, Discord consolidation (unrelated to Entity)
- Entity systemd service stable

## 2026-02-16 — UI Polish, Task Master Settings, DocHub Fixes

### Task Master (Evening Session)
- **Activity Stream:** Switched from `useMockData: true` → real API data (commit `b9b5023`)
- **Removed Active Tasks sidebar section** — redundant with Doing column (commit `3e4a737`)
- **Harmonized activity cards** — all show "Entity ⚡" (commit `5e598e1`)
- **Built Task Master settings page** under Admin → Task Master (commit `fcf33b3`)
  - Status card, manual trigger buttons, config display, recent logs viewer
- **Fixed Task Master API paths** — needed `/api/` prefix (commit `f1ce0b1`)
- **Fixed documents token scopes** — added write scopes to henry-admin token

### Feature Flags (Afternoon)
- Problem: Multi-source + DocHub disabled on every Entity restart
- Root cause: Systemd service missing env vars + Vite bakes flags at build time
- Fix: Added to `/etc/systemd/system/entity.service` AND rebuilt frontend with flags true
- All 6 sources now load: Ada Local, Ada Docsify, Spock, Scotty, Zora, Vault

### Source Management
- Removed Entity codebase from auto-init sources (no user need)
- Final 4 auto-init sources: Vault 📓, Ada 🔮, Spock 🖖, Zora 🌌
- Vault syncs hourly from Mac iCloud Obsidian via cron
- Commits: `01eb7b0`, `6780353`, `0c8ecc0`

### Context Files
- Discovered context files were 8+ days stale (context.md from Feb 8)
- Created `scripts/update-context.sh` for auto-regeneration
- Updated Geordi build pipeline SKILL.md to enforce running script after builds

---

## 2026-02-15 — Entity systemd Service, Build Fixes

### Root Causes Found
- `NODE_ENV=production` globally set on ada-gateway → npm skips devDependencies → typescript/vite never install
- Fix: `NODE_ENV=development npm install` for all builds
- `VITE_ENTITY_API_BASE=http://100.86.150.96:3000` (Mac IP) baked into frontend → all API calls failed
- Fix: set to empty string (same-origin)
- Feature flag defaults were `false` for FS_MULTISOURCE and ANE → flipped to `true`

### Deployment
- Entity as systemd service: `/etc/systemd/system/entity.service`
- Build workaround: isolated `/tmp/entity-mirror/` avoids npm workspace hoisting bug
- Manual node instances holding port 3000 caused restart loops → systemd-managed now

---

## 2026-02-14 — Task Master + DocHub Smart Preview + Fixes

### Task Master — SHIPPED (commit `723b6a1`, Geordi build)
- 446 lines added, 7 files changed, 6 new agent files
- `packages/server/src/agent/` — full module
- `agent_log` DB table
- 3 API routes: `/api/agent/trigger`, `/api/agent/status`, `/api/agent/log`
- 5 tools: searchTasks, updateTask, addNote, moveTask, notifyAgent
- Event hooks: onTaskMovedToReview, onTaskStale, onOutputMissing
- 30-min scheduler behind `ENTITY_AGENT_ENABLED` flag
- Model: Gemini Flash (`gemini-2.0-flash`)
- 44+ actions logged

### DocHub Smart Preview — SHIPPED (Geordi build)
- `packages/server/src/file-types.ts` — 60+ extension → MIME type mapping
- Images render inline in editor (PNG, JPG, GIF, WebP, SVG, AVIF)
- PDFs get download link
- Raw file endpoint: `GET /api/fs/raw?sourceId=&path=`

### DocHub Index Runner — Expanded
- MAX_DIRECTORIES_PER_SOURCE: 50 → 500
- MAX_SOURCE_DEPTH: 5 → 8
- Aggressive ignore list: node_modules, .git, .venv, box, tmp, secrets, Calls, orphaned-sessions
- 4,699 files indexed

### Agent Dashboard Real-Time
- PRD written (PRD-agent-dashboard-realtime.md)
- Phase 1: Fixed Spock gateway fallback (was "ada-gateway" → corrected to "spock-gateway")
- Phase 2 (Geordi): Dynamic task counts, real current task from MC board — SHIPPED

### Source File Save — Fixed
- Bug: `if (currentSourceId) return;` early-return caused silent save failures
- Fix: POST `/fs/file` with `{ mode: "overwrite" }` body

### UI Polish — SHIPPED
- Icon-based compact toolbar: 📄 / 📁 instead of "+File" / "+Folder"
- ← back button for DocHub navigation
- Merged sort button: A-Z↑ / New↓
- Search at top of sidebar (cross-source, debounced 180ms)

---

## 2026-02-09 — Context Sync & Right Sidebar Bug Fix

- Right sidebar fallback bug fixed — was showing tasks+agents when empty. Right sidebar is for doc collaboration ONLY.
- Context files updated
- Verified ada-gateway repo at `44b30b6` (ANE-016-019 commit)

---

## 2026-02-08 — ANE Sprint Completion (ANE-016-019)

- Branch: `main` (all ANE features merged)
- Commit: `44b30b6` feat: ANE-016-019, sidebar redesign, HTML preview, doc hub recursive indexing
- **ANE-016:** Review Pipeline — OpenClaw job dispatch
- **ANE-017:** Review Panel — review results UI, apply/reject findings
- **ANE-018:** Tool Semantics Docs — agent tool usage documentation
- **ANE-019:** Smoke Tests — regression test script
- Doc Hub recursive indexing (MAX_SOURCE_DEPTH=5, MAX_DIRECTORIES_PER_SOURCE=50 at the time)
- Sidebar redesign, MC schema fixes (due_date, progress_status added)
- Entity deployed to ada-gateway
- GitHub repo: `henrino3/entity`

---

## 2026-02-07 — MC UI Refinement + Mobile Fix + GitHub Push

- Pushed all MC integration work to GitHub (40 files, 202k insertions)
- Fixed mobile access: Vite proxy, dynamic URLs, WebSocket hostname
- Refined MC UI: task detail minimalism, MC visual language
- Commits: `a0675e9`, `77ee43a`, `b3238fc`
- MC merged into Entity permanently (Henry confirmed)
- MC API bug fixed: POST /api/tasks "model is not defined" → added `model` to destructuring
- Ralph skill published to Enterprise-Crew-skills repo

---

## 2026-02-06 — MC Integration Complete + ANE Sprint Start

- Ralph (Codex agent) completed all 10 MC integration stories
- Phase 2 Watch Mode started (stories 1-3 completed)
- ANE sprint begins: ANE-013 through ANE-015
- **ANE-013:** Comments — inline anchors + thread panel
- **ANE-014:** Suggestions/Track Changes — accept/reject workflow
- **ANE-015:** Presence Chips — shows who's editing in header
- **Entity listed on henrymascot.com/projects** — public visibility
- MC v2 PRD created (Task #102)

---

## 2026-02-04 — Ralph Begins MC Integration

- Ralph/Codex with integration-prompt.md and integration-prd.json
- 10 stories: TaskBoard, SQLite backend, Activity Log, Colors, Electron, Expo, E2E, DB Sync, Responsive, Offline Indicator
- All 10 complete

---

## ~2026-02-01 — MC Improvements

- MC UI improvements discussed
- X/Twitter inspiration for MC UI design
- Entity/MC convergence discussions

---

## ~2026-01-08 — ClawdPad Build (Loops 1-3)

- Scotty built initial ClawdPad: server, app, desktop baseline
- Editor + agent sidebar (Loop 2)
- Mentions + realtime + polish (Loop 3)

---

## ~2026-01-06 — PRD v2: Pandora

- Full 6-phase roadmap created
- Architecture defined: React 19, CodeMirror 6, Electron, Expo, SQLite

---

## ~2026-01-04 — Entity v0.1.0

- Initial AI-native workspace for OpenClaw agents
- File browser, markdown editor, agent sidebar
