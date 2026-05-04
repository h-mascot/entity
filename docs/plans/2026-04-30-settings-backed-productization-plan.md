# Entity Settings-Backed Productization Plan

> **For Hermes:** Execute one slice at a time. Use incremental-implementation + test-driven-development. Do not start the next slice until tests/build/browser verification pass for the current slice.

**Goal:** Every formerly hardcoded deploy/runtime/filesystem/agent/service/provider/task/docs setting must be editable in the appropriate Admin/Settings screen and also configurable by agents via files/API.

**Architecture:** Use a shared typed settings model with three user-facing write paths: Admin UI, config file, and API. Runtime code reads only from the effective config/settings layer, never directly from hardcoded Henry/Enterprise defaults. Enterprise-specific values move into an opt-in profile.

**Tech Stack:** TypeScript, Express, React/Vite, SQLite/better-sqlite3, YAML config file, Vitest, Playwright/browser verification.

---

## Non-Negotiable Product Rule

For every value removed from hardcoded source:

1. It must have a **home settings area** in Admin UI.
2. It must have a **documented config-file key** for agent/human file edits.
3. It must have a **documented API path** if runtime editing is supported.
4. It must appear in `GET /api/config/effective` with source metadata.
5. It must have tests proving precedence and fallback behavior.

No orphan config. No invisible magic. No “just set an env var somewhere” scavenger hunt.

---

## Config Source Model

### Precedence

Highest wins:

1. CLI/env one-off overrides.
2. DB-backed Admin settings.
3. `entity.config.yaml`.
4. selected profile file under `config/profiles/*.yaml`.
5. safe built-in public defaults.

Enterprise/Henry-specific values are **not** built-in defaults. They live only in:

- `config/profiles/enterprise.example.yaml`
- internal docs
- local uncommitted config

### Public config file

Default path:

```text
./entity.config.yaml
```

Override:

```bash
ENTITY_CONFIG=/path/to/entity.config.yaml npm start
```

### Effective config API

```http
GET /api/config/effective
```

Response shape:

```json
{
  "version": 1,
  "settings": {},
  "sources": {
    "server.port": { "source": "env", "editableInUi": false },
    "agents.items": { "source": "database", "editableInUi": true }
  },
  "warnings": []
}
```

### Config write API

Use section-specific APIs where possible:

- `/api/settings/profile`
- `/api/settings/tasks`
- `/api/settings/docs`
- `/api/settings/agents`
- `/api/settings/file-sources`
- `/api/settings/services`
- `/api/settings/providers`
- `/api/settings/deploy`

General config file editing remains agent-friendly through documented YAML.

---

## Settings Areas and Ownership Matrix

| Domain | Admin UI screen | Config-file key | API | Current hardcoded examples | First implementation target |
|---|---|---|---|---|---|
| Workspace/Profile | Settings → Workspace | `profile`, `server.workspaceRoot`, `server.publicBaseUrl` | `/api/settings/profile` | Henry owner, Enterprise naming, `/Users/enterprise` | Slice 1 |
| Runtime/Server | Settings → Runtime | `server.port`, `apiBaseUrl`, `wsBaseUrl`, `databasePath`, `logPath` | `/api/settings/runtime` read mostly | `PORT=3000`, localhost/private fallbacks | Slice 1 |
| Deploy | Settings → Deploy | `deploy.*` | `/api/settings/deploy` | `enterprise@100.104.229.62`, `/Users/enterprise/Services/entity` | Slice 2 |
| Tasks / MC | Settings → Mission Control | `tasks.*`, `projects`, `assignees`, `priorityDefaults` | `/api/settings/tasks` | Henry, Ada/Spock assignees, project lists | Slice 5 |
| Docs | Settings → Docs | `docs.roots`, `docs.allowedExtensions`, `docs.outputLinking` | `/api/settings/docs` | `/Users/enterprise/clawd`, `.md` assumptions | Slice 4 |
| File Sources | Settings → File Sources | `fileSources[]` | existing `/api/sources` + `/api/settings/file-sources` | vault/ada/spock/zora auto-seeds | Slice 3 |
| Agents | Settings → Agents | `agents[]` | `/api/settings/agents`, `/api/agents/registry` | Ada/Spock/Zora built-ins | Slice 5 |
| Agent Gateways | Settings → Agents → Gateway | `agents[].gateway` | `/api/settings/agents/:id/gateway` | OpenClaw `100.106.69.9:18789` | Slice 5 |
| Terminal Hosts | Settings → Terminal | `terminal.targets[]` | `/api/settings/terminal` | ada-gw/spock/scotty/mac/enterprise | Slice 6 |
| Services | Settings → Services | `services[]` | `/api/settings/services` | n8n/Vaultwarden/OpenClaw private URLs | Slice 6 |
| Providers | Settings → Providers | `providers.*` | `/api/settings/providers` | Ollama private host, Codex paths, eForge queue | Slice 7 |
| TTS/Voice | Settings → Voice | `providers.tts`, existing DB settings | existing `/api/tts/settings` | edge-tts binary under `/Users/enterprise` | Slice 7 |
| Plugins | Settings → Plugins | `plugins.*` | existing plugin settings APIs | plugin defaults with private URLs | Slice 8 |
| Onboarding | First-run setup | generated `entity.config.yaml` | `/api/onboarding/*` | none | Slice 2 |

---

## Human vs Agent Configuration Contract

Every docs page must show both paths.

### Human UI path template

```markdown
## Configure Docs Roots in the UI

1. Open Entity → Settings → Docs.
2. Add a root:
   - ID: `workspace`
   - Base path: `/path/to/your/workspace`
   - Allowed extensions: `.md,.txt,.json,.yaml,.csv,.log`
3. Click “Test root”.
4. Click “Save”.
5. Open `/docs/workspace/...` to verify.
```

### Agent config-file path template

```yaml
docs:
  roots:
    - id: workspace
      displayName: Workspace
      type: local
      basePath: "${HOME}/entity-workspace"
      allowedExtensions: [md, markdown, txt, log, json, jsonl, yaml, yml, csv, tsv]
```

Agent verification command:

```bash
npm run doctor -- --section docs
curl -s http://localhost:3000/api/config/effective | jq '.settings.docs'
```

---

## Slice-by-Slice Execution Plan

Each slice must finish with:

- unit/integration tests passing
- relevant app/server build passing
- effective config endpoint checked
- UI smoke/browser check if screen changed
- MC task note with exact evidence
- commit or clean diff checkpoint

### Slice 0 — Baseline and Guardrails

**Objective:** Capture current behavior and prevent accidental private defaults from expanding.

**Files:**
- Create: `scripts/scan-private-defaults.mjs`
- Create: `docs/config/private-default-scan.md`
- Modify: `package.json`

**Tasks:**
1. Add scan script for runtime source files, excluding internal docs/tests/fixtures.
2. Detect forbidden public-runtime defaults:
   - `100.104.` / `100.106.` / other Tailnet IP defaults
   - `/Users/enterprise`
   - `/home/henrymascot`
   - `/home/jamify`
   - `enterprise@`
3. Add `npm run scan:private-defaults`.
4. Run baseline; record allowed current exceptions.

**Verify:**
```bash
npm run scan:private-defaults
npm --prefix packages/server run build
npm --prefix packages/app run build
```

**Acceptance:** scan exists and can be tightened slice by slice.

---

### Slice 1 — Shared Config Schema + Effective Config

**Objective:** Add additive config infrastructure without changing runtime behavior.

**Files:**
- Create: `packages/server/src/config/schema.ts`
- Create: `packages/server/src/config/load.ts`
- Create: `packages/server/src/config/effective.ts`
- Create: `packages/server/src/config/routes.ts`
- Create: `packages/server/src/config/__tests__/config-load.test.ts`
- Modify: `packages/server/src/index.ts`
- Create: `.env.example`
- Create: `entity.config.example.yaml`

**Config sections introduced:**
- `profile`
- `server`
- `deploy`
- `tasks`
- `docs`
- `fileSources`
- `agents`
- `terminal`
- `services`
- `providers`
- `plugins`

**Human UI:** none yet; endpoint only.

**Agent config:** documented in `entity.config.example.yaml`.

**Verify:**
```bash
npm --prefix packages/server test -- --run src/config/__tests__/config-load.test.ts
npm --prefix packages/server run build
curl -s http://localhost:3000/api/config/effective | jq .version
```

**Acceptance:** fresh config loads safe defaults; Enterprise values only appear if explicitly provided.

---

### Slice 2 — First-Run Onboarding + Workspace Settings

**Objective:** Give humans a UI setup path and agents a generated config path.

**Files:**
- Create: `packages/server/src/onboarding/routes.ts`
- Create: `packages/server/src/onboarding/status.ts`
- Create: `packages/app/src/components/settings/WorkspaceSettings.tsx`
- Create: `packages/app/src/components/onboarding/FirstRunWizard.tsx`
- Modify: settings shell/router in app
- Docs: `docs/config/workspace.md`

**Settings screen:** Settings → Workspace / First Run.

**Config keys:**
```yaml
profile:
  displayName: "My Entity Workspace"
  ownerName: "Your Name"
server:
  workspaceRoot: "${HOME}/entity-workspace"
  publicBaseUrl: "http://localhost:3000"
```

**Agent path:** edit `entity.config.yaml`, run `npm run doctor -- --section workspace`.

**Human path:** first-run wizard creates/saves equivalent DB settings or generated config.

**Verify:**
- API tests for onboarding status.
- Browser check first-run wizard/settings screen renders.
- Effective config updates after save.

---

### Slice 3 — File Sources Become Onboarding-Managed

**Objective:** Stop automatic Henry workspace seeding as default behavior.

**Files:**
- Modify: `packages/server/src/fs/index.ts`
- Modify: `packages/server/src/fs/routes-sources.ts`
- Modify: `packages/app/src/components/settings/FileSourcesSettings.tsx`
- Docs: `docs/config/file-sources.md`

**Settings screen:** Settings → File Sources.

**Config keys:**
```yaml
fileSources:
  - id: workspace
    displayName: Workspace
    type: local
    basePath: "${server.workspaceRoot}"
    enabled: true
    icon: "📁"
    agentBindings: [assistant]
```

**Migration rule:** Existing Enterprise DB sources remain untouched on Henry’s instance. Fresh public installs seed only `workspace` if configured.

**Verify:**
```bash
npm --prefix packages/server test -- --run src/fs
npm --prefix packages/server run build
npm --prefix packages/app run build
```

Browser:
- Settings → File Sources can create/test a local source.
- File tree shows configured source.

---

### Slice 4 — Docs Settings and Output Link Resolution

**Objective:** Docs/output links resolve from configured docs roots and allowed extensions.

**Files:**
- Modify: `packages/server/src/routes/docs.ts`
- Modify: `packages/app/src/components/mission-control/TaskDetailPanel.tsx`
- Create/modify docs route tests
- Create: `packages/app/src/components/settings/DocsSettings.tsx`
- Docs: `docs/config/docs.md`

**Settings screen:** Settings → Docs.

**Config keys:**
```yaml
docs:
  allowedExtensions: [md, markdown, txt, log, json, jsonl, yaml, yml, csv, tsv]
  roots:
    - id: workspace
      sourceId: workspace
      basePath: "${server.workspaceRoot}"
  outputLinking:
    requireKnownExtension: true
    autoLinkTaskOutput: true
```

**Agent path:** edit config; run docs doctor; curl `/api/docs/...`.

**Human path:** add/test docs roots in UI.

**Verify:**
- Unit tests: containment, extension allowlist, configured root lookup.
- Playwright: click actual task output links and screenshot rendered docs.

---

### Slice 5 — Agents + Mission Control Settings

**Objective:** Replace hardcoded Enterprise crew and MC defaults with configurable agents/tasks settings.

**Files:**
- Modify/create DB agent registry module.
- Modify: `packages/app/src/lib/agentRegistry.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/server/src/editor/auth.ts`
- Modify: `packages/server/src/fs/classify.ts`
- Modify: MC create/filter components.
- Create: `packages/app/src/components/settings/AgentsSettings.tsx`
- Create: `packages/app/src/components/settings/MissionControlSettings.tsx`
- Docs: `docs/config/agents.md`, `docs/config/mission-control.md`

**Settings screens:**
- Settings → Agents
- Settings → Mission Control

**Config keys:**
```yaml
agents:
  - id: assistant
    name: Assistant
    emoji: "🤖"
    role: general
    gateway:
      type: local
      url: null
    fileSources: [workspace]

tasks:
  defaultAssignee: assistant
  assigneesFromAgents: true
  projects:
    - General
  priorities: [P1, P2, P3, P4]
```

**Migration rule:** Enterprise profile imports Ada/Spock/etc.; public default has only Assistant.

**Verify:**
- Agent registry tests.
- MC create task dropdown uses configured agents.
- Chat/sidebar/files filters use configured agents.
- Existing Enterprise DB still shows crew after profile import/current DB.

---

### Slice 6 — Deploy, Terminal, Services Settings

**Objective:** Move deployment targets, terminal hosts, and service cards out of code.

**Files:**
- Modify: `deploy.sh`
- Modify: `scripts/ctrl-deploy-path-check.sh`
- Modify: `packages/server/src/terminal.ts`
- Modify: `packages/server/src/plugins/entity-services/routes.ts`
- Create: `packages/app/src/components/settings/DeploySettings.tsx`
- Create: `packages/app/src/components/settings/TerminalSettings.tsx`
- Create: `packages/app/src/components/settings/ServicesSettings.tsx`
- Docs: `docs/config/deploy.md`, `docs/config/terminal.md`, `docs/config/services.md`

**Settings screens:**
- Settings → Deploy
- Settings → Terminal
- Settings → Services

**Config keys:**
```yaml
deploy:
  mode: local
  sshTarget: null
  remoteDir: null
  preserveDatabase: true

terminal:
  targets: []

services:
  - id: entity
    name: Entity
    url: "http://localhost:3000"
    healthUrl: "http://localhost:3000/api/health"
    enabled: true
```

**Verify:**
- Deploy script dry-run reads config.
- Services UI creates/edits service and health-checks it.
- No Enterprise service appears on fresh public default.

---

### Slice 7 — Providers, Gateways, Voice/TTS Settings

**Objective:** Provider URLs, binaries, queues, and command paths become editable settings.

**Files:**
- Modify: `packages/server/src/routes/search.ts`
- Modify: `packages/server/src/routes/chat.ts`
- Modify: `packages/server/src/swarm/providers/*`
- Modify: `packages/server/src/routes/tts.ts`
- Modify: voice/settings UI components
- Create: `packages/app/src/components/settings/ProvidersSettings.tsx`
- Docs: `docs/config/providers.md`, `docs/config/voice.md`

**Settings screen:** Settings → Providers / Voice.

**Config keys:**
```yaml
providers:
  ollama:
    enabled: false
    baseUrl: "http://localhost:11434"
  openclaw:
    enabled: false
    baseUrl: null
    tokenRef: null
  eforge:
    enabled: false
    apiUrl: null
    queueDir: null
  codex:
    enabled: false
    command: codex
    homeDir: null
  tts:
    defaultProvider: browser
    providers: {}
```

**Verify:**
- Disabled providers do not attempt private hosts.
- UI can save/test provider config.
- Existing TTS settings still load.

---

### Slice 8 — Plugin Settings Public-Safe Defaults

**Objective:** Plugin manifests cannot expose private defaults unless profile-imported.

**Files:**
- Modify: `packages/server/src/plugins/entity-services/plugin.json`
- Modify: `packages/server/src/plugins/entity-linker/plugin.json`
- Modify: plugin registry defaults if needed
- Docs: `docs/config/plugins.md`

**Settings screen:** Settings → Plugins.

**Config keys:**
```yaml
plugins:
  entity-services:
    enabled: false
    settings: {}
```

**Verify:**
- Plugin settings tests.
- Fresh default plugin list has no Henry/Tailnet services.
- Enterprise profile can import them explicitly.

---

### Slice 9 — Public Docs + Agent Docs

**Objective:** Document both human UI and agent config workflows for every settings area.

**Files:**
- Rewrite: `README.md`
- Create: `docs/config/README.md`
- Create: `docs/config/agent-configuration.md`
- Create: `docs/config/human-admin-ui.md`
- Create: `docs/internal/enterprise-profile.md`
- Create/update: `docs/decisions/ADR-001-settings-backed-config.md`

**Required docs per section:**
- What it controls.
- Admin UI path.
- YAML config key.
- API endpoint.
- Verification command.
- Common failure modes.

**Verify:**
- README quick start works on fresh local config.
- Agent docs include copy-pasteable config snippets.

---

## Settings Screen Inventory

Target Admin/Settings navigation:

```text
Settings
├── Workspace
├── Mission Control
├── Docs
├── File Sources
├── Agents
│   └── Gateways
├── Runtime
├── Deploy
├── Terminal
├── Services
├── Providers
├── Voice
├── Plugins
└── Doctor
```

Doctor should show:

- config file loaded/not loaded
- DB settings reachable
- workspace root exists/writable
- docs roots valid
- file sources valid
- agent gateways reachable if enabled
- services reachable if enabled
- providers reachable if enabled
- private/default scan status

---

## Verification Policy

### Backend/settings slices

Run:

```bash
npm --prefix packages/server test -- --run
npm --prefix packages/server run build
curl -s http://localhost:3000/api/config/effective | jq .
```

### Frontend/settings slices

Run:

```bash
npm --prefix packages/app run build
```

Then browser verify:

- open Settings screen
- make/edit/save setting
- reload
- verify effective config/API changed
- screenshot evidence when UI behavior is material

### Docs/output/file-source slices

Must include Playwright link/open verification. DOM/API-only checks are not enough.

---

## Rollback Strategy

- Each slice gets one branch/commit checkpoint.
- If tests/build fail and cannot be fixed quickly, revert the slice only.
- Existing Enterprise values remain supported through explicit profile/config during migration.
- Do not remove old hardcoded runtime fallback until replacement settings path is tested.

---

## MC Execution Checklist

For task `#563`, update progress after each slice:

```text
Slice N complete:
- Files changed:
- Tests:
- Build:
- Browser verification:
- Effective config proof:
- Known risk / next slice:
```

---

## Open Decisions for Henry

1. Should DB-backed Admin settings be allowed to write back to `entity.config.yaml`, or should UI edits stay in DB only?
   - Recommendation: UI edits stay in DB; export/import config supported separately.
2. Should Enterprise profile ship in public repo as example, or stay internal-only?
   - Recommendation: public `enterprise.example.yaml` with redacted localhost-like placeholders; real internal profile uncommitted.
3. Should setup wizard require auth before public release?
   - Recommendation: local/private first; add auth gate before internet-facing release.
