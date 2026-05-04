# Entity — TODO / Outstanding Work

_Last updated: 2026-02-17_

## 🔴 Active Bugs
- [ ] TypeScript errors (166 pre-existing) — build succeeds but tsc fails; dist patched directly
- [ ] npm workspaces broken on ada-gateway — must build in `/tmp/entity-mirror/`
- [ ] MC Cron jq filter broken — API format changed from `{tasks:[]}` to `[]`

## 🟡 Phase 2 — Watch Mode (stories 4-9)
- [ ] Auto-Follow Agent Files (story 4)
- [ ] Agent Focus Tracking (story 5)
- [ ] Notification Center — Toasts (story 6) + History (story 7)
- [ ] Split Pane View (story 8)
- [ ] File Change History (story 9)

## 🟡 ANE
- [ ] ANE-020: AI Review Integration — inline finding highlights in editor

## 🟡 Task Master
- [ ] Telegram/Discord notifications when agent takes action
- [ ] Dashboard live refresh (poll vs static snapshot)

## 🟡 DocHub
- [ ] Mac ~/Code folder accessibility (run Entity on Mac or Tailscale FS bridge)
- [ ] Source health detail improvements
- [ ] Search ranking / exact match boosting

## 🟡 Infrastructure
- [ ] CI/CD pipeline — auto-build on `git push main`
- [ ] E2E tests — Playwright reinstall needed (`npx playwright install chromium`)
- [ ] Cloud deployment — currently ada-gateway only

## 🟢 Backlog (Phase 3+)
- [ ] Embedded browser pane (CUA integration)
- [ ] Chat integration (Telegram/Discord panels in Entity)
- [ ] Terminal pane (xterm.js)
- [ ] Spatial workspace (AI City vision)
- [ ] Multi-tenant + marketplace

## ✅ Recently Completed (Feb 14-17)
- [x] Task Master AI agent (Gemini Flash, 30-min scans, 44+ actions)
- [x] Task Master settings page (`TaskMasterSettings.tsx`)
- [x] DocHub smart preview (images inline, PDFs download link)
- [x] File Index Runner expanded (500 dirs, depth 8, 4,699 files)
- [x] Source file save fixed (POST /fs/file with mode:overwrite)
- [x] Feature flags default true (server + baked into Vite build)
- [x] systemd service on ada-gateway
- [x] 4 auto-init sources: Vault/Ada/Spock/Zora
- [x] UI Polish: 📄/📁 icons, A-Z↑ sort, search at top, activity real data
- [x] AgentDashboardV2 with real-time data
- [x] Documents token scopes fixed
