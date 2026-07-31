# Phase B Repository Receipt — PR-B-02/04/05/06 / THE-746,748,749,750

**Source SHA:** `4eaafc6815db1d731b0683ae4bf54096e64cc30e91a2b89d984fccc520ebd733`
**Worktree HEAD:** `2ad32ee47889ad69bb37efba4712dac7d8a084ea`
**Generated at:** 2026-07-30T03:31:08Z

## Implemented repositories

| Repository | Module | Behaviors |
| --- | --- | --- |
| Profiles | `createProfileRepository` | create/get/list/update/setEnabled; rejects raw secrets in `secret_ref` |
| Models + capabilities | `createModelRepository` | upsert, list, setEnabled, setCapabilities |
| Defaults | `createDefaultsRepository` | per-capability default model |
| Bindings | `createBindingRepository` | global-scope upsert/list; consumer keys `task_master` / `doc_intelligence` |
| Health checks | `createHealthCheckRepository` | create/complete/list/latest; sanitizes details |

## Optimistic concurrency (PR-B-06)

- Profiles and bindings bump `version` on update.
- Stale `expectedVersion` → `PROVIDER_VERSION_CONFLICT` (409).

## Commands

```bash
cd packages/server && npx vitest run src/provider-registry/repositories.test.ts
```

## Result

**PASS**
