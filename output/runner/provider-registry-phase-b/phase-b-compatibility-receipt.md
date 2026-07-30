# Phase B Compatibility Receipt — PR-B-09 / THE-753

**Source SHA:** `4eaafc6815db1d731b0683ae4bf54096e64cc30e91a2b89d984fccc520ebd733`
**Worktree HEAD:** `2ad32ee47889ad69bb37efba4712dac7d8a084ea`
**Generated at:** 2026-07-30T03:31:08Z

## Claim

Old code paths that only touch `app_settings` / ensure-on-open continue to work when additive registry tables are present. Normal rollback retains registry tables (no DROP).

## Evidence

```bash
cd packages/server && npx vitest run src/provider-registry/compatibility.test.ts
```

**PASS** — covers:

1. Legacy `taskAgent.settings` round-trip after migration (including plaintext legacy key remaining only in `app_settings`).
2. Boot path that never queries registry still succeeds.
3. Simulated code rollback leaves `inference_provider_profiles` intact.

## Boot wiring

`runInferenceProviderMigrations` runs at server startup in `packages/server/src/index.ts` before plugin migrations. Additive-only; safe for older feature flags that ignore registry.
