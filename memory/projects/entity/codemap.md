# Entity Codemap

> Auto-generated on 2026-02-17 19:00 UTC

## Project Statistics

- **Frontend components:** 40+
- **Server routes/modules:** 15+
- **DB repositories:** 6
- **Files indexed (DocHub):** 4,699
- **TypeScript errors (pre-existing):** 166

---

## packages/app/src/ (React Frontend)

### Core Files
```
App.tsx                    # Root component — routing, auth, layout, all views (4600+ lines)
main.tsx                   # Vite entry point
config/runtime.ts          # API URL candidates, env detection
lib/http.ts                # requestJsonWithFallback, buildApiCandidates
lib/documents-client.ts    # Documents API client (bearer token auth)
```

### Components — Editor
```
CodeMirrorEditor.tsx       # Primary markdown/code editor (CodeMirror 6)
CodeMirrorFileViewer.tsx   # Read-only viewer
MarkdownPreview.tsx        # Live preview (react-markdown + GFM)
```

### Components — Agent-Native Editor (ANE)
```
CommentThread.tsx          # Comment threads with @mention support, inline anchors
NewCommentPopover.tsx      # Popover UI to add new comments
SuggestionPanel.tsx        # Track changes panel (accept/reject)
ReviewPanel.tsx            # Review pipeline UI (findings, severity badges)
PresenceChips.tsx          # Who's editing in header (real-time)
editor/AuthorshipStatsPanel.tsx  # Per-actor authorship attribution stats
```

### Components — DocHub / File System
```
SourceFileTree.tsx         # Multi-source collapsible file tree
                           #   - Per-source search (debounced 180ms)
                           #   - Sort: A-Z↑ / New↓ (merged button)
                           #   - Icon-based create: 📄 (file) / 📁 (folder)
                           #   - Persists expansion state to localStorage
UnifiedFileDashboard.tsx   # Cross-source unified search
                           #   - Filters: source, type, agent
                           #   - Results with preview snippets
FileTree.tsx               # Legacy single-directory file browser
```

### Components — Task Board (Mission Control)
```
TaskBoard.tsx              # Kanban board container
mission-control/
  MCHeader.tsx             # Top header with view tabs
  MCOpsView.tsx            # Operations kanban (5 columns)
  MCStrategicView.tsx      # Strategic overview
  MCAgentsView.tsx         # Agent task view
  MCFilterBar.tsx          # Assignee/column filters
  MCModals.tsx             # Task creation + detail modals
```

### Components — Agents
```
AgentDashboardV2.tsx       # Real-time agent status dashboard
AgentsSidebarTab.tsx       # Sidebar tab for agents list
AgentsMobileDetail.tsx     # Mobile agent detail view
```

### Components — Admin / Settings
```
settings/FileSourcesSettings.tsx  # Manage file sources (add/edit/delete/enable)
TaskMasterSettings.tsx            # Task Master AI agent settings
                                  #   - Status card (enabled, model, totalActions, lastRun)
                                  #   - Manual trigger buttons
                                  #   - Config display (thresholds, provider)
                                  #   - Recent logs viewer with event badges
```

### Components — UI
```
ActivityStream.tsx          # Unified agent + task activity timeline
QuickSwitcher.tsx           # Cmd+P file quick switcher
NotificationHistoryPanel.tsx # Bell icon + notification history
FileHistoryPanel.tsx        # Inline diff, last 10 versions
Toast.tsx                   # Toast notifications viewport
MobileBottomNav.tsx         # Bottom nav for mobile (Files/Agents/Tasks/Activity)
SyncStatusBadge.tsx         # Online/offline indicator (green/gray dot)
```

### Hooks
```
hooks/useActivityStream.ts  # WebSocket → activity events
hooks/useTaskBoard.ts       # Task CRUD, column management, filtering
hooks/useFileSources.ts     # File source CRUD + tree/search/read/write API calls
hooks/useFollowMode.ts      # Follow specific agent's file changes
hooks/useWatchModeAutoFollow.ts  # Auto-switch file when agent changes
hooks/useWebSocket.ts       # Generic WebSocket connection manager
hooks/useIsMobile.ts        # Responsive breakpoint detection (768px)
hooks/useNotificationCenter.ts   # Toast + history management
hooks/useSyncStatus.ts      # Online/offline detection
```

### Types
```
types/filesystem.ts         # FileSource, SourceNode, SourceTreeResponse, UnifiedSearchResult
types/collaboration.ts      # DocumentCommentThread, DocumentSuggestionUiRecord,
                            # DocumentReviewRunRecord, DocumentPresenceRecord,
                            # DocumentAuthorshipStats, etc.
```

---

## packages/server/src/ (Express Backend)

### Entry Point
```
index.ts                   # Main server file (4000+ lines)
                           #   - Express setup, CORS, WebSocket
                           #   - Feature flag parsing (FS_MULTISOURCE, ANE, AGENT)
                           #   - All route registration
                           #   - File system + document routes
                           #   - Auto-init sources on startup
file-types.ts              # detectContentType() — extension → MIME type
                           #   - 60+ extensions mapped
                           #   - Image/PDF binary preview support
```

### Agent Module (Task Master)
```
agent/
  index.ts                 # TaskAgent class
                           #   - handleTaskMovedToReview()
                           #   - handleOutputMissing()
                           #   - runStaleScan()
                           #   - trigger() — dispatches by event type
                           #   - getStatus() / getLog()
  config.ts                # AGENT_CONFIG
                           #   - model: "gemini-2.0-flash"
                           #   - scanIntervalMs: 1800000 (30min)
                           #   - staleThresholdHours: { doing: 24, review: 48 }
                           #   - maxActionsPerScan: 10
                           #   - enabled: reads ENTITY_AGENT_ENABLED env var
  tools.ts                 # Agent tools: searchTasks, updateTask, addNote, moveTask, notifyAgent
  events.ts                # Event handlers: onTaskMovedToReview, onTaskStale, onOutputMissing
                           #   - collectStaleCandidates()
  scheduler.ts             # 30-min interval scheduler
  log.ts                   # writeAgentLog(), listAgentLogs(), getAgentStatus()
```

### File System Module
```
fs/
  index.ts                 # registerFileSystemRoutes() — FS API routes
  index-runner.ts          # FileIndexRunner class
                           #   - runOnce() — indexes all enabled sources
                           #   - runOnceForSource(sourceId)
                           #   - MAX_DIRECTORIES_PER_SOURCE = 500
                           #   - MAX_SOURCE_DEPTH = 8
                           #   - IGNORED_DIRECTORIES: node_modules, .git, dist,
                           #     .venv, box, tmp, secrets, calls, etc.
  classify.ts              # classifyFile() — type, agent, recurring, tags, contentHash
  security.ts              # assertSourceEnabled(), normalizeSourceRelativePath(), emitFsAudit()
  metrics.ts               # recordFsOperation() — perf tracking
  adapters/
    registry.ts            # createFileSourceAdapter() — factory by source type
    local.ts               # Local filesystem adapter (fs.readdir/readFile)
    docsify.ts             # HTTP adapter for docsify sites
    workspace.ts           # Agent workspace adapter
```

### Editor Module (ANE Backend)
```
editor/
  index.ts                 # registerEditorModule() — documents + collaboration routes
  documents-db.ts          # Documents SQLite schema + repositories
  presence.ts              # Real-time presence tracking (WebSocket)
  review.ts                # OpenClaw review pipeline dispatch
  authorship.ts            # Authorship range tracking
```

### Routes
```
routes/
  search.ts                # createSearchRouter() — unified full-text search
```

---

## packages/db/src/ (Database Layer)

```
index.ts                   # Main exports
                           #   - TaskRecord, CreateTaskInput interfaces
                           #   - TASK_COLUMNS = ['backlog','todo','doing','review','done']
                           #   - createActivityRepository()
                           #   - createTaskCommentRepository()
                           #   - getProjects(), createProject(), deleteProject()
                           #   - getRoadmaps(), createRoadmap(), etc.
entity-db.ts               # getEntityDatabase() — DB connection singleton
file-sources.ts            # createFileSourceRepository()
                           #   - listSources(), getSource(), createSource()
                           #   - updateSource(), deleteSource()
file-index.ts              # createFileIndexRepository()
                           #   - upsertRecord(), startSyncRun(), finishSyncRun()
                           #   - searchFiles(), listRecords()
task-sync.ts               # createTaskSyncLayer() — abstraction (local SQLite / cloud REST)
entity-tasks.db            # Production SQLite DB (4MB+, 228+ tasks) — NEVER overwrite
entity-documents.db        # Documents collaboration DB
```

---

## Key Config Files

```
packages/app/package.json      # React app deps
packages/server/package.json   # Server deps (express, ws, better-sqlite3, @ai-sdk/google)
packages/db/package.json       # DB deps
package.json                   # Workspace root
.env                           # Environment variables (not in git)
.rsync-exclude                 # Excludes *.db, .env, node_modules from deploy rsync
/etc/systemd/system/entity.service  # Production service definition
```

---

## Git History (Recent)

```
fcf33b3 feat: Task Master settings page (TaskMasterSettings.tsx)
f1ce0b1 fix: Task Master API paths (need /api/ prefix)
b9b5023 fix: activity stream real API data (not mock)
3e4a737 refactor: remove redundant Active Tasks sidebar section
5e598e1 fix: harmonize activity cards to "Entity ⚡"
01eb7b0 chore: remove Entity from default auto-init sources
6780353 fix: auto-init sources + flip feature flag defaults to true
0c8ecc0 feat: auto-init Obsidian Vault source
723b6a1 feat: Entity Tier 1 TaskAgent (Gemini Flash)
         (agent/, agent_log table, /api/agent/* routes)
[earlier: DocHub, ANE, MC integration commits]
```

---

_Auto-generated by scripts/update-context.sh on 2026-02-17_
