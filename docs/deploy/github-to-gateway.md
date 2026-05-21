# Entity GitHub to Gateway Deploy Path

## Decision
Entity production deploys use an on-network pull deployer, not a self-hosted GitHub runner and not a GitHub-hosted runner calling private addresses.

GitHub Actions is the build/test authority. The gateway host is the deploy authority.

## Why
Public GitHub runners cannot reach Tailscale-only addresses such as private `100.x` hosts. The previous webhook deploy attempt put a private gateway URL in GitHub secrets, which made the deploy job fail after CI passed.

A self-hosted runner would fix network reachability, but it would also give GitHub Actions a long-lived worker inside the private network. For Entity, that is a larger trust boundary than needed.

The pull deployer keeps the trust split simple:

1. GitHub builds and tests a commit.
2. The gateway polls GitHub from inside the network.
3. The gateway deploys only an exact commit whose configured workflow completed successfully.
4. The existing DB-safe `deploy.sh` remains the only production mutation path.

## Runtime Flow

```text
push to configured branch
  -> GitHub Actions CI/CD Pipeline builds and tests
  -> gateway launchd job runs scripts/entity-gateway-pull-deploy.mjs
  -> deployer reads latest branch SHA from GitHub
  -> deployer checks Actions run for that exact SHA
  -> deployer exits if CI is missing, pending, or failed
  -> deployer checks out the exact SHA in a staging checkout
  -> npm ci
  -> ./deploy.sh --all
  -> deploy.sh backs up the production DB, builds, rsyncs dist only, restarts launchd, and verifies task count
```

## Current Production Configuration
The live deployment is configured outside the public repository in the gateway env file. That file carries host-specific paths, DB location, and any optional GitHub token.

Current production branch is `cleanup/open-source-readiness` because that is the branch currently deployed on the gateway. The branch is deliberately configurable via `ENTITY_DEPLOY_BRANCH`; switch it to `main` after the cleanup branch is merged or retired.

Required env vars:

```text
ENTITY_DEPLOY_REPO=h-mascot/entity
ENTITY_DEPLOY_BRANCH=<production branch>
ENTITY_DEPLOY_REQUIRED_WORKFLOW=CI/CD Pipeline
ENTITY_DEPLOY_SOURCE_DIR=<staging checkout path>
ENTITY_DEPLOY_STATE_DIR=<state directory>
ENTITY_DEPLOY_LOG=<log path>
ENTITY_DEPLOY_NODE_BIN_DIR=<node/npm bin directory>
ENTITY_PROD_HOST=<ssh target reachable from gateway>
ENTITY_PROD_HTTP_HOST=<live HTTP host>
ENTITY_PROD_DIR=<production runtime path>
ENTITY_PROD_DB=<production sqlite DB path>
ENTITY_PROD_LAUNCHD_SERVICE=<optional launchd service label>
ENTITY_PROD_NODE_ENTRY=<optional server entrypoint>
ENTITY_RUNTIME_WORKSPACE=<optional runtime workspace>
GITHUB_TOKEN=<optional, only needed for private API or rate-limit headroom>
```

## Trust Model

| Risk | Control |
| --- | --- |
| Public runner cannot reach private network | Public runner no longer deploys or calls private URLs |
| GitHub workflow compromise gets network access | No self-hosted runner is installed inside the private network |
| Failed CI deploys | Deployer requires a successful Actions run for the exact SHA |
| Race between deploy checks | Deployer uses a local lock directory |
| Accidental DB overwrite | `deploy.sh` excludes DB files and backs up/checkpoints the configured DB before restart |
| Deploying the wrong branch | Branch is explicit in `ENTITY_DEPLOY_BRANCH` and logged on every run |
| Re-deploying same commit repeatedly | State file records last deployed repo, branch, SHA, run ID, and timestamp |
| Inbound webhook exposure | Not required for the deploy path; existing webhook server is legacy/adjacent and can be removed later |

## Operations
Manual check without deploying:

```bash
ENTITY_DEPLOY_ENV=/path/to/entity-deploy.env node scripts/entity-gateway-pull-deploy.mjs --check-only
```

Manual deploy once:

```bash
ENTITY_DEPLOY_ENV=/path/to/entity-deploy.env node scripts/entity-gateway-pull-deploy.mjs --once
```

Force deploy an exact SHA after CI is green:

```bash
ENTITY_DEPLOY_ENV=/path/to/entity-deploy.env node scripts/entity-gateway-pull-deploy.mjs --force --sha <40-char-sha>
```

Inspect config without printing secrets:

```bash
ENTITY_DEPLOY_ENV=/path/to/entity-deploy.env node scripts/entity-gateway-pull-deploy.mjs --print-config
```

## GitHub Actions Contract
The workflow deploy job is now only a handoff note. It does not call private gateway URLs and does not need deploy webhook secrets. The full workflow conclusion is the deployer's approval signal.

This means a green Actions run is necessary but not sufficient for production mutation: production still requires the on-network deployer to observe that green run and execute `deploy.sh` locally.

## Verification Checklist
- `node --check scripts/entity-gateway-pull-deploy.mjs`
- `npm run build`
- `npm run scan:private-defaults -- --enforce`
- GitHub Actions run succeeds for the configured branch and commit
- `scripts/entity-gateway-pull-deploy.mjs --check-only` reports CI OK or up-to-date
- `scripts/entity-gateway-pull-deploy.mjs --force --sha <sha>` completes through `DEPLOY_COMPLETE`
- `curl /api/tasks` on the live host returns a non-zero task count
