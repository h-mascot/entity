# Entity Configuration Onboarding

Entity configuration has two supported paths:

1. **Human path:** Admin → General → Effective Entity Config and adjacent Admin settings panels.
2. **Agent/operator path:** `entity.config.yaml`, optional profiles, and documented runtime APIs.

Both paths converge in `GET /api/config/effective`, which returns the resolved settings plus source metadata for each value.

## Precedence

The effective configuration is resolved in this order:

1. Built-in product defaults
2. Optional profile file selected by `ENTITY_PROFILE` or `ENTITY_PROFILE_PATH`
3. `entity.config.yaml`, or the file pointed to by `ENTITY_CONFIG`
4. DB-backed runtime settings written by Admin/runtime APIs
5. Environment overrides for process/runtime values

Use `/api/config/effective` to inspect the final value and source for a field before assuming which layer won.

## Quick start for a new installation

Create `entity.config.yaml` in the Entity working directory using the setup command:

```bash
npm run setup
# or, for CI/non-interactive local defaults:
npm run setup -- --defaults
```

You can also copy the example manually:

```bash
cp docs/config/entity.config.example.yaml entity.config.yaml
```

Then edit installation-specific values:

- `profile.displayName`
- `profile.ownerName`
- `server.publicBaseUrl`
- `server.workspaceRoot`
- `server.databasePath`
- `agents`
- `fileSources`
- `tasks.defaultAssignee`
- `plugins.entity-services.settings.services` for any external service catalog entries

Keep secrets out of this file when possible. Use environment variables or secret references, and expect `/api/config/effective` to redact token-like fields.

## Production deploy profiles

`./deploy.sh` intentionally refuses to run until a production target and DB are explicit. Use environment variables or a private wrapper/profile to provide these values; do not add private defaults to public source.

Required:

- `ENTITY_PROD_HOST`
- `ENTITY_PROD_HTTP_HOST`
- `ENTITY_PROD_DIR`
- `ENTITY_PROD_DB`

Optional runtime knobs:

- `ENTITY_PROD_PORT` — port used for fallback runtime and verification URL construction; default `3000`.
- `ENTITY_RUNTIME_WORKSPACE` — workspace path passed to the server process.
- `ENTITY_PROD_LOG_PATH` — remote fallback process log path.
- `ENTITY_PROD_LAUNCHD_SERVICE` — macOS launchd service label to restart when the deployment uses launchd.
- `ENTITY_PROD_NODE_ENTRY` — server entrypoint relative to `ENTITY_PROD_DIR` for fallback process startup.

Run `ENTITY_DEPLOY_DRY_RUN=1 ./deploy.sh --print-config` to inspect the resolved profile without deploying.

## Human Admin path

Use Admin → General → Effective Entity Config for safe runtime edits:

- Workspace display name
- Workspace owner
- Public URL
- Default assignee

These edits are written to DB-backed runtime settings through:

```http
PATCH /api/settings/config/runtime
Content-Type: application/json
```

Example:

```json
{
  "profile": {
    "displayName": "Team Workspace",
    "ownerName": "Operations"
  },
  "server": {
    "publicBaseUrl": "http://localhost:3000"
  },
  "tasks": {
    "defaultAssignee": "assistant"
  }
}
```

The response is the same effective config shape returned by `/api/config/effective`.

## Agent/operator file path

Agents and operators can configure a portable install through `entity.config.yaml`:

```yaml
version: 1
profile:
  displayName: Team Workspace
  ownerName: Operations
server:
  host: 127.0.0.1
  port: 3000
  workspaceRoot: ./workspace
  publicBaseUrl: http://localhost:3000
  apiBaseUrl: http://localhost:3000
  wsBaseUrl: ws://localhost:3000
  databasePath: ./data/entity.sqlite
  logPath: ./logs/entity.log
agents:
  - id: assistant
    name: Assistant
    role: general
    enabled: true
    fileSources: []
    healthUrls: []
    workspaceRoot: null
    gateway:
      type: none
      url: null
      tokenRef: null
fileSources:
  - id: workspace
    displayName: Workspace
    type: local
    basePath: ./workspace
    baseUrl: null
    enabled: true
    agentBindings: [assistant]
tasks:
  defaultAssignee: assistant
  assigneesFromAgents: true
plugins:
  entity-services:
    settings:
      entityBaseUrl: http://localhost:3000
      externalAdminUrl: ""
      services: []
      discoverGatewayServices: false
      discoverMacServices: false
```

A maintained copy of this example lives at `docs/config/entity.config.example.yaml`.

To point Entity at another config file:

```bash
ENTITY_CONFIG=/path/to/entity.config.yaml npm --prefix packages/server run dev
```

To select a profile file:

```bash
ENTITY_PROFILE=local npm --prefix packages/server run dev
```

Entity will look for `config/profiles/local.yaml` under the process working directory. Use `ENTITY_PROFILE_PATH=/absolute/profile.yaml` to bypass that convention.

## Runtime inspection

Check the effective config:

```bash
curl -s http://localhost:3000/api/config/effective
```

Useful fields:

- `settings`: resolved config values
- `sources`: source metadata by config path
- `warnings`: parse/load warnings
- `configPath`: resolved `entity.config.yaml` path
- `profilePath`: resolved profile path, if any

Source metadata includes:

- `source`: `default`, `profile`, `config`, `database`, or `env`
- `editableInUi`
- `secret`
- `sensitive`
- `adminOnly`
- `advanced`
- `requiresRestart`
- `overriddenBy`

## Portability policy

Safe built-in defaults are allowed only when they are universal product behavior. Installation-specific hosts, private paths, personal names, private services, agent names, and secrets belong in explicit config, profiles, DB settings, or environment variables.

Do not ship private installation values as defaults. If a value identifies one operator, one machine, one Tailnet, or one private service, move it behind configuration.
