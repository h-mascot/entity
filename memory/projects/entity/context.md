# Entity Project Context

> Mission: AI-native workspace where humans and AI agents work side by side across files, tasks, documents, plugins, and operational tooling.

_Last refreshed: 2026-05-02_

## What Entity Is

Entity is the shared workspace for the Enterprise Crew and human operators. It brings together:
- file/document browsing, editing, preview, search, sharing, and deep links
- agent registry/status/activity/focus surfaces
- Mission Control tasks, kanban, notes, comments, projects, history, duplicates
- agent-native document collaboration with comments, suggestions, reviews, presence, and patches
- plugin/service surfaces including Entity Services, Entity Linker, Geordi Swarm, and `/api/swarm`
- supporting terminal, chat, activity stream, and notification-history surfaces

## Current Source And Runtime

- Mac source of truth: `~/Code/entity`
- GitHub: `https://github.com/henrino3/entity`
- Deploy script: `~/Code/entity/deploy.sh`
- Default production SSH target: `enterprise@100.104.229.62`
- Default production URL: `http://100.104.229.62:3000`
- Runtime checkout: `/Users/enterprise/Services/entity`
- Production DB: `/Users/enterprise/Services/entity/packages/db/entity-tasks.db`

Some current code defaults still reference `http://100.106.69.9:3000` or nearby ports for legacy/adjacent services. Verify the intended host before changing URL-sensitive behavior.

## Stack

| Component | Current evidence |
|-----------|------------------|
| Frontend | React 18.3.1, TypeScript, Vite 5, Tailwind 3, CodeMirror 6, Tiptap 3, Zustand |
| Backend | Express 4, WebSocket (`ws`), TypeScript, Vitest |
| DB | SQLite via `better-sqlite3`; repositories in `packages/db/src` |
| AI agent | Vercel AI SDK `ai` 6 + `@ai-sdk/google` 3 |
| Desktop | Electron 34.5.8 from root `electron/` |
| Mobile | Expo SDK 52, React Native 0.76, WebView shell |

## Monorepo Structure

```text
entity/
├── packages/
│   ├── app/       # Vite React frontend
│   ├── server/    # Express/WebSocket backend and APIs
│   ├── db/        # SQLite repositories and DB artifacts
│   ├── mobile/    # Expo shell
│   └── desktop/   # wrapper delegating to root electron
├── electron/      # canonical Electron package/build config
├── docs/          # specs, context, plans, implementation docs
├── docs/plans/    # ACTIVE_PLAN.md and durable plans
└── memory/projects/entity/ # compact context/todo/timeline/codemap
```

## Key Files

Frontend:
- `packages/app/src/App.tsx` - app shell and cross-surface wiring
- `packages/app/src/config/runtime.ts` - API/WS/feature flag defaults
- `packages/app/src/components/TaskBoard.tsx`, `components/mission-control/TaskDetailPanel.tsx` - Mission Control UI
- `packages/app/src/components/UnifiedFileDashboard.tsx`, `SourceFileTree.tsx`, `DocumentViewer.tsx`, `FileHistoryPanel.tsx` - file/document UI
- `packages/app/src/components/AgentDashboardV2.tsx`, `AgentsSidebarTab.tsx`, `ActivityStream.tsx`, `NotificationHistoryPanel.tsx` - agent/activity UI
- `packages/app/src/components/SwarmBoard.tsx`, `EntityServicesBoard.tsx` - swarm/plugin/services UI
- `packages/app/src/components/BottomTerminalPanel.tsx`, `OfflineAwareChat.tsx` - terminal/chat UI

Server:
- `packages/server/src/index.ts` - main Express app, websocket, core task/file/agent routes
- `packages/server/src/routes/agent-api.ts` - `/api/documents/*`
- `packages/server/src/routes/docs.ts`, `routes/search.ts`, `routes/chat.ts` - docs/search/chat APIs
- `packages/server/src/fs/` - file tree, file read/write, source management, indexing, security, adapters
- `packages/server/src/editor/` - collaboration service/routes/ws/auth/reviews
- `packages/server/src/agent/` - Task Master config, scheduler, tools, events, log
- `packages/server/src/plugins/` - plugin registry, migrations, mounted plugin routes
- `packages/server/src/swarm/` - swarm jobs/providers/dispatcher/healer

Database:
- `packages/db/src/entity-db.ts` - shared SQLite connection
- `packages/db/src/index.ts` - task/activity/project/comment repositories
- `packages/db/src/document-collab.ts` - document collaboration persistence
- `packages/db/src/file-sources.ts`, `file-index.ts` - file source/index persistence

## API Families

- `/api/tasks/*` - tasks, stale/duplicates, notes, comments, projects, history
- `/api/fs/*` and `/api/sources/*` - file tree/read/write/search/source management
- `/api/documents/*` - agent document state, patches, ops, presence, events
- `/api/agent/*` and `/api/agents/*` - Task Master plus agent registry/status/activity/focus
- `/api/plugins/*` and plugin-mounted routes - plugin registry/settings/toggles and plugin surfaces
- `/api/swarm/*` - swarm job lifecycle, providers, proof, healer
- `/api/entity-services/*` - services registry/status
- `/api/docs/*`, `/api/search/*`, `/api/chat/*` - docs/search/chat support routes

## Deployment Rules

1. Mac repo is source of truth for normal changes.
2. Use `./deploy.sh`; do not hand-rsync production.
3. `deploy.sh` builds on Mac, backs up/checkpoints the production DB, excludes DB files from sync, restarts port 3000, and verifies task count.
4. Never reset, checkout, stash, or overwrite DB files on the production runtime checkout during normal work.
5. Verify host/process/checkout/DB path before claiming live behavior is fixed.

## Commands

```bash
npm install
npm --prefix packages/app run build
cd packages/server && npm run build
cd packages/server && npx vitest run
./deploy.sh
```

After any `packages/server/` source edit, add/update colocated Vitest coverage when practical and run `cd packages/server && npx vitest run`.

## Sharp Edges

- Runtime/source drift is common enough to verify explicitly.
- DB files in `packages/db` are real state artifacts; never overwrite production DBs from Mac.
- Generated/backup trees exist under `packages/app/dist*` and `packages/db/dist`; prefer `src` unless debugging generated output.
- `packages/desktop` is not canonical for Electron packaging; root `electron/` is.
- `ENTITY_FS_MULTISOURCE` and `ENTITY_AGENT_NATIVE_EDITOR` default true.
- Clipboard/share/deep-link work needs browser verification where possible.

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
