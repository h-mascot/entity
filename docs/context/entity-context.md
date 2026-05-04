# Entity Context

_Canonical Entity build context. Agents should read this when asked to "load Entity context" or before making code/product changes in this repository._

_Last refreshed: 2026-05-02_

## Purpose

Use this file for durable, high-signal context:
- product scope and positioning
- repo/codebase structure
- architecture and major subsystems
- runtime/deployment facts
- key files/components/endpoints
- durable implementation and verification rules
- known sharp edges that matter during coding

Do not use this file as a daily changelog. Use `docs/plans/ACTIVE_PLAN.md` for current multi-step execution state and `memory/projects/entity/todo.md` for compact follow-ups.

## Read Order

When a task involves Entity:
1. `docs/context/entity-context.md` — this file (canonical build context)
2. `docs/plans/ACTIVE_PLAN.md` — if a task is already in progress
3. `memory/projects/entity/todo.md` — active follow-ups if relevant

## What Entity Is

**Entity** is the AI-native workspace where agents work and humans can inspect, steer, and collaborate with them.

Core surfaces:
- **Files / DocHub**: browse, open, preview, edit, share, deep-link, and search documents/files
- **Agents**: monitor agent state, registry, activity, and focus
- **Tasks / Mission Control**: kanban and operational execution views
- **Agent-native editor**: comments, suggestions, reviews, presence, authorship, shared document state
- **Admin/plugins/services**: configuration, plugin registry, Entity Services, Entity Linker, Geordi/Swarm
- **Supporting surfaces**: terminal panel, chat routes, activity stream, notification history

Positioning:
- Entity = workspace + execution surface
- Paperclip / external orchestrators = management or orchestration layers when wired in

## Repositories And Paths

Primary repo:
- **Mac source of truth**: `~/Code/entity` (on MacBook Pro M3 Max, hostname geordi)
- **GitHub**: `https://github.com/henrino3/entity`

Production defaults from `deploy.sh`:
- SSH target: `enterprise@100.104.229.62`
- HTTP host: `http://100.104.229.62:3000`
- Runtime checkout: `/Users/enterprise/Services/entity`
- Production DB: `/Users/enterprise/Services/entity/packages/db/entity-tasks.db`

Legacy or adjacent defaults still exist in code:
- Several plugin/service defaults still reference `http://100.106.69.9:*`
- `packages/server/src/task-output-links.ts` defaults `ENTITY_BASE_URL` to `http://100.106.69.9:3000`
- Verify which URL is intended before changing URL defaults.

## Source Of Truth Rule

Default assumption:
- **Mac repo is source of truth for code.**
- Enterprise copy is runtime/mirror unless explicitly doing emergency recovery.

Preferred workflow:
1. change on Mac repo
2. build/test locally
3. deploy via `./deploy.sh`
4. verify live route/API/browser behavior

Only patch the live checkout directly when recovery is time-sensitive and there is a clear reason. Do not use production as the normal editing surface.

## Codebase Structure

```
entity/
├── packages/
│   ├── app/       # Vite React frontend
│   ├── server/    # Express/WebSocket backend and APIs
│   ├── db/        # SQLite repositories and DB artifacts
│   ├── mobile/    # Expo mobile shell
│   └── desktop/   # wrapper delegating to root electron package
├── electron/      # canonical Electron wrapper/build config
├── docs/          # product, implementation, context, and plan docs
├── docs/plans/    # compaction-survivable execution plans
├── docs/context/  # canonical context documents
└── package.json   # npm workspaces root
```

## Stack

Current package evidence:
- **Frontend**: React 18.3.1, React DOM 18.3.1, TypeScript, Vite 5, Tailwind CSS 3, CodeMirror 6, Tiptap 3, Zustand
- **Backend**: Express 4, `ws`, TypeScript, `ts-node`, Vitest
- **Database**: SQLite via `better-sqlite3`; no Drizzle dependency in current manifests
- **AI agent**: Vercel AI SDK `ai` 6 and `@ai-sdk/google` 3
- **Desktop**: Electron 34.5.8 through root `electron/`
- **Mobile**: Expo SDK 52, React Native 0.76, `react-native-webview`

## Main App Areas

### Frontend
- `packages/app/src/App.tsx` - app shell, global state, routing between surfaces
- `packages/app/src/config/runtime.ts` - API/WS/feature flag defaults
- `packages/app/src/components/TaskBoard.tsx` and `components/mission-control/TaskDetailPanel.tsx` - Mission Control task UI
- `packages/app/src/hooks/useTaskBoard.ts`, `useMCData.ts` - task/MC data loading
- `packages/app/src/components/UnifiedFileDashboard.tsx`, `SourceFileTree.tsx`, `DocumentViewer.tsx`, `FileHistoryPanel.tsx` - file/document surfaces
- `packages/app/src/components/AgentDashboardV2.tsx`, `AgentsSidebarTab.tsx`, `ActivityStream.tsx` - agent and activity views
- `packages/app/src/components/SwarmBoard.tsx`, `EntityServicesBoard.tsx` - swarm/plugin/service views
- `packages/app/src/components/BottomTerminalPanel.tsx`, `OfflineAwareChat.tsx` - terminal/chat views
- `packages/app/src/components/MarkdownAudioControls.tsx` - TTS controls for docs viewer (6 providers: browser, kokoro, edge, openai, deepgram, elevenlabs)

### Server
- `packages/server/src/index.ts` - main Express app, websocket server, core task/file/agent routes
- `packages/server/src/routes/agent-api.ts` - `/api/documents/*` agent document API
- `packages/server/src/routes/docs.ts`, `search.ts`, `chat.ts` - docs/search/chat route modules
- `packages/server/src/routes/tts.ts` - TTS routes (6 providers: local-kokoro, browser, edge-tts, openai, deepgram, elevenlabs)
- `packages/server/src/fs/` - file routes, file-source routes, indexing, adapters, security
- `packages/server/src/editor/` - collaboration service/routes/ws/auth/reviews
- `packages/server/src/agent/` - Task Master config, scheduler, tools, events, log
- `packages/server/src/plugins/` - plugin manifest registry, migrations, mounted plugin routes
- `packages/server/src/swarm/` - swarm API, DB, dispatcher, providers, healer

### Database
- `packages/db/src/entity-db.ts` - shared SQLite connection
- `packages/db/src/index.ts` - task/activity/project/comment repositories
- `packages/db/src/document-collab.ts` - document collaboration state
- `packages/db/src/file-sources.ts`, `file-index.ts` - file source/index persistence
- `packages/db/src/chat.ts`, `agent-tokens.ts`, `task-sync.ts` - support repositories

## API Map

High-value API families:
- `/api/tasks/*` - task board, stale/duplicates, notes, comments, subtasks, projects, history
- `/api/fs/*` and `/api/sources/*` - file tree/read/write/search/source management
- `/api/file*` and `/api/files*` - legacy/core workspace file endpoints
- `/api/documents/*` - agent document creation, state, patches, ops, snapshot, presence, pending events
- `/api/agent/*` - Task Master status, trigger, log
- `/api/agents/*` - agent registry, status, activity, focus, grants, metrics
- `/api/plugins/*` - plugin list/detail/settings/toggle
- `/api/swarm/*` - jobs, providers, dispatch, claim/release, proof, complete/fail, healer
- `/api/entity-services/*` - operational services registry/status
- `/api/docs/*`, `/docs/*` - docs serving and TTS
- `/api/search/*` - document/search collections
- `/api/chat/*` - chat channels, messages, threads, send/setup
- `/api/tts/*` - TTS generation, voices, test endpoints for 6 providers

## Deployment And Runtime Reality

`deploy.sh` is the normal delivery path. It:
- runs release checks unless `ENTITY_ALLOW_DIRTY_DEPLOY=1`
- validates production task count before touching deployment
- backs up production DB and checkpoints WAL
- builds DB/server/app on Mac unless `ENTITY_SKIP_MAC_BUILD=1`
- rsyncs plugin source, DB dist, server dist, and app dist while excluding DB files
- preserves/fixes the server-dist DB symlink
- restarts the server on port 3000
- verifies post-deploy task count

Do not assume:
- the visible public UI matches the Mac checkout you just edited
- the DB on one host matches another host
- a local build means the public runtime is correct
- old `100.106.69.9` references identify the current deploy target

## Durable Coding Rules

1. Verify the live path after UI changes.
2. Continue diagnosis/fix/re-test if verification exposes an in-scope bug.
3. Treat DB files carefully; never casually reset or copy production DB files.
4. State which environment evidence comes from: Mac source, local dev, Enterprise runtime, or public URL.
5. For document-link/share features, verify URL state, refresh persistence, copy/share behavior, and clipboard fallback behavior.
6. Prefer source files over generated `dist`, `dist.old`, `dist_backup`, or backup files unless debugging build output.
7. After editing `packages/server/`, add/update colocated tests and run `cd packages/server && npx vitest run`.

## Known Sharp Edges

- Runtime/source drift has happened repeatedly.
- Production DB overwrite/corruption incidents are part of project history.
- `packages/app/package.json` is minified JSON.
- `packages/desktop` is a wrapper; root `electron/` is canonical.
- Some docs and code defaults still carry old hostnames.
- Browser verification can fail for environment reasons; use alternate evidence if needed, but prefer an eventual browser pass.
- Headless/browser environments may not expose `navigator.clipboard`.

## Current Project State (2026-04-28)

### Recently Completed
- **TTS Multi-Provider** — Docs viewer now has 6 TTS providers: Browser (native), Kokoro (local server on :8881), Edge-TTS (server-side CLI), OpenAI, Deepgram, ElevenLabs. Kokoro and Edge confirmed working. App rebuilt.
- **Task Detail Compactness** — MC task detail panel compressed so high-value fields fit above the fold. Build verified.
- **Swarm/eforge Integration** — Restored eforge status API, spec-edit dispatch flow, and provider-specific Swarm UI. Tests added.

### In Progress
- **#477** — Entity: Momentum loop circuit breaker
- **#421** — Entity: Agent identity + verification capability cards
- **#465** — Set up Gemma local models on Enterprise

### In Review (selected)
- **#486** — Toast Notifications — reduce scope or deprioritize
- **#440** — Fix Entity Linker black screen
- **#414** — Fix Entity audio + share UX
- **#490** — Workflow productization sprint: Claude-style business

### Board Stats (2026-04-28)
- Backlog: 35 | Todo: 25 | Doing: 4 | Review: 104 | Done: 302

### OpenAI Codex Context
OpenAI released **Codex** (February 2026) as a cloud-based software engineering agent and macOS desktop app ("intelligent agent command center"). The "Orchestration Symphony" announcement refers to multi-agent coordination — orchestration of multiple AI agents working together in a unified workflow. Relevant to Entity because:
- Entity's multi-agent crew (Ada, Spock, Scotty, Geordi, Zora, Book) implements a similar orchestration pattern
- The Swarm subsystem in Entity (dispatch, providers, healer) is Entity's equivalent of agent orchestration infrastructure
- Henry is building toward agent-native workspaces with verified identity and capability cards

## Maintenance Rule

Update this file when any of these change:
- architecture or monorepo structure
- major deployment workflow
- durable implementation constraints
- major API families or subsystem ownership
- production host/runtime assumptions
- project state (significant completions, major direction changes)

Keep `memory/projects/entity/todo.md` aligned for fast-moving operational state.

## Current Active Work (as of 2026-05-02)

### Session / Repo State For Codex

- Host/source checked: MascotM3, `~/Code/entity`.
- Branch: `codex/fix-edge-tts-docs`.
- HEAD: `afa8e4f feat: add ShowClaw featured Entity page`. Recent commits immediately before it include Edge TTS docs/runtime fixes and the browser-verification requirement.
- Working tree is dirty. Current modified/untracked paths observed 2026-05-02:
  - `codedb.snapshot`
  - `packages/app/src/components/TaskBoard.tsx`
  - `packages/app/src/components/mission-control/MCHeader.tsx`
  - `packages/server/src/agent/review-policy.ts`
  - `packages/server/src/index.ts`
  - `packages/server/dist/server/src/index.js`
  - `output/` with `output/entity/story-5-AgentsSidebarTab.tsx.snapshot` and `output/entity/story-5-agent-focus-proof.txt`
- `docs/plans/ACTIVE_PLAN.md` still describes completed Task Detail Compactness work for MC task #490. Treat that plan as stale/completed, not the current active implementation thread.

### Mission Control Review Gate / Review Filters (Dirty Tree)

The latest uncommitted Entity code is centered on stricter Mission Control review flow and review visibility.

Server changes in `packages/server/src/agent/review-policy.ts`:
- Adds typed review metadata: `review_type` (`henry`, `peer`, `auto`), `reviewer`, `henry_required`, `risk_level`, `review_packet`, `reviewed_by`, `reviewed_at`, `review_decision`, and `review_note`.
- `review_packet` is expected to include `requested_outcome`, `output_artifact`, `evidence`, `done_criteria`, and optional approval/Henry/external-risk flags.
- `validateReviewEntry()` gates tasks entering Review:
  - missing/invalid review type, reviewer, risk level, or packet fails
  - Henry review must be genuinely Henry-required/high-risk/approval/Henry-read/external-risk and route to Henry or Crew Conductor
  - peer review cannot be Henry-required/high-risk/approval/Henry-read/external-risk and must route to Ada, Book, or any
  - auto review schema exists, but machine validators are not enabled yet, so auto-close returns a failure by design
- `validateReviewCompletion()` gates tasks moving to Done:
  - actor comes from `X-Entity-Actor`, `X-Agent-Name`, or `body.actor`
  - reviewer cannot be the same as the assignee/producer
  - Henry-required reviews can only be completed by Henry or Crew Conductor
  - peer reviews can only be completed by Ada or Book in v1
  - `review_decision` must be `accepted`
  - `review_note` is required and must be at least 30 characters of validation evidence

Server changes in `packages/server/src/index.ts`:
- Active tasks in Todo/Doing/Review require an assignee.
- Moving a task into Review now validates the review packet and still runs existing review-output assessment.
- Moving a task into Done now validates review completion.
- The validation appears in both task update and task move code paths.

Frontend changes:
- `packages/app/src/components/TaskBoard.tsx` adds review metadata parsing and `matchesReviewFilter()`.
- `packages/app/src/components/mission-control/MCHeader.tsx` adds Review filter buttons: Henry, Peer, Needs Fix, Escalated, Recently Accepted.
- Global helper exposed: `window.filterByReview(filter)`. Supported filters: `henry`, `peer`, `needs_fix`, `escalated`, `accepted`, `all`.

Known pitfall:
- Review metadata must be parsed/merged as JSON before updating. A prior MC review issue lost `review_type` when metadata was merged without `fromjson`/JSON parsing. Preserve existing metadata keys unless intentionally replacing them.

### Verification Observed

- Targeted existing server test passed on MascotM3:
  - Command: `PATH=/opt/homebrew/bin:/opt/homebrew/sbin:$PATH npx vitest run src/agent/review-policy.test.ts` from `packages/server`
  - Result: `1 passed`, `10 tests passed`, duration about `171ms`
- Important limitation: the existing `review-policy.test.ts` verifies the older review-output scoring behavior. Add explicit tests for `validateReviewEntry()`, `mergeReviewMetadata()`, and `validateReviewCompletion()` before committing the new review-gate behavior.
- Full server build/Vitest and browser verification for the MC filter UI were not observed in this session.

### Recommended Next Steps For Codex

1. Start with `git status --short` and targeted `git diff` on the dirty files above. Do not assume the dirty tree is ready to commit.
2. Add colocated Vitest coverage in `packages/server/src/agent/review-policy.test.ts` for:
   - valid peer review packet
   - Henry-required packet rejected as peer
   - auto review rejected until validators are enabled
   - completion rejected when actor equals assignee
   - completion accepted for Ada/Book peer with `review_decision=accepted` and substantive `review_note`
3. Run `cd packages/server && PATH=/opt/homebrew/bin:/opt/homebrew/sbin:$PATH npm run build && PATH=/opt/homebrew/bin:/opt/homebrew/sbin:$PATH npx vitest run`.
4. Browser-check Mission Control review filter buttons and `window.filterByReview()` against real task metadata.
5. Keep formatting-only churn separate if possible. `packages/server/src/index.ts` currently has a very large diff; avoid expanding it unless necessary. Small creature. Big footprints.

### Other Recent Work Still Relevant

- TTS multi-provider work is no longer just initial admin wiring; recent branch commits include Edge TTS routing/runtime fixes. Re-check `packages/server/src/routes/tts.ts`, docs TTS routes, and current branch commits before using the older 2026-04-28 TTS status.
- HEAD adds a ShowClaw featured Entity page in `packages/app/src/App.tsx`. Treat that as committed branch state, not part of the dirty review-gate work.
- Task Detail Compactness remains done; the active plan file is stale/completed.
- ANE-013-017 agent-native editor context remains useful background only when working on comments/suggestions/presence/reviews.

## Status
- canonical: yes
- intended audience: agents editing/debugging Entity
- last refreshed: 2026-05-02
