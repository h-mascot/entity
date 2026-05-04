# Entity Plugin Infrastructure

**Status:** Proposed v0.1  
**Purpose:** Define the minimum infrastructure Entity should support so plugins are understandable, isolated, and repeatable.

---

## 1. Minimum required infrastructure

Entity should support these first-class plugin concepts.

### 1. Manifest loading
Entity must be able to discover and validate a plugin manifest.

Minimum manifest concerns:
- identity
- plugin kind
- version compatibility
- capabilities
- entrypoints
- hooks
- routes
- UI slots
- storage ownership

Reference files:
- `docs/ENTITY-PLUGIN-MANIFEST.schema.json`
- `docs/ENTITY-PLUGIN-MANIFEST.example.json`

### 2. Route mounting
Plugins should be able to mount namespaced server routes.

Pattern:
- plugin owns `/api/<plugin-id>`
- core router loads plugin route entrypoint
- plugin cannot hijack unrelated paths

### 3. UI registration
Plugins should be able to register:
- sidebar tabs
- task detail sections
- settings sections
- future command palette actions

### 4. Hook/event subscriptions
Core should emit stable events for plugins to subscribe to.

Minimum V1 hooks:
- `task:created`
- `task:updated`
- `task:moved`
- `message:outbound`
- `message:inbound`
- `subagent:spawning`
- `subagent:ended`
- `subagent:delivery-target`

### 5. Plugin-owned settings
Core should persist namespaced plugin settings separately from manifests.

Suggested table:

```sql
CREATE TABLE plugin_settings (
  plugin_id    TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

### 6. Plugin-owned migrations
Plugins should be able to declare migrations for plugin-owned tables.

Rules:
- plugin can create/update only its own tables
- plugin cannot alter core tables unless explicitly approved
- migrations should run through the same migration framework as core, but namespaced

### 7. Namespaced websocket/event emission
Plugins should be able to emit namespaced events.

Examples:
- `swarm:job:updated`
- `swarm:proof:ready`

### 8. Status + health registration
Plugins should expose:
- enabled/configured
- last error
- last successful run
- health probe status

---

## 2. Soft plugin fallback

Until formal plugin loading is complete, Entity can support **soft plugins** by convention.

A soft plugin must still:
- use a manifest
- use namespaced routes
- use plugin-owned tables
- use documented UI extension points
- avoid core schema mutation

That means the infrastructure is conceptually there even before the loader is fully generic.

---

## 3. Recommended extension points

### Server
- route registration
- migration registration
- hook subscription
- websocket namespace registration

### App/UI
- sidebar tab slot
- task detail extension slot
- settings page section slot
- future command palette slot

### Data
- plugin settings store
- plugin-owned migrations
- plugin-owned table ownership registry

---

## 4. Ownership rules

Core owns:
- canonical task schema
- canonical task lifecycle semantics
- shell navigation
- global auth/runtime
- shared websocket transport

Plugins may own:
- plugin-local tables
- plugin-local routes
- plugin-local settings
- plugin-local views/components
- plugin-local orchestrators/providers

---

## 5. V1 implementation target

For the near term, “Entity supports plugins” should mean:

- [ ] manifest schema exists
- [ ] example manifest exists
- [ ] plugin build guide exists
- [ ] architecture spec exists
- [ ] route/UI/hook/settings/migration extension points are documented
- [ ] project context references these docs

That gives Henry and the crew a usable internal plugin platform before the fully generic loader lands.

---

## 6. Recommended next build tasks

1. Add a lightweight plugin registry in server boot
2. Add a sidebar/task-detail UI registry on the app side
3. Add `plugin_settings` persistence
4. Formalize plugin migration loading
5. Add a status/debug page for installed plugins

---

## 7. What to tell future agents

Use the docs pack in this order:

1. `PLUGIN-ARCHITECTURE-SPEC.md`
2. `ENTITY-PLUGIN-INFRASTRUCTURE.md`
3. `ENTITY-PLUGIN-BUILD-GUIDE.md`
4. `ENTITY-PLUGIN-MANIFEST.schema.json`
5. `ENTITY-PLUGIN-MANIFEST.example.json`

If an agent skips these and starts freehanding a plugin, that is how we get haunted houses in `packages/server/src`.
