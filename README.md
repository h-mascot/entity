<div align="center">

# ⚡ Entity

**An AI-native workspace for humans and agents working side by side.**

Entity gives AI agents a visible place to work: files, tasks, documents, activity, reviews, chat, services, and operational state in one shared interface.

![Entity Mission Control](docs/screenshots/hero.png)

</div>

---

## Why Entity Exists

AI agents are usually trapped in chat windows. They answer, vanish, and leave humans stitching together context across terminals, dashboards, notes, GitHub, and Slack.

Entity is the workspace layer for agent-native work:

- agents can see tasks, files, and project state
- humans can inspect what agents are doing
- work can move from idea → task → document → review without losing context
- operational systems become visible instead of buried in logs

The short version: **agents should not just talk. They should have a desk.**

---

## Screenshots

### Mission Control

Kanban and ops views for shared human/agent execution: assignment, priority, review flow, activity, and stale-work visibility.

![Entity Mission Control](docs/screenshots/tasks.png)

### Agent Fleet

A live agent dashboard for crew status, models, current focus, activity, and handoff context.

![Entity Agent Dashboard](docs/screenshots/agents.png)

### Files and Documents

Unified file/document workspace with source browsing, markdown preview, deep links, comments, suggestions, and agent-native review primitives.

![Entity Document Workspace](docs/screenshots/editor.png)

---

## What Entity Does Today

- **Mission Control** — shared kanban board for humans and agents, with assignees, priorities, filters, review routing, task detail panels, notes, comments, links, stale-work signals, and activity history.
- **Agent Dashboard** — registry/status view for agents, including model/runtime metadata, current work, focus state, activity, and operational health signals.
- **Files / DocHub** — unified file browser and document dashboard across configured sources, with search, preview, edit, share/deep-link support, and file history.
- **Agent-native editor** — markdown/document editing with collaboration foundations: comments, suggestions, reviews, presence, authorship, and shared document state.
- **Chat surfaces** — threaded/channel chat UI with agent routing and model selection plumbing.
- **Services and plugins** — admin surfaces for Entity services, plugin registry, Entity Linker, Swarm/dispatch providers, and operational integrations.
- **Desktop and mobile shells** — Electron desktop wrapper and Expo mobile WebView shell.

Entity is currently built for real internal use by the Enterprise Crew, not as a toy demo. Public polish is in progress; sharp edges are documented below.

---

## Architecture

```text
entity/
├── packages/
│   ├── app/       # Vite + React frontend
│   ├── server/    # Express/WebSocket API server
│   ├── db/        # SQLite repositories and DB connection
│   ├── mobile/    # Expo mobile shell
│   └── desktop/   # desktop package wrapper
├── electron/      # canonical Electron app/build config
├── docs/          # product docs, plans, context, specs, reports
└── package.json   # npm workspaces root
```

### Stack

- **Frontend:** React 18, TypeScript, Vite 5, Tailwind CSS, CodeMirror 6, Tiptap, Zustand
- **Backend:** Express 4, WebSocket (`ws`), TypeScript, Vitest
- **Database:** SQLite via `better-sqlite3`
- **AI/runtime plumbing:** Vercel AI SDK, Google Gemini adapter, OpenClaw-compatible agent/runtime integrations
- **Desktop:** Electron 34
- **Mobile:** Expo SDK 52 / React Native WebView

---

## Quick Start

### Prerequisites

- Node.js 20+
- npm
- macOS or Linux recommended for local development

### Install

```bash
git clone https://github.com/h-mascot/entity.git
cd entity
npm install
```

### Run the full app locally

Build the frontend once, then start the API/server. The server serves the built app from `packages/app/dist` on port `3000`.

```bash
npm run build
PORT=3000 npm --prefix packages/server run dev
```

Open:

```text
http://localhost:3000
```

### Frontend-only development

For fast UI work, run Vite separately and point it at the API server:

```bash
# terminal 1
PORT=3000 npm --prefix packages/server run dev

# terminal 2
VITE_ENTITY_API_BASE=http://localhost:3000 \
VITE_ENTITY_WS_URL=ws://localhost:3000 \
npm --prefix packages/app run dev
```

Open Vite at:

```text
http://localhost:5173
```

---

## Commands

| Command | Purpose |
|---|---|
| `npm install` | Install workspace dependencies |
| `npm run build` | Build frontend, DB package, and server |
| `npm --prefix packages/app run build` | Build the Vite frontend only |
| `npm --prefix packages/server run build` | Build the server only |
| `npm --prefix packages/server run test` | Run server Vitest suite |
| `npm run test:e2e` | Run browser E2E smoke test script |
| `npm run electron` | Start the Electron desktop app |
| `npm run electron:build` | Build packaged desktop app |
| `npm run ctrl:full` | Run project release gates configured for this repo |
| `npm run scan:private-defaults` | Scan for private defaults before public/release work |

---

## Configuration

Entity is local-first. Most integrations are optional, but the app becomes more useful as you connect real sources, agents, and services.

Common environment variables:

| Variable | Purpose |
|---|---|
| `PORT` | Entity server port, default `3000` |
| `VITE_ENTITY_API_BASE` | Frontend API base URL when using Vite dev server |
| `VITE_ENTITY_WS_URL` | Frontend WebSocket URL when using Vite dev server |
| `VITE_MC_ORIGIN` | Mission Control API origin override |
| `VITE_OPENCLAW_BASE` | OpenClaw-compatible gateway URL |

Private deployments may have additional local `.env` values for agents, model providers, document roots, auth, and service integrations. Do not commit secrets.

---

## Public-Release Notes

Entity is moving from internal workspace to public project. Before deploying or publishing a fork, review:

- `docs/config/private-default-scan.md`
- `docs/config/entity-config.md`
- `docs/specs/settings-backed-portability-spec.md`
- `docs/reports/private-default-scan-baseline.md`

Recommended public-readiness gate:

```bash
npm run scan:private-defaults
npm run build
npm --prefix packages/server run test
```

If you are deploying Henry's production instance, use the established deployment pipeline rather than manually editing the runtime checkout.

---

## Design Principles

- **Agent-native** — agents are first-class workspace users, not invisible background jobs.
- **Visible work** — task state, activity, evidence, review, and handoffs should be inspectable.
- **Local-first** — useful on one machine with SQLite; cloud and sync can layer on later.
- **Dark-first** — built for long-running operational work.
- **Keyboard-friendly** — fast navigation and command surfaces matter.
- **Receipts over vibes** — screenshots, logs, task history, and review notes beat unverifiable claims.

---

## Roadmap

- [x] Shared file/document workspace
- [x] Mission Control kanban/task board
- [x] Agent dashboard and activity stream
- [x] Agent-native editor foundations: comments, suggestions, presence, reviews
- [x] Plugin/service registry foundations
- [x] Chat and agent-routing surfaces
- [x] Desktop shell
- [x] Mobile shell
- [ ] Public demo/default configuration
- [ ] Portable first-run setup wizard
- [ ] Browser pane / computer-use agent surface
- [ ] Hardening pass for third-party installs
- [ ] Hosted/public deployment guide

---

## Documentation

Useful starting points:

- `docs/context/entity-context.md` — durable architecture/product context for agents and maintainers
- `docs/config/entity-config.md` — configuration model
- `docs/specs/settings-backed-portability-spec.md` — portability/publicization direction
- `docs/PLUGIN-ARCHITECTURE-SPEC.md` — plugin architecture
- `docs/ENTITY-PLUGIN-BUILD-GUIDE.md` — plugin build guide

---

## License

MIT

---

<div align="center">

Built by humans and AI, for humans and AI.

**[Henry Mascot](https://henrymascot.com)** · **[Enterprise Crew](https://github.com/h-mascot)**

</div>
