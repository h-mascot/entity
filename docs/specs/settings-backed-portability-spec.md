# Spec: Settings-Backed Entity Portability

## Objective

Prepare Entity so people outside Henry's Enterprise environment can install, run, configure, and onboard their own agents/filesystems without editing source code.

Success means every deploy/runtime/filesystem/agent/service/provider/task/docs value that varies by installation has both:

1. a human Settings/Admin UI path, and
2. an agent-friendly config/API path.

The system must preserve Henry's Enterprise setup through an explicit local/profile configuration, not through public built-in defaults.

## Core Product Principle

A value may remain a universal built-in default only if it is true for nearly every Entity installation and does not name Henry, Enterprise, private hosts, private paths, private services, or a specific crew.

### Universal defaults allowed

These can remain hardcoded/public defaults:

- Safe local bind defaults, e.g. `localhost`, `127.0.0.1`, port `3000` if not occupied.
- Conventional relative paths under the app/workspace, e.g. `./data/entity.sqlite`, `./workspace`, `./logs`.
- Generic default role/agent names, e.g. `Assistant`, only when clearly sample/default.
- Safe file extension allowlists, e.g. `.md`, `.txt`, `.json`, `.yaml`, `.csv`, `.log`.
- Generic task columns and priorities, e.g. `todo`, `doing`, `review`, `done`, `P1-P4`.
- Disabled-by-default provider/service/plugin templates.
- UI labels that describe product concepts, e.g. `Mission Control`, `Docs`, `Agents`.

### Universal defaults not allowed

These must move to config/settings/profile:

- Absolute user paths: `/Users/enterprise`, `/home/henrymascot`, `/home/jamify`.
- Private networks/hosts: Tailnet `100.*`, LAN IPs, gateway hostnames tied to Henry.
- Named Enterprise crew defaults: Ada, Spock, Scotty, Zora, Midas, Uhura, Book, Geordi.
- Henry/Enterprise owner names, projects, service names, or URLs.
- Runtime command paths, model/provider URLs, queue directories, service catalogs.
- Deployment target, SSH target, remote directory, launch/service manager.
- Assumptions that a workspace is named `clawd` or that agent workspaces are siblings.

Reasoning: many variables were hardcoded originally because Entity was built inside one operating environment. That made shipping fast, but it is now product debt. The portability requirement changes the rule: installation-specific values belong in settings/config.

## Configuration Contract

### Bootstrap vs runtime settings

Entity has two config phases:

1. **Bootstrap config** — loaded before the database exists.
   - Sources: CLI/env, `entity.config.yaml`, selected profile, safe defaults.
   - Examples: config file path, selected profile, database path, host, port, initial workspace root.
   - DB-backed settings cannot override these for the current process because they are needed to find/start the DB and server.
   - UI may display these as read-only or restart-required.

2. **Runtime effective config** — loaded after bootstrap and DB initialization.
   - Sources: bootstrap config plus DB-backed Admin settings.
   - Examples: docs roots, file sources, agents, task defaults, providers, services, plugins, voice.
   - Runtime settings may be edited in Settings UI when safe.

### Sources and precedence

Highest wins:

1. CLI flags / process env one-off overrides.
2. DB-backed Admin settings, except bootstrap-only fields.
3. `entity.config.yaml`.
4. selected profile file under `config/profiles/*.yaml`.
5. safe public built-in defaults.

All env/CLI overrides must be allowlisted, validated, documented, and visible in effective config source metadata.

### Merge semantics

- Scalars: highest defined source wins.
- Objects: deep merge by key unless the schema marks the object atomic.
- Arrays of entities: merge by stable `id`; never merge by index.
- Ordered arrays: use explicit `order` or explicit replacement semantics.
- Missing/undefined: inherit from lower-precedence source.
- `null`: intentional clear/disable where the schema allows it.
- Deletion: represented explicitly, not by accidental omission.
- Effective config must include conflict/shadowing warnings when a lower source is overridden by a higher source.

### Effective configuration endpoint

All runtime-readable settings must be observable at:

```http
GET /api/config/effective
```

Response requirements:

```json
{
  "version": 1,
  "settings": {},
  "sources": {
    "docs.roots[0].basePath": {
      "source": "database|config|profile|default|env",
      "editableInUi": true,
      "secret": false,
      "sensitive": false,
      "adminOnly": false,
      "advanced": false,
      "requiresRestart": false,
      "overriddenBy": null
    }
  },
  "warnings": []
}
```

Secrets must never be returned raw. Use references such as `env:OPENCLAW_TOKEN` or `[REDACTED]`.

### UI vs config-file rule

Every configurable domain must document both flows:

- Human: Settings screen path, form fields, test button, save behavior.
- Agent: YAML keys, API endpoint if mutable, verification command.

UI edits should be stored in DB-backed settings by default. Config-file edits remain the agent-friendly/deployable path. Export/import can bridge them later; UI should not silently rewrite `entity.config.yaml` unless the user explicitly chooses export.

## Security and Safety Requirements

### Admin settings security model

- `/api/settings/*` mutating routes require admin authorization except during a tightly scoped first-run setup.
- `/api/config/effective` is admin-only by default or returns a redacted safe view for non-admin contexts.
- Settings writes must be audit logged with actor, timestamp, changed keys, source IP, and redacted values.
- Remote setup/admin exposure is blocked by default until auth is configured.
- Browser-authenticated writes require CSRF protection once cookie/session auth exists.

### Secrets contract

- Store references, not raw secrets: `env:NAME` first; future secret stores may be added later.
- UI secret fields are write-only/status-only: `[configured]`, `[missing]`, or `env:NAME`.
- Config export, doctor, logs, API responses, validation errors, and screenshots must never contain raw secrets.
- DB settings may store secret references, not raw provider tokens, unless encrypted-at-rest support is explicitly designed and approved.

### Filesystem safety contract

- Canonicalize configured paths with realpath before serving or writing files.
- File-serving APIs enforce containment after symlink resolution.
- Reject traversal, NUL bytes, malformed encodings, and absolute path injection.
- Warn or reject sensitive roots such as `/`, `/etc`, `$HOME`, `.ssh`, app source root, DB directory, config directory, and log directories.
- Docs/file APIs must use configured root IDs, not arbitrary raw filesystem paths.
- Tests must cover `../`, URL-encoded traversal, double-encoded traversal, symlink escape, and absolute path injection.

### Outbound network safety

- Disabled providers/services/gateways make zero network calls.
- Test/doctor calls only run after explicit admin action or enabled CI check.
- All outbound checks require timeouts, response-size limits, credential redaction, and redirect controls.
- Block cloud metadata/link-local targets by default.
- Private-network checks are allowed only when explicitly enabled for local/private deployments.

### Command execution safety

- Deploy/terminal/provider command settings are privileged admin-only settings.
- Store structured arguments, not shell command strings.
- Use spawn/exec-file style invocation, not shell interpolation.
- Reject shell metacharacters unless an explicitly reviewed advanced mode is added.

## Settings UX Model

Visible Settings IA should group technical domains into product-facing sections:

```text
Settings
├── Workspace
├── Agents
├── Knowledge & Files
├── Mission Control
├── Integrations
└── System
```

Domain mapping:

- Workspace: profile, workspace root, public URL, advanced paths.
- Agents: agent list, file access, gateway/provider binding.
- Knowledge & Files: file sources, docs roots, output linking.
- Mission Control: projects, task columns, priorities, assignees.
- Integrations: providers, services, voice, plugins, terminal targets.
- System: runtime, deploy, doctor, effective config/debug.

Each setting must declare:

- `editableInUi`
- `advanced`
- `requiresRestart`
- `secret`
- `sensitive`
- `source`
- validation status

UI screens must show effective source, dirty state, validation/test result, restart requirement, and when a higher-precedence source blocks a save.

## First-Run Onboarding Requirements

Fresh installs should guide humans through a short flow:

1. Welcome.
2. Workspace name/owner/workspace folder.
3. Files/docs root selection and read test.
4. Default `Assistant` agent, with optional rename.
5. Optional provider connection, default no.
6. Review effective config, run Doctor, finish.

First-run setup is single-use, race-safe, and localhost-only by default. Remote setup requires an out-of-band bootstrap token printed to server logs/CLI.

## Agent Configuration Contract

Agents changing Entity config must:

1. Read `GET /api/config/effective` first.
2. Prefer `entity.config.yaml` for durable repo/deploy changes.
3. Prefer settings API for runtime/UI-equivalent user-requested changes.
4. Never write raw secrets; use secret references.
5. Never overwrite DB-backed human choices unless explicitly asked.
6. Report env/CLI override shadowing instead of mutating lower-precedence config blindly.
7. Verify with Doctor, effective config, and section-specific endpoint after changes.

## Migration Safety Contract

Migration modes:

1. Fresh install — safe public defaults only.
2. Existing Enterprise install — preserve current DB/profile values; do not delete or rewrite private values without approval.
3. Existing custom install — preserve DB state; warn about private-looking values; do not delete.
4. Invalid config recovery — boot safe enough to show actionable error/doctor output.

All migrations must be additive first, idempotent, dry-runnable, and reversible at the code level. Destructive DB changes require explicit approval.

## Settings Domains

### 1. Workspace/Profile

Admin UI: `Settings → Workspace`

Config keys:

```yaml
profile:
  displayName: "My Entity Workspace"
  ownerName: "Your Name"
server:
  workspaceRoot: "${HOME}/entity-workspace"
  publicBaseUrl: "http://localhost:3000"
  databasePath: "./data/entity.sqlite"
  logPath: "./logs/entity.log"
```

API:

- `GET /api/settings/profile`
- `PUT /api/settings/profile`
- `GET /api/config/effective`

Acceptance:

- Fresh install does not mention Henry or Enterprise.
- Henry's install can load Enterprise profile without source edits.

### 2. Runtime

Admin UI: `Settings → Runtime`

Config keys:

```yaml
server:
  host: "127.0.0.1"
  port: 3000
  apiBaseUrl: "http://localhost:3000"
  wsBaseUrl: "ws://localhost:3000"
```

API:

- `GET /api/settings/runtime`
- `GET /api/config/effective`

Runtime settings that require restart may be read-only in UI with clear messaging.

### 3. Deploy

Admin UI: `Settings → Deploy`

Config keys:

```yaml
deploy:
  mode: local
  sshTarget: null
  remoteDir: null
  serviceManager: null
  preserveDatabase: true
  dryRunByDefault: true
```

API:

- `GET /api/settings/deploy`
- `PUT /api/settings/deploy`

Acceptance:

- Public deploy defaults never target Enterprise.
- Enterprise deployment is an explicit profile.

### 4. Mission Control / Tasks

Admin UI: `Settings → Mission Control`

Config keys:

```yaml
tasks:
  columns: [todo, doing, review, done]
  priorities: [P1, P2, P3, P4]
  defaultAssignee: assistant
  assigneesFromAgents: true
  projects:
    - General
```

API:

- `GET /api/settings/tasks`
- `PUT /api/settings/tasks`

Acceptance:

- Task create/filter UI uses configured agents/projects/priorities.
- Existing DB task history is not rewritten unless explicitly migrated.

### 5. Docs

Admin UI: `Settings → Docs`

Config keys:

```yaml
docs:
  allowedExtensions: [md, markdown, txt, log, json, jsonl, yaml, yml, csv, tsv]
  roots:
    - id: workspace
      displayName: Workspace
      basePath: "${server.workspaceRoot}"
      sourceId: workspace
  outputLinking:
    autoLinkTaskOutput: true
    requireKnownExtension: true
```

API:

- `GET /api/settings/docs`
- `PUT /api/settings/docs`
- `GET /api/docs/:root/*`

Acceptance:

- Docs roots are configured from settings/file sources, not source constants.
- Playwright clicks task output links and screenshots rendered docs after changes.

### 6. File Sources

Admin UI: `Settings → File Sources`

Config keys:

```yaml
fileSources:
  - id: workspace
    displayName: Workspace
    type: local
    basePath: "${server.workspaceRoot}"
    enabled: true
    icon: "folder"
    agentBindings: [assistant]
```

API:

- existing `/api/sources`
- `GET /api/settings/file-sources`
- `PUT /api/settings/file-sources`

Acceptance:

- Fresh install does not seed Ada/Spock/Zora/vault sources.
- Enterprise sources come from explicit profile/current DB only.

### 7. Agents

Admin UI: `Settings → Agents`

Config keys:

```yaml
agents:
  - id: assistant
    name: Assistant
    role: general
    avatar: null
    emoji: "🤖"
    enabled: true
    fileSources: [workspace]
    gateway:
      type: none
      url: null
      tokenRef: null
```

API:

- `GET /api/settings/agents`
- `PUT /api/settings/agents`
- `GET /api/agents/registry`

Acceptance:

- Frontend agent registry comes from API/settings.
- Enterprise crew is imported/profiled, not public default.
- Editor auth and file classification derive from registered agents.

### 8. Terminal

Admin UI: `Settings → Terminal`

Config keys:

```yaml
terminal:
  targets: []
```

API:

- `GET /api/settings/terminal`
- `PUT /api/settings/terminal`

Acceptance:

- No public hardcoded Tailnet terminal targets.
- UI shows no target until configured, or only local target if safe.

### 9. Services

Admin UI: `Settings → Services`

Config keys:

```yaml
services:
  - id: entity
    name: Entity
    url: "http://localhost:3000"
    healthUrl: "http://localhost:3000/api/health"
    enabled: true
```

API:

- `GET /api/settings/services`
- `PUT /api/settings/services`

Acceptance:

- Private service catalog is opt-in profile only.
- Health checks use configured URLs.

### 10. Providers / Gateways

Admin UI: `Settings → Providers`

Config keys:

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
```

API:

- `GET /api/settings/providers`
- `PUT /api/settings/providers`

Acceptance:

- Disabled providers do not make network calls.
- Private provider hosts appear only through explicit config/profile.

### 11. Voice/TTS

Admin UI: `Settings → Voice`

Config keys:

```yaml
voice:
  defaultProvider: browser
  providers: {}
```

API:

- existing TTS settings endpoints
- `GET /api/settings/voice`
- `PUT /api/settings/voice`

Acceptance:

- No absolute binary path is assumed for public installs.
- UI test validates provider only when enabled.

### 12. Plugins

Admin UI: `Settings → Plugins`

Config keys:

```yaml
plugins:
  entity-services:
    enabled: false
    settings: {}
```

API:

- existing plugin settings APIs
- `GET /api/settings/plugins`
- `PUT /api/settings/plugins`

Acceptance:

- Plugin manifests have public-safe defaults.
- Private plugin defaults move to profile/settings.

### 13. Doctor

Admin UI: `Settings → Doctor`

CLI:

```bash
npm run doctor
npm run doctor -- --section docs
```

Doctor must verify:

- config file loads
- effective config resolves
- database reachable
- workspace exists/writable
- docs roots valid
- file sources valid
- agent gateways reachable if enabled
- services reachable if enabled
- providers reachable if enabled
- private-default scan passes

## Documentation Requirements

Create docs under `docs/config/`:

- `README.md`
- `human-admin-ui.md`
- `agent-configuration.md`
- `workspace.md`
- `runtime.md`
- `deploy.md`
- `mission-control.md`
- `docs.md`
- `file-sources.md`
- `agents.md`
- `terminal.md`
- `services.md`
- `providers.md`
- `voice.md`
- `plugins.md`
- `doctor.md`

Each doc must include:

1. What this setting controls.
2. Human UI steps.
3. Agent YAML snippet.
4. API endpoint if mutable.
5. Verification command.
6. Common failure modes.

## Testing Strategy

### Per slice

Required:

```bash
npm --prefix packages/server run build
npm --prefix packages/app run build
npm run ctrl:full
```

Also run targeted tests for changed packages.

### API verification

Every settings slice must verify:

```bash
curl -s http://localhost:3000/api/config/effective
```

and any section-specific endpoint.

### UI verification

Every UI settings slice must verify with browser/Playwright:

1. Open Settings screen.
2. Read current value.
3. Save a safe test value or use dry-run/test button.
4. Reload.
5. Confirm API/effective config reflects it.
6. Capture screenshot for material UI flows.

### Docs/output verification

For docs/output changes, API checks are insufficient. Must click actual links in the browser and capture screenshots.

## Execution Slices

1. Baseline/private-default scan.
2. Shared config schema/loader and `/api/config/effective`.
3. First-run onboarding and Workspace settings.
4. File Sources settings and seeding migration.
5. Docs settings and output-link resolution.
6. Agents and Mission Control settings.
7. Deploy, Terminal, Services settings.
8. Providers, Gateways, Voice settings.
9. Plugin public-safe defaults.
10. Public docs and agent docs.

## Boundaries

Always:

- Execute one slice at a time.
- Keep Enterprise profile working via explicit profile/current DB.
- Run API + UI verification for each relevant slice.
- Run `npm run ctrl:full` after each section.
- Commit/checkpoint after each passing slice.
- Update MC task `#563` with proof.

Ask first:

- DB destructive migrations.
- Removing existing Enterprise data.
- Adding large dependencies.
- Changing auth/security model.
- Exposing setup/admin screens beyond localhost/private deployment.

Never:

- Commit real secrets.
- Ship Henry/Enterprise private paths as public defaults.
- Treat DOM/API existence as proof of UI behavior.
- Leave config reachable only through undocumented env vars.
- Move a setting without UI/docs/API/config-file story.

## Rollback Strategy

- Each slice must be independently revertable.
- Additive infrastructure first; behavior changes later.
- Old hardcoded fallback may remain temporarily behind explicit deprecation until replacement is tested.
- If `ctrl:full` fails after a slice and the failure is from the slice, revert or fix before continuing.

## Success Criteria

Entity is ready for external-user onboarding when:

- A fresh clone can run from safe defaults.
- A human can configure workspace/docs/agents/providers from Settings UI.
- An agent can configure the same via `entity.config.yaml` and documented APIs.
- `GET /api/config/effective` explains what setting came from where.
- Private Enterprise assumptions pass the private-default scan only in internal/profile files.
- `npm run ctrl:full` passes after the full migration.
- Browser verification proves critical UI settings and docs/task-output flows work.
