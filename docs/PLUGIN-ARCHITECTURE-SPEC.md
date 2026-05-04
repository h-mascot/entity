# Entity Plugin Architecture Spec

**Status:** Draft v0.1  
**Audience:** Product, platform engineers, AI coding agents  
**Scope:** How plugins should integrate with Entity and adjacent OpenClaw surfaces without becoming one-off hacks

---

## 1. Why this exists

We now have multiple plugin-style extensions around Entity:

1. **Entity Linker v1** — standalone Discord sidecar that watched bot messages and rewrote local file paths into Entity URLs.
2. **Entity Linker v2** — first-class OpenClaw plugin override that wraps the Discord channel plugin and rewrites content before send.
3. **Geordi Swarm** — a plugin-for-Entity design that adds a job board, dispatcher, provider interface, proof ledger, task hooks, API routes, and UI registration.

That already shows the real plugin spread:
- **behavior plugin** shape (Entity Linker)
- **runtime/channel plugin** shape (Entity Linker integrated)
- **product/module plugin** shape (Geordi Swarm)
- different lifecycle, reliability, and ownership boundaries

If we keep shipping plugins ad hoc, we’ll get:
- unclear extension points
- duplicated auth/runtime logic
- plugins stomping on each other
- no stable contract for AI agents building new plugins

This spec defines the **plugin model for the Entity ecosystem**.

---

## 2. Design goals

A plugin should be:

- **Composable** — multiple plugins can exist without weird monkey-patching knife fights
- **Declarative first** — plugin intent should be obvious from a manifest/capabilities block
- **Scoped** — plugin declares what surfaces it touches
- **Observable** — plugin emits logs, status, health, and errors
- **Safe** — plugin can only mutate approved surfaces
- **Portable** — AI agents can build one using a clear contract
- **Replaceable** — plugin can be removed without surgery across the codebase

---

## 3. Core principle

A plugin is **not** “random code that runs near Entity.”

A plugin is:

> A versioned extension package that declares which Entity/OpenClaw surfaces it can observe or modify, registers handlers for those surfaces, and is loaded by a host runtime under explicit lifecycle and safety rules.

That means every plugin must answer:
- **What host am I extending?**
- **What events or hooks do I subscribe to?**
- **What outputs am I allowed to produce?**
- **What config do I require?**
- **What happens when I fail?**

---

## 4. What we learned from the current implementations

This spec is now grounded in two real patterns:
- **Entity Linker** = transport/runtime behavior plugin
- **Geordi Swarm** = product-level Entity module plugin

## 4.1 Entity Linker v1 — standalone sidecar

**Location observed:** `clawd/entity-linker/discord-listener.js`

### Shape
- Separate process
- Logs into Discord directly with bot token
- Watches `messageCreate` and `messageUpdate`
- Detects local file paths
- Edits sent message after the fact

### Good
- Fast to ship
- Easy to reason about
- No need to modify core OpenClaw send path

### Bad
- Operates **after** send, so UX is visibly post-hoc
- Duplicates Discord auth/runtime concerns
- Can race with other message edits
- Harder to compose with other plugins
- Separate process, separate monitoring, separate failure mode
- Easy to create edit loops or rate-limit trouble

### Verdict
Useful as a prototype. Bad as the long-term plugin model.

---

## 4.2 Entity Linker v2 — integrated channel plugin

**Location observed:** `Code/entity/entity-linker-plugin/*`

### Shape
- First-class OpenClaw extension package
- Registers as a Discord channel plugin override
- Reuses core Discord runtime
- Rewrites outgoing text/media captions before delivery
- Also hooks Discord subagent thread binding events

### Good
- Intercepts at the correct abstraction layer
- Reuses runtime/auth/config/status machinery
- Better observability and startup lifecycle
- No after-send edit race
- Can extend channel behavior and subagent lifecycle coherently

### Bad
- Current structure is still quite channel-specific
- **Plugin ID mismatch:** the actual `index.js` registers as `id: "discord"` (because it overrides the built-in Discord channel plugin), but the config/loading path references it as `"entity-linker"`. This causes a runtime warning: `"plugin id mismatch (manifest uses 'entity-linker', entry hints 'openclaw-plugins')"`. Needs resolving in Phase A.
- Capability boundaries are implicit in code, not explicit in architecture docs
- Easy to overfit the plugin around one transport instead of a general Entity model

### Verdict
This is the better direction. We should formalize this as the baseline model.

---

## 4.3 Geordi Swarm — product/module plugin for Entity

**Source observed:** `clawd/projects/geordi-swarm/SPEC-PACK.md`

### Shape
- Plugin-oriented module inside Entity
- Adds its own UI surface (`Swarm` tab / job board)
- Adds its own API routes (`/api/swarm/*`)
- Owns plugin-local tables (`swarm_jobs`, `swarm_proofs`)
- Defines a provider interface for pluggable backends (`acp`, `symphony`, future providers)
- Hooks task lifecycle events without mutating the canonical task schema

### Good
- Very clean boundary between **Entity core** and **plugin-owned workflow**
- Correctly keeps plugin data in plugin-owned tables
- Uses provider abstraction instead of hardcoding one backend forever
- Explicitly calls out required extension points in Entity core
- Good example of how a plugin can add a full product surface, not just a transform

### Risks / watchouts
- If Entity lacks formal route/UI/hook registration, the plugin can become a "soft plugin" welded into core
- Polling-heavy dispatchers can become accidental infrastructure if lifecycle rules are weak
- Product plugins need stricter slot ownership and DB migration rules than transport plugins

### Verdict
This is the reference pattern for **Entity-native product plugins**. It complements Entity Linker nicely: Linker shows runtime/channel extension; Swarm shows UI/API/data/provider extension.

---

## 5. Plugin taxonomy

Not all plugins are the same beast. We need categories.

## 5.1 Surface plugins
Touch a user-facing surface.

Examples:
- Message/channel plugin
- Entity UI panel plugin
- File preview/render plugin
- Task board augmentation plugin
- Full product view plugin like **Geordi Swarm Job Board**

## 5.2 Integration plugins
Connect external systems.

Examples:
- CRM sync
- Slack/Discord bridge
- Google Drive source adapter
- Analytics sink

## 5.3 Behavior plugins
Intercept and transform behavior.

Examples:
- Link/path rewriter
- Content formatter
- policy guardrail
- audit trail enricher

## 5.4 Runtime plugins
Hook background lifecycle and orchestration.

Examples:
- subagent thread binder
- completion delivery router
- activity stream enricher
- indexing scheduler
- job dispatcher/orchestrator like **Geordi Swarm Dispatcher**

## 5.5 Data source plugins
Provide content or indexes to Entity.

Examples:
- file source adapter
- search provider
- document metadata enricher

---

## 6. Host surfaces a plugin may extend

A plugin must declare one or more target surfaces.

## 6.1 Messaging surface
For message send/receive/rewrite/reactions/threading.

Can do:
- normalize targets
- rewrite outbound content
- enrich inbound metadata
- route thread/subagent delivery
- add channel-specific capabilities

Cannot do:
- arbitrarily mutate unrelated app state
- bypass host delivery/security rules

## 6.2 Entity UI surface
For panels, widgets, views, command palette items, context actions.

Can do:
- add left/right/sidebar panels
- add doc actions
- add task actions
- render plugin settings UI

Cannot do:
- overwrite core navigation without explicit slot ownership
- inject uncontrolled global CSS/JS that breaks other surfaces

## 6.3 Document/File surface
For file path rewriting, previews, indexing, annotations, metadata.

Can do:
- add source adapters
- add preview renderers
- augment document metadata
- attach comments/findings/annotations

Cannot do:
- silently rewrite source files unless explicitly authorized by the user/host flow

## 6.4 Task / Mission Control surface
For cards, views, workflow automations, derived fields.

Can do:
- add metadata fields
- add task actions
- enrich activity trail
- contribute automations

Cannot do:
- redefine the canonical task schema without platform approval

## 6.5 Agent/runtime surface
For subagent lifecycle, job delivery, review routing, watch mode events.

Can do:
- observe spawn/start/finish/fail
- bind output targets
- enrich activity events
- register agent actions

Cannot do:
- bypass platform scheduling, safety, or auth constraints

## 6.6 Admin/config surface
For setup, health, configuration, status pages.

Can do:
- expose config schema
- expose health checks
- expose onboarding/setup actions

Cannot do:
- mutate unrelated config sections
- require manual secret scattering across random files

---

## 7. Core plugin components

Every plugin should contain these components, even if some are tiny.

For bigger product plugins like Geordi Swarm, these components become mandatory rather than nice-to-have.

## 7.1 Manifest
Static identity and capabilities.

Required fields:
- `id` — stable kebab-case identifier
- `name` — human-readable label
- `version` — semver recommended
- `kind` — plugin type (`behavior`, `product`, `integration`, `runtime`, `data-source`, `ui`)
- `description`
- `host` — which runtime(s) load this (`openclaw`, `entity-server`, `entity-ui`, `standalone`)
- `entityVersion` — minimum compatible Entity version
- `capabilities[]` — declared capability strings
- `entrypoints` — server/UI entry files

Example shape (behavior plugin):

```json
{
  "id": "entity-linker",
  "name": "Entity Linker",
  "version": "1.0.0",
  "kind": "behavior",
  "host": ["openclaw"],
  "entityVersion": { "min": "0.1.0" },
  "capabilities": [
    "messaging.outbound.transform",
    "runtime.subagent.bind"
  ],
  "entrypoints": {
    "server": "./index.js"
  }
}
```

> **Note:** The current Entity Linker v2 implementation registers with `id: "discord"` (overriding the built-in Discord channel plugin). The intended stable ID is `"entity-linker"`. See Phase A roadmap for the fix.

See `docs/ENTITY-PLUGIN-MANIFEST.schema.json` for the full schema and `docs/ENTITY-PLUGIN-MANIFEST.example.json` for a product plugin example (Geordi Swarm).

## 7.2 Config schema
Plugin config must be typed, validated, and namespaced.

Rules:
- plugin config lives under a predictable namespace
- no mystery env var dependence without documentation
- all optional vs required fields explicit
- defaults explicit

## 7.3 Registration function
Single place where the plugin tells the host what it wants.

Example responsibilities:
- register hooks
- register channel/UI/provider adapters
- register health probes
- register status collectors

## 7.4 Hook handlers
Pure-ish functions that implement behavior for specific lifecycle points.

Examples:
- `onOutboundMessage()`
- `onSubagentSpawning()`
- `onTaskCreated()`
- `onFileIndexed()`

## 7.5 Runtime adapter
Thin wrapper around host services.

Purpose:
- plugin logic should not know raw internals everywhere
- runtime adapter centralizes access to logger, config, secrets, caches, senders, storage, scheduler

## 7.6 Domain logic module
Actual business logic.

For Entity Linker, this is:
- detect local file path
- normalize
- rewrite to public Entity URL

Keep this separate from runtime wiring.

## 7.7 Status + observability module
Every plugin needs:
- health state
- last error
- last successful execution timestamp
- debug log namespace
- optional metrics counters

## 7.8 Tests
Minimum expected:
- unit tests for transform logic
- contract tests for hooks
- failure-mode tests for malformed config / host unavailability

For product plugins like Geordi Swarm, also require:
- state-machine tests
- provider contract tests
- migration tests for plugin-owned tables
- UI smoke tests for registration slots/views

---

## 8. Lifecycle

Plugins should follow a standard lifecycle.

## 8.1 Load
Host discovers plugin manifest and validates compatibility.

## 8.2 Validate
Host validates:
- version compatibility
- config schema
- declared capabilities
- required dependencies

## 8.3 Register
Plugin registers handlers, adapters, routes, slots, or providers.

## 8.4 Start
Plugin can initialize caches, probes, background subscriptions.

## 8.5 Run
Plugin responds to hook invocations.

## 8.6 Report
Plugin updates status and health.

## 8.7 Stop
Plugin cleans up listeners, sockets, timers, bindings.

---

## 9. Hook model

Hooks are the backbone. They need rules.

## 9.1 Hook contract
A hook must define:
- **when** it fires
- **input payload**
- **allowed output**
- **whether it can block/modify/cancel**
- **error semantics**

## 9.2 Hook classes

### Observe hook
Read-only.
Example: log or audit.

### Transform hook
Can modify a payload.
Example: rewrite outbound text before send.

### Decision hook
Can return approve/deny/redirect.
Example: choose delivery target for subagent completion.

### Action hook
Can trigger side effects.
Example: create a thread binding or schedule indexing.

## 9.3 Ordering
If multiple plugins touch the same hook:
- host defines deterministic order
- ideally via priority and phase
- each plugin should declare if it is `pre`, `default`, or `post`

Recommended phases:
1. validate
2. normalize
3. transform
4. route
5. deliver
6. observe

## 9.4 Idempotency
Hook handlers should be safe to re-run when practical.

For transforms:
- avoid double-applying rewrites
- mark rewritten state if needed
- do not rely on “this can only happen once” fantasy engineering

---

## 10. Mutation boundaries

This is the anti-chaos bit.

A plugin may only mutate:
- the payload of hooks it was given
- host state inside declared extension slots
- its own config, cache, and storage namespace

A plugin may not:
- patch global host behavior outside registered hooks
- write into another plugin’s config or state
- depend on private internals unless explicitly marked stable
- hijack transport auth or runtime ownership from the host

---

## 11. Recommended architecture layers

Geordi Swarm strongly suggests Entity plugins need to support **all six layers**, not just hook code:
- manifest + registration
- routes/API
- UI slots/views
- data storage/migrations
- orchestrator/provider abstractions
- status/proof/metrics

For Entity/OpenClaw plugins, prefer this stack:

### Layer 1 — Manifest
What the plugin is

### Layer 2 — Host adapter
How it attaches to OpenClaw/Entity

### Layer 3 — Contracts
Typed input/output for hooks

### Layer 4 — Domain logic
Business behavior

### Layer 5 — Optional persistence/cache
If plugin needs state

### Layer 6 — Status/metrics
Health and debugging

If your plugin collapses all of this into one 700-line file, congratulations, you’ve built future regret.

---

## 12. Canonical plugin package structure

### 12.1 Small/runtime plugin shape

```text
my-plugin/
├── package.json
├── index.js                 # registration entry
├── manifest.json            # optional explicit manifest
├── src/
│   ├── runtime.js           # host runtime accessors
│   ├── config.js            # schema/defaults/helpers
│   ├── hooks/
│   │   ├── outbound.js
│   │   ├── inbound.js
│   │   └── subagents.js
│   ├── domain/
│   │   └── transform.js
│   ├── status.js
│   └── types.js
└── test/
    ├── transform.test.js
    └── hooks.test.js
```

### 12.2 Product/plugin-module shape

```text
geordi-swarm/
├── plugin.json              # manifest/capabilities/routes/ui/settings
├── server/
│   ├── index.ts             # route + hook registration
│   ├── dispatcher.ts
│   ├── proof.ts
│   ├── providers/
│   │   ├── interface.ts
│   │   ├── acp.ts
│   │   └── symphony.ts
│   ├── routes/
│   │   └── jobs.ts
│   └── migrations/
├── ui/
│   ├── SwarmBoard.tsx
│   ├── SwarmJobDetail.tsx
│   └── components/
└── test/
    ├── dispatcher.test.ts
    ├── provider-contract.test.ts
    └── migrations.test.ts
```

---

## 13. Reference pattern from Entity Linker

Entity Linker should be treated as a **behavior plugin on the messaging surface**.

### Intent
Rewrite local file paths into hosted Entity URLs.

### Correct extension point
**Outbound message transform before send**.

### Secondary extension point
**Subagent delivery/thread binding routing**.

### Not the preferred extension point
Post-send Discord message editing sidecar.

So the platform rule here is:

> If a feature is fundamentally a transport/content transform, implement it at the host’s outbound pipeline, not as an after-the-fact listener.

---

## 14. Plugin capability model

Each plugin should declare capabilities, not just hope for the best.

Example capability strings:
- `messaging.outbound.transform`
- `messaging.inbound.observe`
- `messaging.threading.route`
- `runtime.subagent.bind`
- `ui.panel.register`
- `ui.command.register`
- `documents.preview.render`
- `documents.source.adapter`
- `tasks.activity.enrich`
- `admin.status.probe`

Why this matters:
- easier review
- clearer permissions
- easier docs for AI agents
- better future marketplace/install UX

---

## 15. Error handling rules

Plugins must fail like adults.

## 15.1 Transform failures
Default behavior:
- log error
- preserve original payload unless plugin is marked required

## 15.2 Required plugins
Host may allow some plugins to be marked required for a flow.
If they fail:
- block the action
- emit actionable error

## 15.3 Background/runtime failures
- must not crash whole host unless explicitly fatal
- should degrade only their own capability
- should expose last error in status

## 15.4 Retry behavior
Only retry when idempotent and bounded.
No infinite loops. We are not summoning demons.

---

## 16. Config and secret rules

- Host owns secret loading
- Plugin consumes secrets through host config/runtime
- No plugin should directly assume `.env` shape unless documented and approved
- Plugin config should be namespaced and discoverable
- Config changes should be hot-reloadable where practical

---

## 17. Observability requirements

Minimum per plugin:
- plugin ID/version
- enabled/disabled state
- configured/not configured
- last successful run time
- last error
- hook invocation counts if practical

Nice to have:
- latency metrics by hook
- error rate by hook
- transformed vs untouched payload counts

---

## 18. AI agent implementation guide

If an AI agent is asked to build a new plugin, it should follow this checklist.

## 18.1 Step 1 — classify the plugin
Decide:
- surface plugin?
- integration plugin?
- behavior plugin?
- runtime plugin?
- data source plugin?

## 18.2 Step 2 — choose the host surface
Pick the narrowest correct extension point.

Bad:
- spinning a sidecar because the real hook was not looked up

Good:
- using the host outbound pipeline if the feature is an outbound transform

## 18.3 Step 3 — define the contract first
Write down:
- inputs
- outputs
- config
- failure behavior
- observability

## 18.4 Step 4 — keep domain logic pure
Put transport/runtime code in adapter modules.
Put business logic in a pure transform/service module.

## 18.5 Step 5 — add tests
At least:
- happy path
- no-op path
- malformed input
- duplicate application prevention
- config absent/invalid

## 18.6 Step 6 — document it
Every plugin PR should include:
- purpose
- extension points used
- surfaces touched
- config keys
- failure mode

---

## 18.7 Step 7 — decide if this is a soft plugin or true plugin

For Entity specifically, some near-term implementations may ship as **soft plugins**:
- co-located module
- plugin-owned routes
- plugin-owned tables
- plugin-owned UI view
- no general plugin loader yet

That is acceptable **only if**:
- boundaries are still explicit
- schemas remain plugin-owned
- hooks/slots are documented
- extraction into a true plugin later is mechanical

Geordi Swarm is the model example here.

## 19. What plugins can do vs cannot do

## Plugins can
- add or transform behavior through declared host hooks
- extend messaging, UI, task, runtime, or document surfaces
- maintain isolated plugin-local state
- own plugin-local routes, views, migrations, and tables
- expose health, config, and admin status

## Plugins cannot
- patch random internals with no contract
- mutate arbitrary unrelated product state
- own a core system surface unless explicitly designated as the host plugin for that surface
- bypass authentication, policy, or delivery guarantees
- silently introduce second runtimes for a capability the host already owns

---

## 20. Recommended near-term roadmap

## Phase A — formalize current plugin contract
- Standardize manifest shape
- Standardize plugin ID conventions
- Standardize lifecycle hooks
- Add capability declarations
- Clean up entity-linker ID/loading mismatch

## Phase B — add Entity-side plugin surfaces
- UI panel slots
- command palette actions
- task card action slots
- document metadata/render hooks
- route registration
- plugin-owned migrations
- plugin settings storage
- task detail extension slots

## Phase C — prove the model with Geordi Swarm
- ship Geordi Swarm as a soft plugin/module first
- keep provider interface stable
- keep plugin-owned tables isolated from core tasks schema
- use it to harden route/UI/hook extension points

## Phase D — plugin SDK docs for AI agents
- examples by plugin type
- starter template
- test harness
- compatibility/versioning guide

## Phase E — marketplace readiness
- install/uninstall flow
- capability review
- health/status dashboard
- version compatibility checking

---

## 21. Decisions from this spec

1. **Integrated host plugins are the default model.**  
   Sidecars are for prototypes or exceptional cases, not the primary architecture.

2. **Plugins must declare target surfaces and capabilities.**  
   No more mystery extension blobs.

3. **Content transforms belong in the outbound pipeline, not after-send listeners.**

4. **Product plugins may own plugin-local routes, tables, views, and provider abstractions — but should not mutate core schemas unless explicitly approved.**

5. **Soft plugins are acceptable as an intermediate step if boundaries remain explicit and extraction to a true plugin is mechanical.**

6. **Plugins need lifecycle, config schema, and status reporting by default.**

7. **AI agents should build plugins against narrow, stable contracts rather than patching around the platform.**

---

## 22. Open questions

These need answering before v1.0:

- Should Entity UI plugins and OpenClaw runtime plugins share one manifest format or two sibling formats?
- How do we version hook contracts across host releases?
- Do we allow multiple plugins on the same transform hook with priorities?
- What persistence API should plugins get for local state?
- Which surfaces are stable enough to be public SDK surfaces vs internal-only?
- How should plugin permissions/capabilities be shown in admin UI?

---

## 23. Short version

The rule of thumb:

> A good plugin extends a declared surface through a stable hook, keeps its business logic isolated, reports status, and can be deleted without breaking the host.

Entity Linker v2 is closer to the right architecture than v1.  
This spec turns that instinct into a repeatable system.
