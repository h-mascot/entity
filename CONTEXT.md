# Entity - Project Context

**Load this file when working on Entity.**

_Last refreshed: 2026-05-07_

## Overview

Entity is an AI-native workspace where humans and agents share files, tasks, agent status, document collaboration, plugins, and operational tooling in one place.

Current product shape:
- Files / DocHub: multi-source file browsing, document viewing, editing, search, previews, sharing/deep links
- Agents: registry, status, focus/activity, agent sidebar, agent dashboard
- Tasks / Mission Control: kanban, task detail panels, notes, comments, history, projects, duplicate handling
- Agent-native editor: comments, suggestions, review pipeline, presence, cursor/authorship signals
- Plugins and services: plugin registry, Entity Services, Entity Linker, Geordi/Swarm surfaces
- Terminal/chat/supporting ops: bottom terminal panel, chat routes, activity stream, notification history

## Public Source And Runtime Model

| Item | Public-safe value |
|------|-------------------|
| GitHub | `https://github.com/h-mascot/entity` |
| Local source checkout | Any operator-controlled checkout, for example `~/Code/entity` |
| Local app URL | `http://localhost:3000` |
| Local workspace root | Configured through `entity.config.yaml`, `.env`, or Admin settings |
| Local DB | Configured explicitly; public defaults must not point at production DBs |
| Deploy script | `./deploy.sh`, fail-closed until production target and DB env vars are set |

Entity is open-source software with generic local defaults. Private production
deployments must be explicit opt-in profiles, not product defaults.

Henry's Enterprise deployment is an internal profile only. Its current recovered
task-bearing production DB path is documented in `docs/internal/enterprise-profile.md`
for operators who already have access. Do not copy that path into public runtime
defaults, public quickstarts, tests, or sample configs.

Incident lesson from the May 2026 recovery: production DB selection must be
explicit via config/env, and deploy must never fall back to a checkout-local
sample DB. PR/branch/runtime drift is a risk to check during incident response,
not a normal workflow to rely on.

## Tech Stack

| Component | Current evidence |
|-----------|------------------|
| Frontend | React 18.3.1, TypeScript, Vite 5, Tailwind CSS 3, CodeMirror 6, Tiptap 3, Zustand |
| Backend | Express 4, TypeScript, WebSocket (`ws`), Node runtime |
| DB | SQLite via `better-sqlite3`; DB access in `packages/db/src` |
| AI agent | Vercel AI SDK `ai` 6 + `@ai-sdk/google` |
| Desktop | Electron 34.5.8 via root `electron/`; `packages/desktop` is a wrapper/legacy forwarder |
| Mobile | Expo SDK 52, React Native 0.76, WebView shell |

## Monorepo Layout

```text
entity/
├── packages/
│   ├── app/       # Vite React app
│   ├── server/    # Express API, websocket, plugins, fs, editor, swarm, agent routes
│   ├── db/        # SQLite repositories and DB files
│   ├── mobile/    # Expo mobile shell
│   └── desktop/   # wrapper that delegates to root electron package
├── electron/      # canonical Electron packaging
├── docs/          # product, implementation, context, and plan docs
    ├── docs/plans/    # compaction-survivable active plans
    ├── docs/internal/ # private deployment examples; not public defaults
└── deploy.sh      # fail-closed production deploy path
```

## High-Value Files

Frontend:
- `packages/app/src/App.tsx` - top-level app shell and cross-surface wiring
- `packages/app/src/config/runtime.ts` - browser/runtime config defaults
- `packages/app/src/components/TaskBoard.tsx` and `mission-control/TaskDetailPanel.tsx` - task UI
- `packages/app/src/components/UnifiedFileDashboard.tsx`, `SourceFileTree.tsx`, `DocumentViewer.tsx`, `FileHistoryPanel.tsx` - file/document surfaces
- `packages/app/src/components/AgentDashboardV2.tsx`, `AgentsSidebarTab.tsx`, `ActivityStream.tsx`, `NotificationHistoryPanel.tsx` - agent and activity surfaces
- `packages/app/src/components/SwarmBoard.tsx`, `EntityServicesBoard.tsx` - plugin/swarm/service UI
- `packages/app/src/components/BottomTerminalPanel.tsx`, `OfflineAwareChat.tsx` - terminal/chat surfaces

Server:
- `packages/server/src/index.ts` - main Express app, websocket server, core task/file/agent routes
- `packages/server/src/routes/agent-api.ts` - agent document API (`/api/documents/*`)
- `packages/server/src/routes/docs.ts`, `routes/search.ts`, `routes/chat.ts` - docs/search/chat APIs
- `packages/server/src/fs/` - file source, file tree, indexing, search, security, adapters
- `packages/server/src/editor/` - editor collaboration routes/services/ws/auth
- `packages/server/src/agent/` - Task Master config, scheduler, tools, events, log
- `packages/server/src/plugins/` - plugin registry and plugin routes
- `packages/server/src/swarm/` - swarm job API, providers, dispatcher, healer

Database:
- `packages/db/src/entity-db.ts` - shared DB connection helper
- `packages/db/src/index.ts` - task/activity/project/comment repositories
- `packages/db/src/file-sources.ts`, `file-index.ts` - file-source/index persistence
- `packages/db/src/document-collab.ts` - document collaboration persistence
- `packages/db/src/chat.ts`, `agent-tokens.ts`, `task-sync.ts` - supporting persistence

## Important API Areas

- `/api/tasks` and related task subroutes: task board, notes, comments, projects, history, duplicate handling
- `/api/fs/*` and `/api/sources/*`: file tree, file read/write, search, source management
- `/api/documents/*`: agent document API, share/edit state, and editor collaboration routes mounted through `packages/server/src/editor`
- `/api/agent/*`: Task Master status, trigger, log
- `/api/agents/*`: agent registry/status/activity/focus/metrics
- `/api/plugins/*`: plugin registry and plugin settings/toggles
- `/api/swarm/*`: swarm jobs, providers, claim/release/proof/status lifecycle
- `/api/entity-services/*`: services registry/status surface
- `/api/search/*`, `/api/docs/*`, `/api/chat/*`: search, docs, and chat support routes

## Deployment Rules

1. Public setup is local-first: install dependencies, copy `.env.example`, create `entity.config.yaml`, run `npm run setup` or `npm run dev`.
2. `./deploy.sh` is for configured production targets only. It refuses to run unless `ENTITY_PROD_HOST`, `ENTITY_PROD_HTTP_HOST`, `ENTITY_PROD_DIR`, and `ENTITY_PROD_DB` are set.
3. `deploy.sh` builds DB/server/app locally unless `ENTITY_SKIP_MAC_BUILD=1`.
4. `deploy.sh` checks the configured production DB task count before sync, backs it up before deploy, and aborts if counts look unsafe.
5. `deploy.sh` excludes `*.db`, `*.db-*`, `*.db-shm`, and `*.db-wal` during sync.
6. The server dist DB symlink must point at the explicit configured DB. It must not point at a sample DB from the checkout.
7. Private runtime edits can cause source/runtime drift; treat that as an incident-response warning, not a normal workflow.

## Testing And Build

Common commands:

```bash
npm install
npm --prefix packages/app run build
cd packages/server && npm run build
npm run test:server
```

After editing `packages/server/`, follow the repo rule:
- add/update colocated Vitest coverage where practical
- run `npm run test:server` (root; it builds the generated managed-storage broker outputs before the Vitest suite)
- before commit or deploy, run `cd packages/server && npm run build && npm run test:server`

## Durable Sharp Edges

- Runtime/source drift has happened; always distinguish Mac source, Enterprise runtime, and browser-visible live behavior.
- DB files in `packages/db` are real state artifacts; never overwrite production DBs from Mac.
- Some generated/dist/backup files are present in the repo tree; prefer source files under `packages/*/src` unless debugging build output.
- `packages/app/package.json` is minified JSON; use structured tools or careful edits.
- `packages/desktop` is not the canonical Electron package; root `electron/` is.
- Feature flags default true for multi-source files and agent-native editor (`ENTITY_FS_MULTISOURCE`, `ENTITY_AGENT_NATIVE_EDITOR`).
- Browser clipboard/share/deep-link work needs live browser verification where possible.

## Current Active Work

As of 2026-05-07, the active task is open-source readiness cleanup for Mission
Control task #575. The resumable plan is `docs/plans/ACTIVE_PLAN.md`.

## Context Docs

`CONTEXT.md` is the canonical project-start context. `docs/context/entity-context.md`
is a pointer to this file. Older duplicate context copies under `memory/` may
exist locally, but should not be treated as synchronized mirrors unless
explicitly refreshed.
