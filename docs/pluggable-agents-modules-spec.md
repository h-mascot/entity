# Entity Pluggable Agents + Modules Spec

## Goal
Replace scattered hardcoded agent/module wiring with a registry-driven architecture so Entity behaves like a workspace OS:
- modules are first-class and pluggable
- agents can join/remove cleanly
- permissions are scoped per module
- each module exposes skills/scripts/crons that granted agents can see/use

## Vocabulary
- **Module**: product subsystem in Entity, e.g. `chat`, `tasks`, `files`, `docs`, `swarm`, `plugins`
- **Permission**: allowed action inside a module, e.g. `read`, `write`, `assign`, `admin`
- **Skill reference**: instructions/scripts/crons needed to operate a module
- **Agent**: workspace member with identity + module grants
- **Grant**: an agent's enabled permissions for a module

## Product rules
- Mission Control is the UX label for the `tasks` module.
- Docs/editor and plugins are existing modules, not future hypotheticals.
- Module access includes visibility of module-operating skills/docs/scripts.
- Removing an agent disables access but preserves historical comments/authorship/activity.

## Current hardcoded drift to eliminate
Current live code duplicates agent/module identity across multiple files:
- `packages/app/src/App.tsx`
  - fallback roster
  - avatar map
  - authorship actor list
- `packages/app/src/types/collaboration.ts`
  - authorship actor type union
- `packages/app/src/hooks/useChat.ts`
  - chat agent options
- `packages/app/src/components/UnifiedFileDashboard.tsx`
  - file filter agents
- `packages/app/src/components/AgentDashboardV2.tsx`
  - avatar map duplication
- `packages/server/src/index.ts`
  - document author whitelist
- task comment mention routing also needs centralization

This is why adding an agent currently means touching several unrelated files and missing one causes regressions.

## Existing module inventory
Initial module registry should include at least:
- `chat`
- `tasks` (display label: Mission Control)
- `files`
- `docs`
- `swarm`
- `plugins`

## Proposed data model

### 1. agents
Canonical registry of workspace agents.

Fields:
- `id` TEXT PRIMARY KEY
- `slug` TEXT UNIQUE NOT NULL
- `name` TEXT NOT NULL
- `emoji` TEXT NOT NULL
- `avatar_url` TEXT
- `description` TEXT
- `adapter_type` TEXT
- `runtime_type` TEXT
- `status` TEXT NOT NULL DEFAULT `active`
- `instructions_path` TEXT
- `metadata_json` TEXT NOT NULL DEFAULT '{}'
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

### 2. modules
Registry of installed Entity modules.

Fields:
- `id` TEXT PRIMARY KEY
- `slug` TEXT UNIQUE NOT NULL
- `name` TEXT NOT NULL
- `description` TEXT
- `enabled` INTEGER NOT NULL DEFAULT 1
- `icon` TEXT
- `kind` TEXT NOT NULL DEFAULT 'core'
- `permissions_schema_json` TEXT NOT NULL DEFAULT '[]'
- `ui_config_json` TEXT NOT NULL DEFAULT '{}'
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

### 3. agent_module_grants
Per-agent module access.

Fields:
- `id` TEXT PRIMARY KEY
- `agent_id` TEXT NOT NULL
- `module_id` TEXT NOT NULL
- `enabled` INTEGER NOT NULL DEFAULT 1
- `permissions_json` TEXT NOT NULL DEFAULT '[]'
- `scope_json` TEXT NOT NULL DEFAULT '{}'
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

Constraints:
- UNIQUE(`agent_id`, `module_id`)

### 4. module_skill_refs
Operational references for each module.

Fields:
- `id` TEXT PRIMARY KEY
- `module_id` TEXT NOT NULL
- `label` TEXT NOT NULL
- `kind` TEXT NOT NULL
- `ref` TEXT NOT NULL
- `required` INTEGER NOT NULL DEFAULT 0
- `notes` TEXT

Examples:
- `tasks` -> `mc.sh`
- `tasks` -> `memory/entity-project-context.md`
- `swarm` -> swarm skill
- `plugins` -> plugin admin routes/docs

### 5. agent_invites
Invite/join flow support.

Fields:
- `id` TEXT PRIMARY KEY
- `token` TEXT UNIQUE NOT NULL
- `created_by` TEXT
- `target_role_template` TEXT
- `default_grants_json` TEXT NOT NULL DEFAULT '[]'
- `instructions_path` TEXT
- `invite_message` TEXT
- `expires_at` TEXT
- `claimed_at` TEXT
- `claimed_by_agent_id` TEXT
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

## Derived runtime helpers
Everything UI/server should derive from registries and grants.

Shared helpers to introduce:
- `listRegisteredAgents()`
- `listEnabledAgents()`
- `getAgentAvatarMap()`
- `getAuthorshipActors()`
- `getChatEnabledAgents()`
- `getTaskAssignableAgents()`
- `getFileVisibleAgents()`
- `getMentionableAgents()`
- `getEnabledModules()`
- `getModuleSkillRefs(moduleSlug)`
- `getAgentModuleGrants(agentId)`

## API additions

### Agent registry
- `GET /api/agents/registry`
- `POST /api/agents/registry`
- `PATCH /api/agents/registry/:id`
- `POST /api/agents/registry/:id/disable`
- `POST /api/agents/registry/:id/enable`

### Module registry
- `GET /api/modules`
- `POST /api/modules`
- `PATCH /api/modules/:id`

### Grants
- `GET /api/agents/:id/grants`
- `PUT /api/agents/:id/grants/:moduleId`

### Skill references
- `GET /api/modules/:slug/skills`

### Invites
- `POST /api/agent-invites`
- `GET /api/agent-invites/:token`
- `POST /api/agent-invites/:token/claim`

## Join flow
1. Admin creates invite link or invite file.
2. Invite includes default module grants and instructions path.
3. Agent claims invite.
4. Entity creates agent record.
5. Entity applies module grants.
6. Agent sees only the modules they have access to.
7. For each granted module, Entity exposes linked skills/scripts/docs.

## Removal / disable semantics
- default action is disable, not hard delete
- historical comments/authorship/task activity remain
- disabled agents are removed from active selectors and routing
- reassignment workflow can transfer tasks/channels later

## Implementation phases

### Phase 1 - central registry foundation
- add agent registry constants/types + DB tables
- add module registry tables and seed core modules
- add grant table
- add server repository accessors

### Phase 2 - derive existing hardcoded UI/server lists from registry
Replace hardcoded lists in:
- `App.tsx`
- `types/collaboration.ts`
- `useChat.ts`
- `UnifiedFileDashboard.tsx`
- `AgentDashboardV2.tsx`
- `server/index.ts`
- task comment mention routing

### Phase 3 - expose module skill refs in UI/API
- module details page/panel can show skill/docs/scripts/crons references
- agents with module access can see module operation references

### Phase 4 - invite/join/remove flows
- create invite endpoints + UI
- claim invite path
- disable/remove agent path

## First implementation slice
The first concrete slice should be intentionally small:
1. add shared agent registry in app/server code
2. centralize core built-in agents there
3. derive avatars, chat options, file filter options, authorship actors, and document author whitelist from registry
4. include Uhura and Book everywhere that Midas was already being manually added
5. build successfully before any invite-flow work

This reduces drift immediately while setting up the full registry migration.
