# Entity Plugin Build Guide

**Audience:** Ada, Geordi, Scotty, Ralph, future agents, and Henry when he is feeling especially dangerous.  
**Purpose:** How to build a plugin for Entity without turning the repo into an archaeological dig.

---

## 1. What counts as an Entity plugin

A plugin is any isolated extension that adds behavior to Entity through declared boundaries.

There are two main shapes right now:

1. **Runtime / behavior plugin**
   - Example: Entity Linker
   - Hooks message or runtime pipelines
   - Usually transform/route/observe work

2. **Product / module plugin**
   - Example: Geordi Swarm
   - Adds its own UI, routes, tables, orchestrator, and settings
   - References core Entity surfaces without mutating their canonical schema

If you’re building something inside Entity that should be removable, separately understandable, and not fused into core logic, treat it like a plugin.

---

## 2. Rules first

### Do
- keep plugin data in plugin-owned tables or stores
- declare routes, hooks, UI slots, and capabilities up front
- prefer extension points over patching internals
- keep domain logic separate from host glue
- make extraction into a true plugin mechanical even if you ship as a soft plugin first

### Don’t
- add columns to core tables unless explicitly approved
- hardcode plugin logic directly inside unrelated core components
- let plugin code own global runtime/auth concerns the host already owns
- invent mystery conventions no other agent can discover later

---

## 3. Decide the plugin type

Use this quick classification.

### Behavior plugin
Use when you are:
- rewriting content
- routing output
- enriching events
- observing lifecycle events

### Product plugin
Use when you are:
- adding a new sidebar tab/view
- adding routes under `/api/...`
- owning plugin-specific tables
- running a dispatcher/orchestrator loop
- introducing provider abstractions

### Data-source plugin
Use when you are:
- adding a source adapter
- adding a preview/indexing pipeline
- enriching document metadata

---

## 4. Soft plugin vs true plugin

### Soft plugin
Ship as a co-located module in the repo when full plugin infra is not there yet.

Allowed if:
- routes are namespaced
- tables are plugin-owned
- UI is mounted through a documented slot
- settings are namespaced
- extraction later is straightforward

### True plugin
Use a formal manifest, loader, and registration mechanism.

Target state for Entity.

Rule of thumb:
- if the infrastructure exists, use it
- if not, build as a soft plugin but behave like a true plugin anyway

---

## 5. Required plugin anatomy

Every Entity plugin should have these parts.

```text
my-plugin/
├── manifest
├── server glue
├── UI glue (if any)
├── hook handlers
├── domain logic
├── settings defaults
├── storage/migrations (if any)
└── tests
```

### Required concepts
- **manifest** — what this plugin is and what it touches
- **capabilities** — what it is allowed to do
- **entrypoints** — server/UI files
- **hooks** — task/message/runtime events it subscribes to
- **boundaries** — what it owns, what it does not own

---

## 6. Canonical build flow for agents

### Step 1 — read context
Before building a plugin:
- read `docs/PLUGIN-ARCHITECTURE-SPEC.md`
- read this guide
- read project context in `~/clawd/memory/projects/entity/context.md`
- inspect adjacent implementation patterns already in repo

### Step 2 — write the manifest first
Before implementation, write:
- `id`
- `kind`
- `description`
- `capabilities`
- `entrypoints`
- `routes`
- `ui slots`
- `storage`
- `ownerBoundaries`

Use:
- `docs/ENTITY-PLUGIN-MANIFEST.schema.json`
- `docs/ENTITY-PLUGIN-MANIFEST.example.json`

### Step 3 — define the boundaries
Answer explicitly:
- what core surfaces does it observe?
- what payloads can it modify?
- what data does it own?
- what settings does it own?
- what happens if it fails?

### Step 4 — choose the narrowest extension point
Examples:
- content rewrite → outbound message pipeline
- linked jobs on task detail → task detail extension slot
- plugin API → namespaced route mount
- plugin data → plugin-owned tables

### Step 5 — implement host glue thinly
Host glue should be boring.

Examples:
- route registration
- hook registration
- websocket namespace registration
- slot mounting

### Step 6 — keep domain logic pure
Good:
- `rewriteEntityPaths(text)`
- `dispatchJob(job, provider)`
- `collectProof(runHandle)`

Bad:
- giant component/file with UI, DB, hooks, routes, and state machine all mixed together like stew

### Step 7 — test the contract
At minimum:
- happy path
- no-op path
- malformed config/input
- failure path
- double-application or retry path

For product plugins also test:
- migrations
- state transitions
- route registration
- UI smoke

### Step 8 — document the extension points you needed
If you had to invent or depend on a new slot/hook/namespace, write it down in docs before calling it done.

---

## 7. Naming conventions

### Plugin ID
- kebab-case
- stable
- descriptive
- no vanity nonsense

Examples:
- `entity-linker`
- `geordi-swarm`
- `doc-reviewer`

### Route base paths
- always under `/api/<plugin-id>` where practical

Examples:
- `/api/swarm`
- `/api/entity-linker`

### Tables
- prefix with plugin concept

Examples:
- `swarm_jobs`
- `swarm_proofs`
- `plugin_settings`

### WebSocket events
- namespace with plugin prefix

Examples:
- `swarm:job:updated`
- `swarm:proof:ready`

---

## 8. Boundaries with Entity core

### Safe
- referencing `tasks.id`
- rendering linked plugin state in task detail
- listening to task lifecycle events
- emitting namespaced activity events

### Not safe without approval
- changing `tasks` table schema
- hijacking core sidebar navigation behavior
- storing plugin data in unrelated core tables
- adding hidden coupling to one component with no docs

---

## 9. What to update after building a plugin

Always update at least these:
- repo docs for the plugin
- `README.md` if it changes top-level architecture or product surface
- `~/clawd/memory/projects/entity/context.md` with new plugin/system notes
- any extension-point spec if you added new slots/hooks/routes

Optional but smart:
- add example manifest
- add migration notes
- add “how to debug” section

---

## 10. Recommended folder patterns

### Runtime / behavior plugin
```text
plugin/
├── index.js
├── src/
│   ├── runtime.js
│   ├── hooks/
│   ├── domain/
│   └── status.js
```

### Product / module plugin
```text
plugin/
├── plugin.json
├── server/
│   ├── index.ts
│   ├── routes/
│   ├── providers/
│   ├── dispatcher.ts
│   └── migrations/
├── ui/
│   ├── views/
│   └── components/
└── test/
```

---

## 11. Current reference implementations

### Entity Linker
Use as reference for:
- outbound transform placement
- runtime/channel integration
- hook-based behavior plugin design

### Geordi Swarm
Use as reference for:
- plugin-owned routes
- plugin-owned tables
- provider interface design
- product/module plugin shape
- task integration without schema mutation

---

## 12. Short checklist for agents

Before calling a plugin implementation done:

- [ ] Manifest exists
- [ ] Capabilities declared
- [ ] Routes namespaced
- [ ] UI slots documented
- [ ] Plugin-owned tables isolated
- [ ] No unapproved core schema changes
- [ ] Failure behavior defined
- [ ] Tests added
- [ ] Docs updated
- [ ] Entity project context updated

---

## 13. Final rule

If another agent cannot discover:
- what your plugin is
- where it mounts
- what it owns
- how it fails
- how to remove it

…then you did not build a plugin. You built a future incident.
