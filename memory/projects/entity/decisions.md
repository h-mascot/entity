# Entity — Key Decisions

| Date | Decision | Reasoning | Status |
|------|----------|-----------|--------|
| 2026-01-04 | Start with MD Writer & Viewer (Phase 1) | Foundation first - file editing is core | ✅ Shipped |
| 2026-01-06 | Full 6-phase roadmap (Pandora PRD) | Vision doc to guide long-term development | Active |
| 2026-01-08 | Monorepo with npm workspaces | Keep server, app, db, mobile, electron together | Active |
| 2026-01-08 | CodeMirror 6 over Monaco | Lighter weight, better mobile support | Active |
| 2026-01-08 | Zustand for state | Simple, no boilerplate, works with React | Active |
| 2026-02-04 | SQLite (better-sqlite3) local-first | Local-first architecture, cloud sync optional | Active |
| 2026-02-04 | MC color scheme globally (#000 bg) | Unified dark theme, CSS variables | Active |
| 2026-02-04 | @dnd-kit for drag-drop | React-native kanban, works with touch | Active |
| 2026-02-04 | Ralph (Codex agent) for story implementation | Automated PRD-driven development via JSON stories | Active |
| 2026-02-04 | DB abstraction layer (local/cloud) | Environment variable switches between SQLite and REST | Active |
| 2026-02-06 | Entity listed on henrymascot.com/projects | Public visibility, GitHub README with screenshot | Active |
| 2026-02-06 | MC v2 PRD created (4 features) | Output fields, auto-subtask, deliverables, in-card chat | Backlog |
| 2026-02-07 | MC merged into Entity permanently | No more separate Mission Control app | Active |
| 2026-02-07 | Vite proxy for API (no hardcoded localhost) | Mobile/external access requires dynamic URLs | Active |
| 2026-02-07 | Project Context Memory skill | Auto-track project state across sessions | Active |
| 2026-02-07 | Auth/Login added (password: "mission") | Basic access control for web-accessible deployments | Active |
| 2026-02-07 | MC sub-views (Ops, Strategic, Agents) | TaskBoard evolved from flat kanban to multi-view MC dashboard | Active |
| 2026-02-07 | Admin panel (settings, security, integrations) | Entity needs configuration UI, not just file editing | Active |
| 2026-02-08 | Dual-location development (Mac + ada-gateway) | Need entity accessible on server for agents, Mac for Ralph/Codex | Active |
| 2026-02-08 | Right sidebar for doc collaboration ONLY | Comments/suggestions/review on right; Tasks/Agents on left | Active |
| 2026-02-14 | Gemini Flash for Task Master | Cheap (~$1/month), fast, good enough for task management | Active |
| 2026-02-14 | Task Master scan interval: 30 minutes | Balance between responsiveness and API costs | Active |
| 2026-02-14 | Task Master maxActionsPerScan: 10 | Prevent runaway agent actions | Active |
| 2026-02-14 | Stale thresholds: doing=24h, review=48h | Tasks stuck > 24h in doing or > 48h in review trigger intervention | Active |
| 2026-02-14 | Feature flags default true (FS_MULTISOURCE, ANE) | Was false → broke on every restart. Now baked into Vite build too | Active |
| 2026-02-14 | Build in /tmp/entity-mirror/ | npm workspaces broken on server (NODE_ENV=production skips devDeps) | Active |
| 2026-02-14 | VITE_ENTITY_API_BASE = empty string | Was baked as Mac IP (100.86.150.96), broke all API calls from server | Fixed |
| 2026-02-15 | Entity as systemd service | Manual node instances held port 3000 causing restart loops | Active |
| 2026-02-15 | 4 auto-init sources: Vault/Ada/Spock/Zora | These are the sources users actually need. Entity codebase not needed | Active |
| 2026-02-15 | Entity source removed from DocHub | No user-facing reason to browse Entity source code (Geordi uses it, not users) | Active |
| 2026-02-16 | Source file save: POST /fs/file with mode:overwrite | Was silently failing — `if (currentSourceId) return;` early-return bug | Fixed |
| 2026-02-16 | MAX_DIRECTORIES_PER_SOURCE = 500 | Was 50, too low for large workspaces. 4,699 files need higher limit | Active |
| 2026-02-16 | MAX_SOURCE_DEPTH = 8 | Was 5, too shallow for deep directory structures | Active |
| 2026-02-16 | Icon-based compact UI (📄/📁/←) | Saves horizontal space in narrow sidebar; emoji is universally understood | Active |
| 2026-02-16 | Merged sort button (A-Z↑/New↓) | Two separate buttons wasted space; single toggle is more efficient | Active |
| 2026-02-16 | Activity feed real data (not mock) | `useMockData: true` was sending fake agent activity — misleading | Fixed |
| 2026-02-16 | All activity cards unified as "Entity ⚡" | Mixed "Mission Control 📋" and "Entity ⚡" was confusing | Active |
| 2026-02-16 | Documents token in .env (ENTITY_DEFAULT_DOCUMENTS_TOKEN) | Persists across deploys; not hardcoded in source | Active |
| 2026-02-16 | ALL fetch paths need /api/ prefix | apiBase is empty string (same-origin), so prefix is required | Active |
| 2026-02-16 | Deploy script: always exclude *.db | Wiped production DB 3 times via rsync without exclude. Non-negotiable rule | Active |
| 2026-02-16 | Vault syncs hourly from Mac via cron | iCloud Obsidian on ada-gateway via rsync from Mac | Active |
| 2026-02-17 | Context files live in memory/projects/entity/ | .context/ was temp Codex working dir; canonical location is memory/ | Active |
