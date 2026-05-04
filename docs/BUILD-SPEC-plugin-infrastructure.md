# BUILD SPEC: Entity Plugin Infrastructure

**Status:** Ready to build  
**Builder:** Geordi (ACP/Codex on Mac)  
**Repo:** `~/Code/entity` on Mac  
**Context:** `docs/PLUGIN-ARCHITECTURE-SPEC.md`, `docs/ENTITY-PLUGIN-BUILD-GUIDE.md`

---

## Goal

Add real plugin infrastructure to Entity so plugins can register, mount, and be managed — not just exist as docs.

---

## Current Entity Architecture (what exists)

### Top-level modules (WorkspaceTab)
Entity's shell has 5 top-level tabs in the sidebar:
```typescript
type WorkspaceTab = 'files' | 'agents' | 'tasks' | 'chat' | 'admin';
```

### Sub-views within modules
Tasks/Mission Control has sub-views:
```typescript
type MCBoardTab = 'ops' | 'strategic' | 'insights';
```
These render as sub-navigation buttons within the Tasks module.

### Server
- Express + WebSocket (`packages/server/src/index.ts`)
- SQLite via better-sqlite3
- Routes registered directly in index.ts
- No plugin loader, no hook emitter, no plugin settings table

### UI
- React 19, single `App.tsx` (~5000+ lines)
- Sidebar tab switching via `sidebarTab` state
- MC sub-views via `mcBoardTab` state
- No plugin registry, no dynamic slot mounting

---

## What to build

### Part 1: Plugin Registry (Server)

#### 1.1 Plugin manifest loader
- On server boot, scan for plugin manifests
- Look in `packages/server/src/plugins/` for directories containing `plugin.json`
- Validate each manifest against the schema (basic: check required fields, valid kind, valid capabilities)
- Store loaded plugins in an in-memory registry

**File:** `packages/server/src/plugins/registry.ts`

```typescript
interface LoadedPlugin {
  id: string;
  name: string;
  version: string;
  kind: 'behavior' | 'integration' | 'product' | 'runtime' | 'data-source' | 'ui';
  description: string;
  capabilities: string[];
  enabled: boolean;
  hooks: string[];
  ui?: {
    mountPoint: PluginMountPoint;
    component: string;
    label: string;
    icon?: string;
  };
  routes?: { basePath: string; entry: string }[];
  status: {
    loaded: boolean;
    lastError?: string;
    registeredAt: string;
  };
}

// Where a plugin's UI can mount
type PluginMountPoint =
  | { type: 'top-level-tab' }                           // new WorkspaceTab (rare, heavyweight)
  | { type: 'module-sub-view'; module: string }          // sub-tab within an existing module (e.g. Swarm inside Tasks)
  | { type: 'detail-panel-section'; module: string }     // section inside a detail view (e.g. linked jobs in task detail)
  | { type: 'admin-section' }                            // section in admin/settings
  | { type: 'none' }                                     // backend-only, no UI
```

#### 1.2 Plugin settings table
Create `plugin_settings` table in the existing SQLite DB.

```sql
CREATE TABLE IF NOT EXISTS plugin_settings (
  plugin_id    TEXT PRIMARY KEY,
  enabled      INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### 1.3 Plugin routes
Add API endpoints for plugin management:

```
GET    /api/plugins              — list all registered plugins + status
GET    /api/plugins/:id          — get single plugin detail
PATCH  /api/plugins/:id/toggle   — enable/disable a plugin
PATCH  /api/plugins/:id/settings — update plugin settings
```

#### 1.4 Plugin route mounting
For plugins that declare `routes` in their manifest:
- Mount their route handler under their declared `basePath`
- Only mount if plugin is enabled
- Namespace enforcement: plugin routes MUST be under `/api/<plugin-id>`

#### 1.5 Hook event emitter
Add a simple event emitter that core Entity fires on key lifecycle events.
Plugins subscribe during registration.

```typescript
// packages/server/src/plugins/hooks.ts
class PluginHookEmitter {
  on(hook: string, pluginId: string, handler: Function): void;
  emit(hook: string, payload: any): Promise<void>;
  remove(pluginId: string): void;
}
```

Hooks to emit from existing code (wire into existing task CRUD):
- `task:created` — after POST /api/tasks
- `task:updated` — after PATCH /api/tasks/:id
- `task:moved` — after PUT /api/tasks/:id/move

Future hooks (don't wire yet, just define):
- `message:outbound`
- `message:inbound`

#### 1.6 Plugin migration runner
On boot, after loading manifests:
- Check if plugin declares `storage.migrationsDir`
- Run any `.sql` files in that directory that haven't been run
- Track in a `plugin_migrations` table:

```sql
CREATE TABLE IF NOT EXISTS plugin_migrations (
  plugin_id    TEXT NOT NULL,
  filename     TEXT NOT NULL,
  applied_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (plugin_id, filename)
);
```

---

### Part 2: Plugin UI Registry (App)

#### 2.1 Plugin mount point system

Plugins can mount their UI in these locations:

**Mount point A — Top-level tab** (new sidebar tab)
- Extends `WorkspaceTab` union
- Adds an icon + label to the sidebar
- Renders the plugin's component as the main content area
- Use sparingly — this is prime real estate

**Mount point B — Module sub-view** (sub-tab within existing module)
- Example: "Swarm" appears as a sub-tab inside Tasks, alongside Ops/Strategic/Insights
- The plugin specifies which module it attaches to: `tasks`, `files`, `agents`, `chat`, `admin`
- Renders as a button in that module's sub-navigation bar

**Mount point C — Detail panel section** (inside a detail view)
- Example: "Linked Swarm Jobs" section inside TaskDetailPanel
- Plugin provides a component that receives the parent entity (task, file, agent) as props
- Renders as an additional section in the relevant detail view

**Mount point D — Admin/Settings section**
- Always available for any plugin
- Shows in admin tab under a "Plugins" section
- Lists all registered plugins with name, status, enabled toggle
- Each plugin can optionally provide a settings component

**Mount point E — None (backend only)**
- Plugin has no UI
- Still appears in the admin plugin list with status and toggle
- Example: Entity Linker

#### 2.2 Plugin UI store

```typescript
// packages/app/src/stores/pluginStore.ts (Zustand)
interface PluginUIEntry {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  mountPoint: PluginMountPoint;
  label: string;
  icon?: string;
  component?: React.LazyComponent;  // lazy-loaded
}

interface PluginStore {
  plugins: PluginUIEntry[];
  fetchPlugins: () => Promise<void>;
  togglePlugin: (id: string) => Promise<void>;
  getPluginsForMount: (mountType: string, module?: string) => PluginUIEntry[];
}
```

#### 2.3 Dynamic sub-view injection

For "module sub-view" plugins (like Swarm inside Tasks):

In the Tasks module's sub-navigation bar (where Ops/Strategic/Insights buttons are):
- After the built-in tabs, render additional buttons for any plugins mounted as `{ type: 'module-sub-view', module: 'tasks' }`
- When clicked, render that plugin's component in the main content area
- Same pattern applies to other modules if they have sub-views

#### 2.4 Admin plugins page

Add a "Plugins" section to the admin tab:
- List all registered plugins (from `/api/plugins`)
- Show: name, version, kind, status (loaded/error), enabled toggle
- Click a plugin → show its description, capabilities, mount point, settings
- Enable/disable toggle calls `PATCH /api/plugins/:id/toggle`

#### 2.5 Detail panel extension slots

In `TaskDetailPanel.tsx`:
- After the built-in sections, render a slot for plugin sections
- Query plugin store for plugins with `{ type: 'detail-panel-section', module: 'tasks' }`
- Render each plugin's component, passing the current task as props

---

### Part 3: Wire up Geordi Swarm as first consumer

After the infrastructure is in place:

#### 3.1 Create Swarm plugin manifest
Place at `packages/server/src/plugins/geordi-swarm/plugin.json`:
```json
{
  "id": "geordi-swarm",
  "name": "Geordi Swarm",
  "version": "0.1.0",
  "kind": "product",
  "description": "Autonomous code factory — dispatch build jobs to AI coding agents",
  "capabilities": ["ui.task-detail.extend", "api.routes.register", "data.tables.own", "tasks.events.observe", "admin.settings.register"],
  "hooks": ["task:created", "task:updated", "task:moved"],
  "ui": {
    "mountPoint": { "type": "module-sub-view", "module": "tasks" },
    "component": "SwarmBoard",
    "label": "Swarm",
    "icon": "factory"
  },
  "routes": [{ "basePath": "/api/swarm" }],
  "settings": {
    "defaultProvider": "acp",
    "maxConcurrentJobs": 2,
    "autoDispatch": false
  },
  "storage": {
    "tables": ["swarm_jobs", "swarm_proofs"],
    "migrationsDir": "./migrations"
  }
}
```

#### 3.2 Register existing Swarm code
The existing `packages/server/src/swarm/` and `packages/app/src/components/SwarmBoard.tsx` should be wired through the plugin system instead of being hardcoded.

---

## What NOT to build

- No marketplace/install/uninstall flow
- No plugin sandboxing or permission enforcement
- No hot-reload of plugins (restart required)
- No cross-plugin communication
- No new top-level modules (just the infrastructure to support them)
- No Entity Linker migration (it's an OpenClaw plugin, not an Entity plugin)

---

## File structure (new files)

```
packages/server/src/
  plugins/
    registry.ts          — manifest loader, plugin registry
    hooks.ts             — event emitter for task/lifecycle hooks  
    migrations.ts        — plugin migration runner
    routes.ts            — /api/plugins management endpoints
    types.ts             — shared types
    geordi-swarm/        — first plugin (move existing swarm code here)
      plugin.json
      migrations/
        001-create-tables.sql

packages/app/src/
  stores/
    pluginStore.ts       — Zustand store for plugin UI state
  components/
    plugins/
      PluginAdminPanel.tsx    — admin page listing all plugins
      PluginSubViewSlot.tsx   — renders plugin sub-views within a module
      PluginDetailSlot.tsx    — renders plugin sections in detail panels
```

---

## Mount point summary

| Mount point | Where it appears | Example | Declared in manifest |
|---|---|---|---|
| top-level-tab | Sidebar navigation (alongside files/agents/tasks/chat/admin) | Future: "Analytics" module | `{ type: "top-level-tab" }` |
| module-sub-view | Sub-navigation within a module | Swarm tab inside Tasks (next to Ops/Strategic) | `{ type: "module-sub-view", module: "tasks" }` |
| detail-panel-section | Inside a detail view | Linked jobs in task detail panel | `{ type: "detail-panel-section", module: "tasks" }` |
| admin-section | Admin/Settings tab | Plugin management + per-plugin settings | Always present for all plugins |
| none | No UI | Entity Linker (backend-only) | `{ type: "none" }` |

---

## Acceptance criteria

- [ ] Server boots, scans `plugins/` directory, loads manifests, logs registered plugins
- [ ] `GET /api/plugins` returns list of all plugins with status
- [ ] `PATCH /api/plugins/:id/toggle` enables/disables a plugin, persisted in `plugin_settings`
- [ ] Plugin routes are mounted under declared basePaths (only when enabled)
- [ ] Hook emitter fires `task:created`, `task:updated`, `task:moved` and plugins receive them
- [ ] Plugin migrations run on boot for new plugins
- [ ] Admin tab shows "Plugins" section with list, status, and toggle
- [ ] Geordi Swarm appears as a sub-view tab inside Tasks module (not top-level sidebar)
- [ ] Task detail panel shows plugin extension slots
- [ ] Disabling a plugin hides its UI and stops its routes
- [ ] No changes to core `tasks` table schema

---

## Build order

1. **Server: types + registry + settings table** — foundation
2. **Server: hook emitter** — wire into existing task CRUD
3. **Server: plugin route mounting** — enable /api/swarm through plugin system
4. **Server: migration runner** — enable plugin-owned tables
5. **Server: /api/plugins management routes** — enable admin UI
6. **App: plugin store** — fetch and cache plugin state
7. **App: admin plugins panel** — show registered plugins with toggles
8. **App: sub-view slot** — render plugin tabs within modules
9. **App: detail panel slot** — render plugin sections in task detail
10. **Wire: move Swarm into plugins/ and register via manifest**

---

*Ship this and Entity becomes a platform, not just an app.* 🔧
