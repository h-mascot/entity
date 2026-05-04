# Entity - Project Context

**Load this file when working on Entity.**

_Last refreshed: 2026-05-02_

## Overview

Entity is an AI-native workspace where humans and agents share files, tasks, agent status, document collaboration, plugins, and operational tooling in one place.

Current product shape:
- Files / DocHub: multi-source file browsing, document viewing, editing, search, previews, sharing/deep links
- Agents: registry, status, focus/activity, agent sidebar, agent dashboard
- Tasks / Mission Control: kanban, task detail panels, notes, comments, history, projects, duplicate handling
- Agent-native editor: comments, suggestions, review pipeline, presence, cursor/authorship signals
- Plugins and services: plugin registry, Entity Services, Entity Linker, Geordi/Swarm surfaces
- Terminal/chat/supporting ops: bottom terminal panel, chat routes, activity stream, notification history

## Source And Runtime

| Item | Current value |
|------|---------------|
| Mac source of truth | `~/Code/entity` |
| GitHub | `https://github.com/henrino3/entity` |
| Deploy script | `~/Code/entity/deploy.sh` |
| Default production SSH target | `enterprise@100.104.229.62` |
| Default production HTTP host | `http://100.104.229.62:3000` |
| Runtime checkout on Enterprise | `/Users/enterprise/Services/entity` |
| Production DB | `/Users/enterprise/Services/entity/packages/db/entity-tasks.db` |

Important: some older code paths and plugin defaults still reference `http://100.106.69.9:3000` for Entity or adjacent services. Treat `deploy.sh` as the current deployment source of truth and verify the live host before changing URL-sensitive behavior.

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
├── memory/projects/entity/ # compact agent memory docs
└── deploy.sh      # safe production deploy path
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

1. Mac repo is the normal source of truth for code changes.
2. Use `./deploy.sh`; do not hand-rsync production changes.
3. `deploy.sh` builds DB/server/app on Mac unless `ENTITY_SKIP_MAC_BUILD=1`.
4. `deploy.sh` backs up the production DB before deployment and aborts if task counts look unsafe.
5. `deploy.sh` excludes `*.db`, `*.db-*`, `*.db-shm`, and `*.db-wal` during sync.
6. Do not `git checkout`, stash, or reset on the production runtime checkout; it can overwrite or drift the DB/runtime state.
7. Verify the actual host, checkout, process, and DB path before claiming a live behavior is fixed.

## Testing And Build

Common commands:

```bash
npm install
npm --prefix packages/app run build
cd packages/server && npm run build
cd packages/server && npx vitest run
```

After editing `packages/server/`, follow the repo rule:
- add/update colocated Vitest coverage where practical
- run `cd packages/server && npx vitest run`
- before commit or deploy, run `cd packages/server && npm run build && npx vitest run`

## Durable Sharp Edges

- Runtime/source drift has happened; always distinguish Mac source, Enterprise runtime, and browser-visible live behavior.
- DB files in `packages/db` are real state artifacts; never overwrite production DBs from Mac.
- Some generated/dist/backup files are present in the repo tree; prefer source files under `packages/*/src` unless debugging build output.
- `packages/app/package.json` is minified JSON; use structured tools or careful edits.
- `packages/desktop` is not the canonical Electron package; root `electron/` is.
- Feature flags default true for multi-source files and agent-native editor (`ENTITY_FS_MULTISOURCE`, `ENTITY_AGENT_NATIVE_EDITOR`).
- Browser clipboard/share/deep-link work needs live browser verification where possible.

## Current Active Work

As of 2026-05-02, check `docs/context/entity-context.md` before coding. Current dirty MascotM3 branch is `codex/fix-edge-tts-docs` at `afa8e4f` with uncommitted Mission Control review-gate/review-filter work in `packages/server/src/agent/review-policy.ts`, `packages/server/src/index.ts`, `packages/app/src/components/TaskBoard.tsx`, and `packages/app/src/components/mission-control/MCHeader.tsx`. The active plan file is stale/completed (#490 Task Detail Compactness).

## Context Docs

Current context docs:
- `CONTEXT.md` - root quick context for agents
- `docs/context/entity-context.md` - expanded context and maintenance guidance
- `memory/projects/entity/context.md` - compact memory-oriented context

Keep these aligned when architecture, deployment, major subsystem ownership, or durable coding rules change.
