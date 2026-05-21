# Enterprise Profile

This directory contains internal documentation for Enterprise-specific Entity deployments. These docs assume you are a member of the Enterprise team and have access to the Enterprise infrastructure (Tailscale network, production database, agent gateways).

**For public/open-source users**: See the top-level `README.md` and `entity.config.example.yaml` for local-first setup. The public docs assume no access to Enterprise systems.

---

## Enterprise Deployment

### Production Host

```
Host: enterprise@100.104.229.62
Entity install: /Users/enterprise/Services/entity
DB: /Users/enterprise/Services/entity/packages/server/dist/db/entity-tasks.db
Runtime workspace: /home/henrymascot/clawd
Server log: /tmp/entity-server.log
```

### Deploy Process

Use the canonical pipeline (never rsync directly to production):

```bash
# From Mac (source of truth)
cd ~/Code/entity

# Set required env vars
export ENTITY_PROD_HOST=enterprise@100.104.229.62
export ENTITY_PROD_HTTP_HOST=100.104.229.62
export ENTITY_PROD_PORT=3000
export ENTITY_PROD_DIR=/Users/enterprise/Services/entity
export ENTITY_PROD_DB=/Users/enterprise/Services/entity/packages/server/dist/db/entity-tasks.db
export ENTITY_RUNTIME_WORKSPACE=/home/henrymascot/clawd
export ENTITY_PROD_LOG_PATH=/tmp/entity-server.log
export ENTITY_PROD_LAUNCHD_SERVICE=com.claw.entity-server

# Deploy
./deploy.sh --all
```

### Production Database

The production DB contains real task data. It is symlinked from `packages/server/dist/db/entity-tasks.db` to the actual location. **Never overwrite production DB during deploys.**

### Agent Crew

| Agent | Gateway | Workspace | Role |
|---|---|---|---|
| ada | 100.106.69.9:18789 | ada-gateway | Orchestrator, primary |
| spock | 100.78.229.38:18789 | ~/clawd-spock | Research |
| scotty | 100.68.207.75:18789 | ~/clawd-scotty | Builder |
| geordi | localhost:18789 | ~/clawd-geordi | Codex builder |
| zora | localhost:18789 | ~/clawd-zora | Knowledge |
| book (this agent) | 100.86.150.96:18789 | ~/clawd | Builder |

### Private IPs (Tailscale)

| Service | Address |
|---|---|
| Enterprise Mac | 100.104.229.62 |
| Ada gateway | 100.106.69.9 |
| Spock gateway | 100.78.229.38 |
| Scotty gateway | 100.68.207.75 |
| MascotM3 (Book) | 100.86.150.96 |

### Tailscale Auth Keys

Stored in Vaultwarden under "Entity Tailscale". Reach out to Henry for access.

### External Services

| Service | URL/Host | Notes |
|---|---|---|
| Vaultwarden | localhost:61872 | Enterprise password manager |
| OpenClaw | enterprise.local | Agent gateway |
| n8n | localhost:5678 | Workflow automation |
| Entity Admin | 100.104.229.62:3000 | Production Entity |

### Mission Control

Production MC runs at: `http://100.104.229.62:3000`

### Secrets

All secrets are stored in Vaultwarden under the "Entity" collection. Use `bw.sh search <name>` to look up.

### Importing Enterprise Profile

If you need to restore Enterprise defaults in a local config:

```yaml
# In entity.config.yaml, use the enterprise profile
# (requires config/profiles/enterprise.yaml to be present)
version: 1
profile:
  id: enterprise
```

This is **not** the default and must be explicitly opted into.

---

## Crew Context Files

Each agent maintains its context in the workspace:

- `memory/YYYY-MM-DD.md` - daily activity logs
- `memory/projects/` - project-specific context
- `memory/decisions/` - architectural decisions
- `memory/lessons/` - mistakes and learnings

---

## Internal Runbooks

See `docs/internal/runbooks/` for deployment, recovery, and maintenance procedures.