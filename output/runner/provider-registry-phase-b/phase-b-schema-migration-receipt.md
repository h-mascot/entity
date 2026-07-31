# Phase B Schema Migration Receipt — PR-B-03 / THE-747

**Source SHA (SuperSpec):** `4eaafc6815db1d731b0683ae4bf54096e64cc30e91a2b89d984fccc520ebd733`
**Worktree HEAD:** `2ad32ee47889ad69bb37efba4712dac7d8a084ea` (uncommitted Phase B implementation present)
**Generated at:** 2026-07-30T03:31:08Z
**Node:** v22.22.1
**npm:** 10.9.4

## Decision (from Phase A)

- Additive, idempotent SQLite migrations with ledger `inference_provider_migrations(filename)` mirroring `plugin_migrations` (OQ-002).
- No Flyway / no `user_version` reliance.
- Normal rollback retains tables (SuperSpec §11.10).

## Health table decision

- **Separate** inference table `inference_provider_health_checks`.
- Explicitly **do not** reuse/dual-write swarm lineage `provider_health_samples` / `provider_recovery_receipts`.

## Files

- `packages/server/src/provider-registry/migrations/001-inference-provider-registry.sql`
- `packages/server/src/provider-registry/migrations.ts`
- `packages/server/src/provider-registry/migrations.test.ts`
- Wired at boot in `packages/server/src/index.ts` via `runInferenceProviderMigrations`.

## Tables created

- `inference_provider_migrations`
- `inference_provider_profiles`
- `inference_provider_models`
- `inference_provider_model_capabilities`
- `inference_provider_profile_defaults`
- `inference_provider_bindings`
- `inference_provider_health_checks`
- `inference_provider_audit_events`

## Commands

```bash
export PATH=/Users/enterprise/.hermes/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH
cd packages/server && npx vitest run src/provider-registry/migrations.test.ts
```

## Result

**PASS** — migration applies once; rerun is no-op; `app_settings` unchanged; FK enforcement verified.
