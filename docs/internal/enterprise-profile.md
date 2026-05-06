# Internal Enterprise Deployment Profile

This document records the historical/private Entity deployment profile for Henry's Enterprise runtime. It is intentionally not a public default and should not be copied into `entity.config.yaml` for external installs.

Use this only on Henry-controlled infrastructure, via one of:

```bash
ENTITY_PROFILE_PATH=/path/to/private-enterprise-profile.yaml ./deploy.sh
```

or explicit environment variables:

```bash
ENTITY_DEPLOY_MODE=ssh \
ENTITY_PROD_HOST=<private-ssh-target> \
ENTITY_PROD_HTTP_HOST=<private-http-host> \
ENTITY_PROD_DIR=<private-remote-dir> \
ENTITY_WORKSPACE_ROOT=<private-workspace-root> \
./deploy.sh
```

Public behavior:

- `deploy.sh` defaults to `deploy.mode: local` and refuses SSH deployment until a target is explicitly configured.
- `scripts/ctrl-deploy-path-check.sh` only performs live deploy checks when an SSH deploy profile/env is present; otherwise it validates shell syntax and skips the live/private gate.
- Fresh installs use `docs/config/entity.config.example.yaml`, which contains localhost-only defaults, one generic Assistant agent, and no private services.

Keep actual private hostnames, IPs, usernames, paths, and service catalogs in uncommitted local files or secret management.
