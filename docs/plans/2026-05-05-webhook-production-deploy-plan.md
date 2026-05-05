# Task Plan - Webhook Production Deploy

## Task
Restore the webhook-based GitHub to enterprise production deploy path for the public `h-mascot/entity` repo.

## Plan
- [x] Find old webhook receiver/deploy code on enterprise.
  - Verify: old copies located under `/Users/enterprise/Entity/scripts/webhooks` and `/Users/enterprise/Claws/Ada/Code/entity-deploy-webhook.sh`.
- [x] Replace the stale host-side deploy script with a DB-safe webhook receiver that stages the public repo and runs `deploy.sh`.
  - Verify: `node --check scripts/entity-deploy-webhook-server.mjs`.
- [x] Install and start the webhook receiver on enterprise.
  - Verify: `curl http://127.0.0.1:18788/health` on enterprise.
- [x] Wire public GitHub Actions deploy job to the webhook secrets.
  - Verify: `gh secret list --repo h-mascot/entity`.
- [ ] Run local and CI verification.
  - Verify: `npm run ctrl:full`, GitHub Actions deploy run succeeds, production serves the deployed SHA.

## Files Touched
- `.github/workflows/main.yml`
- `scripts/entity-deploy-webhook-server.mjs`
- `docs/plans/2026-05-05-webhook-production-deploy-plan.md`
- `docs/plans/ACTIVE_PLAN.md`

## Resume
Continue from the first unchecked step. Do not overwrite production DB files. The webhook receiver should deploy from a separate staging checkout, not by resetting the production checkout.
