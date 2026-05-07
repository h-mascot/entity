# Internal Enterprise Profile

This document is an internal operator reference for Henry's private Enterprise
deployment. It is not a public setup guide and must not be used as a product
default.

Public installs should configure their own values through environment variables,
`entity.config.yaml`, Admin settings, or a private profile file.

## Current Private Deployment Facts

- Source repo: `https://github.com/h-mascot/entity`
- Private production DB path: `/Users/enterprise/Code/entityprivate/packages/db/entity-tasks.db`
- Deploys must set `ENTITY_PROD_HOST`, `ENTITY_PROD_HTTP_HOST`,
  `ENTITY_PROD_DIR`, and `ENTITY_PROD_DB` explicitly before running `deploy.sh`.

## Incident Lesson

The May 2026 DB recovery showed that production DB selection must be explicit.
Deploy must never fall back to a sample DB under the checkout, and deploy
verification must confirm the server dist DB symlink resolves to the configured
task-bearing DB before any production rollout is trusted.
