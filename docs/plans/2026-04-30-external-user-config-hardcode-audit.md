# Entity External-User Readiness: Hardcoded Config Audit

Date: 2026-04-30
Status: Audit complete; implementation not started
Repo: `/Users/enterprise/code/entity`

## Goal

Prepare Entity for people outside Henry's Enterprise environment to install, run, onboard their own agents, and point Entity at their own filesystems without editing source code.

## Executive Summary

Entity already has useful foundations for portability:

- `file_sources` DB table and CRUD/sync routes exist.
- File Sources settings UI exists.
- Plugin settings persistence exists.
- TTS settings persistence exists.
- Agent/Task/Files/Admin surfaces exist.

But the repo still assumes Henry's environment in too many places:

- deploy defaults target Enterprise/Tailscale hosts.
- frontend and backend seed Ada/Spock/Scotty/Zora/etc. as product defaults.
- service catalogs hardcode Enterprise services and private IPs.
- docs/file routes hardcode `/Users/enterprise`, `/home/henrymascot`, `clawd`, and agent workspaces.
- README/onboarding docs describe internal Enterprise setup as if it were default product setup.
- no safe public `.env.example` / first-run setup wizard exists.

This should be treated as a productization track, not a one-off cleanup.

## P0: External-User Blockers

### 1. Deploy/runtime profile is Enterprise-specific

Files:
- `deploy.sh:11-13`
- `deploy.sh:143-171`
- `scripts/ctrl-deploy-path-check.sh:7-11,43`
- `dev.sh:2-4`
- `commit-context.sh:2`
- `commit-context-restructure.sh:5`

Problems:
- Defaults target `enterprise@100.104.229.62`, `100.104.229.62`, `/Users/enterprise/Services/entity`.
- Runtime restart hardcodes `PORT=3000`, `WORKSPACE=/home/henrymascot/clawd`, `/tmp/entity-server.log`.
- Dev path points at `http://100.106.69.9:3000`.

Move to config:
- `entity.config.yaml` deploy profile.
- `.env.local` overrides.
- `npm run setup` generated local config.

Do not keep Enterprise as public default. Enterprise should become `config/profiles/enterprise.example.yaml` or internal docs only.

### 2. Secrets/private `.env` assumptions

Files:
- `.env`
- `packages/server/.env`

Problems:
- Real local `.env` files contain private IPs, queue paths, tokens/placeholders, and provider assumptions.
- No safe `.env.example` found.

Required changes:
- Add `.env.example` with localhost-only safe defaults.
- Ensure `.env` / `packages/server/.env` are not distributed as product defaults.
- Move durable non-secret settings to `entity.config.yaml` or DB-backed admin settings.
- Keep only secret references in config, not raw secrets.

### 3. File/docs sources auto-seed Henry agent workspaces

Files:
- `packages/server/src/fs/index.ts:25-33`
- `packages/server/src/fs/index.ts:53-56`
- `packages/server/src/routes/docs.ts:19-27`
- `packages/server/src/routes/docs.ts:60-61`
- `scripts/seed-agent-sources.sh:73-76`

Problems:
- Default sources: `vault`, `ada`, `spock`, `zora`.
- Default paths: `${HOME}/obsidian-vault`, `${HOME}/clawd`, `${HOME}/clawd-spock`, `${HOME}/clawd-zora`, `/home/henrymascot/*`, `/Users/enterprise/*`.
- Default remote docsify URLs use private `100.*` IPs.

Move to config/admin:
- First-run wizard asks for workspace root and file sources.
- Agent workspaces are just file sources tagged/bound to agent IDs.
- Docs roots derive from configured file sources, not code constants.

### 4. Built-in crew/agent registry is Henry-specific

Files:
- `packages/app/src/lib/agentRegistry.ts:13-22`
- `packages/db/src/index.ts:965-974`
- `packages/db/src/index.ts:1002-1006`
- `packages/server/src/editor/auth.ts:30-35`
- `packages/server/src/fs/classify.ts:4-5,39-41`
- `packages/server/src/agent/agent-capability-card.ts:54-56,163-164`

Problems:
- Ada, Spock, Scotty, Geordi, Zora, Midas, Uhura, Book are seeded as product defaults.
- Henry/Henry Mascot appears in owner/user defaults.
- Editor actors and file classification assume Enterprise crew names.

Move to config/admin:
- Agent registry DB table or config-backed seed.
- Default public install gets one generic `assistant` agent.
- Enterprise crew becomes optional profile/import.
- File classification rules derive from agent registry + source metadata.

### 5. Service catalog and plugin defaults are Enterprise-specific

Files:
- `packages/server/src/plugins/entity-services/plugin.json:26-30`
- `packages/server/src/plugins/entity-services/routes.ts:128-280`
- `packages/server/src/plugins/entity-linker/plugin.json:19-22`
- `entity-linker-plugin/src/rewrite-paths.js:1-4`

Problems:
- Hardcoded Entity/Admin/n8n/Vaultwarden/OpenClaw services on `100.*`, localhost, and named Enterprise hosts.
- Service names like Enterprise Admin / MascotM3 are product-visible.

Move to config/admin:
- Admin-managed service catalog.
- Plugin settings schema should provide empty/placeholder defaults.
- Services disabled until user configures them.

## P1: Runtime/Provider Config to Extract

### API / WebSocket / file fallback URLs

Files:
- `packages/app/src/App.tsx:854-865`
- `packages/app/src/components/FileTree.tsx:39-50`
- `packages/app/src/components/FileHistoryPanel.tsx:56-66`
- `packages/app/src/config/runtime.ts:4,51-62,70-71`
- `packages/app/src/components/MarkdownAudioControls.tsx:71-73`

Problems:
- App probes `localhost:3001`, `127.0.0.1:3001`, current-host `:3001` even when runtime config says otherwise.
- WebSocket assumes port `3000`.

Move to config:
- `server.apiBaseUrl`
- `server.wsBaseUrl`
- `legacyFileApi.enabled/baseUrl`

### Agent gateways, health checks, terminal targets

Files:
- `packages/server/src/index.ts:85-86`
- `packages/server/src/index.ts:4586-4614`
- `packages/server/src/terminal.ts:84-125,466-467`
- `packages/app/src/components/BottomTerminalPanel.tsx:7,50-91`

Problems:
- OpenClaw defaults to `http://100.106.69.9:18789`.
- Health checks know `main/spock/scotty/geordi/zora` hosts.
- Terminal target list hardcodes `ada-gw`, `spock`, `scotty`, `mac`, `enterprise`.

Move to config/admin:
- Agent gateway inventory.
- Terminal host inventory.
- Health endpoints per agent/provider.

### AI/search/swarm/TTS providers

Files:
- `packages/server/src/routes/search.ts:193-200`
- `packages/server/src/routes/chat.ts:354-356`
- `packages/server/src/swarm/providers/acp.ts:16,29-30`
- `packages/server/src/swarm/providers/codex.ts:19-22,81-99`
- `packages/server/src/swarm/providers/eforge-poller.ts:18-24`
- `packages/server/src/plugins/geordi-swarm/routes.ts:67-113`
- `packages/server/src/routes/tts.ts:8-11,38-49,355-359,414`
- `packages/app/src/components/Chat/ChatOfflineProvider.tsx:170,204`
- `packages/app/src/components/OfflineAwareChat.tsx:75,101,291`
- `packages/app/src/components/SwarmBoard.tsx:36-41`
- `packages/app/src/components/settings/VoiceSettings.tsx:112,282`

Problems:
- Private Ollama host `100.86.150.96:11434`.
- eForge default `localhost:4567/4568`.
- ACP/Codex Mac defaults and `/Users/enterprise/.codex`.
- edge-tts binary path under `/Users/enterprise/Library/Python/3.9/bin/edge-tts`.

Move to config/admin:
- Provider registry with enable toggles, base URLs, command paths, token refs.
- Keep provider defaults disabled except local-safe localhost suggestions.

### Mission Control assignees/projects/user defaults

Files:
- `packages/app/src/App.tsx:266-267,1137,2294,2536,3846-3850,3870-3872`
- `packages/app/src/hooks/useTaskBoard.ts:742,846`
- `packages/app/src/components/mission-control/MCCreateTaskModal.tsx:6`
- `packages/app/src/components/mission-control/TaskDetailPanel.tsx:17,19`
- `packages/app/src/components/UnifiedFileDashboard.tsx:134`
- `packages/app/src/components/Chat/MessageBubble.tsx:45-46`

Problems:
- User defaults to Henry.
- Assignee/project filters hardcode Ada/Spock/Scotty/Henry and Soteria/Curacel/etc.

Move to config/admin:
- Current user profile setting.
- Team/agent registry for assignees.
- Project taxonomy from DB.

## P2: Onboarding/Admin UI Gaps

Existing foundation:
- `packages/db/src/file-sources.ts` supports source records with auth type/ref, path/url, capabilities, health.
- `packages/server/src/fs/routes-sources.ts` exposes source CRUD and sync.
- `packages/app/src/components/settings/FileSourcesSettings.tsx` has a generic source settings form.
- `packages/server/src/plugins/registry.ts` persists plugin settings.
- `packages/server/src/routes/tts.ts` persists TTS settings under `app_settings`.

Gaps:
- No first-run onboarding state.
- No root picker / guided file source setup.
- No agent onboarding wizard.
- No service catalog UI for external users.
- No public config schema.
- Plugin defaults are not safe/public by default.
- README says `npm run dev`, but root `package.json` does not define it.

## Proposed Config Architecture

### Config sources and precedence

1. CLI/env override.
2. DB-backed admin settings.
3. `entity.config.yaml` user config.
4. safe built-in localhost defaults.
5. Enterprise/internal profile only when explicitly selected.

### Proposed `entity.config.yaml`

```yaml
version: 1
profile:
  id: local
  displayName: "My Entity Workspace"
  ownerName: "Your Name"
  publicBaseUrl: "http://localhost:3000"

server:
  port: 3000
  apiBaseUrl: "http://localhost:3000"
  wsBaseUrl: "ws://localhost:3000"
  workspaceRoot: "${HOME}/entity-workspace"
  databasePath: "${HOME}/.entity/entity-tasks.db"
  logPath: "${HOME}/.entity/entity-server.log"

deploy:
  mode: local # local | ssh | docker | systemd | launchd
  sshTarget: null
  remoteDir: null
  httpHost: "localhost"
  preserveDatabase: true

agents:
  - id: assistant
    name: Assistant
    emoji: "🤖"
    provider: null
    model: null
    gateway:
      type: local # local | http | ssh | openclaw | custom
      url: null
    modules: [chat, tasks, files, docs]

fileSources:
  - id: workspace
    displayName: Workspace
    type: local
    basePath: "${server.workspaceRoot}"
    enabled: true
    icon: "📁"
    authRef: null
    classification:
      agentHints: [assistant]
      originRules: []

integrations:
  openclaw:
    enabled: false
    baseUrl: null
    tokenRef: null
  ollama:
    enabled: false
    baseUrl: "http://localhost:11434"
  eforge:
    enabled: false
    apiUrl: null
    queueDir: null
  tts:
    defaultProvider: browser
    providers: {}

services: []
plugins: {}
```

### Admin UI sections

1. Onboarding status / first-run wizard.
2. Workspace profile: owner, display name, base URL, DB path, workspace root.
3. Agents: add/import agent, gateway, model/provider, avatar, modules.
4. File sources: local folder/docsify/GitHub/S3, auth, test connection, bind to agent/shared.
5. Integrations: OpenClaw, Ollama, eForge, TTS, search providers.
6. Services catalog: user-managed service cards instead of hardcoded Enterprise map.
7. Plugins: generated settings form from manifest schema.
8. Doctor: verify ports, paths, DB, missing secrets, service reachability.

## Implementation Plan

### Phase 1 — Public-safe config foundation

- Add `entity.config.yaml` schema/types and loader.
- Add `.env.example` and remove private `.env` assumptions from docs.
- Add `npm run setup`, `npm run dev`, `npm run doctor` scripts.
- Create `GET /api/config/effective` and `GET /api/onboarding/status`.

Acceptance:
- Fresh clone can start locally without Enterprise paths.
- Enterprise profile is opt-in, not default.
- Effective config endpoint shows source of every setting.

### Phase 2 — Agents and identity become configurable

- Add agent registry persistence or config-backed seed.
- Replace frontend `BUILT_IN_AGENTS` fallback with generic assistant + `/api/agents` data.
- Replace editor/auth/file-classifier hardcoded actor lists with registry lookups.
- Move MC assignees/project filters to DB/config.

Acceptance:
- New user can create agents from Admin without source edits.
- Ada/Spock/etc. only appear if Enterprise profile is loaded/imported.

### Phase 3 — Filesystem onboarding

- Remove default Enterprise file-source seeding from server startup.
- File source wizard creates first workspace source.
- Docs roots derive from file sources/config.
- Add path validation and safe root containment checks.

Acceptance:
- New user can point Entity at arbitrary local folder.
- Task output/doc links work against configured file sources.

### Phase 4 — Services/providers/plugins

- Move service catalog from hardcoded `KNOWN_SERVICE_MAP` to DB/admin-managed catalog.
- Move terminal targets and agent health endpoints into config/admin.
- Move search/Ollama/eForge/ACP/Codex/TTS command paths into provider settings.
- Make plugin manifest defaults placeholder-only.

Acceptance:
- No private IPs or Henry hostnames are active unless configured.
- Admin UI can add/edit/test services and providers.

### Phase 5 — Docs and packaging cleanup

- Rewrite public README around local setup.
- Move Enterprise-specific context into `docs/internal/enterprise-profile.md`.
- Add onboarding docs and config reference.
- Add CI scan for forbidden private defaults.

Acceptance:
- `rg '100\.106|100\.104|/Users/enterprise|/home/henrymascot|Ada|Spock|Scotty'` only finds internal docs/tests/enterprise profile fixtures, not public runtime defaults.

## Suggested Immediate Next Tasks

1. Create config schema/loader and `.env.example`.
2. Add `npm run setup/dev/doctor` with local-only defaults.
3. Replace file-source auto-seeding with config-seeding.
4. Replace frontend built-in crew fallback with generic assistant + API registry.
5. Move Enterprise service catalog to opt-in profile.

## Audit Scan Counts

A broad source/doc scan excluding `node_modules`, `dist`, and common generated folders found:

- Tailnet IP references: 216
- User/home path references: 270
- localhost/port assumptions: 342
- Enterprise crew/user names: 2616
- Enterprise/OpenClaw/clawd terms: 686
- env-default expressions: 51

These counts include docs/tests/examples; priority findings above focus on runtime/product surfaces.
