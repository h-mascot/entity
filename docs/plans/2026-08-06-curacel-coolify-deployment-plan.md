# Entity Curacel Coolify Deployment Plan

## Goal
Package current `origin/main` as an immutable container, verify it, land deployment files on `main`, then deploy an isolated Curacel pilot to the Azure Coolify host.

## Boundaries
- Preserve existing Enterprise sandbox and production runtimes.
- Do not copy any existing production SQLite database or customer data.
- Use a fresh Curacel-only SQLite database and workspace volume.
- Do not expose an unauthenticated API.
- Deploy only the authorized Curacel Azure target.

## Steps
- [x] Create clean worktree from current `origin/main`.
  - Verify: `git status --short && git rev-parse HEAD`
- [ ] Define production container contract and automated deployment checks.
  - Verify: focused deployment tests fail before implementation and pass after.
- [ ] Add Dockerfile, ignore rules, runtime config, entrypoint, and Coolify Compose manifest.
  - Verify: `docker compose config` and build succeed.
- [ ] Run canonical gate and container smoke with persistent volume.
  - Verify: `npm run ctrl:gate`, `/api/health`, `/api/version`, restart persistence.
- [ ] Run adversarial deployment/security review and fix blockers.
  - Verify: review returns PASS with zero blockers.
- [ ] Commit, push, merge to `main`, and verify merged gate.
  - Verify: remote main contains deployment commit and canonical gate passes on merged tree.
- [ ] Deploy exact merged SHA to isolated Curacel stack on Azure Coolify host.
  - Verify: public route returns healthy exact SHA; auth gate works; volumes persist; rollback image recorded.

## Files expected
- `Dockerfile`
- `.dockerignore`
- `docker/entrypoint.sh`
- `docker/entity.config.yaml`
- `docker-compose.coolify.yml`
- deployment-focused test/check script
- this plan and `docs/plans/ACTIVE_PLAN.md`

## Resume
Read this plan, inspect branch/worktree status, continue from first unchecked step. Never deploy a dirty or unmerged SHA.
