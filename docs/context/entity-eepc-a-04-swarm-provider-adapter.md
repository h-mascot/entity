# EEPC-A-04 — Swarm provider adapter against contract

**Linear:** THE-892  
**Build-plan task:** EEPC-A-04  
**Parent:** THE-831 (Entity Execution-Engine Plugin Contract — Phase A)  
**Decision:** IMPLEMENTED  
**Dependency:** EEPC-A-03 / THE-891 Done (`2b0286a567a68c7e7fe3e9ee81919e9dd901027e`)

Grill authority (Q45): Swarm/Codex/eforge register through the execution-engine contract; Entity owns task state / proof / callback intake; runners are swappable arms.

## What this delivers

A contract-bound Swarm provider adapter that:

1. Binds each concrete `SwarmProvider` to a validated EEPC-A-02 manifest (`createSwarmContractAdapter`)
2. Registers builtins through `registerBuiltinContractProviders` (manifest-driven bootstrap)
3. Enforces `acceptsDispatch` / lifecycle flags (fail-closed for stubs)
4. Applies `statusMapping.afterDispatch` when providers omit `jobStatus`
5. Projects **public-safe** health (URL/path/secret redaction) without changing legacy `healthCheck()` diagnostics
6. Maps provider status/proof snapshots into EEPC-A-03 callback payload shapes (no secret leak)

| Surface | Path |
| --- | --- |
| Adapter | `packages/server/src/swarm/providers/contract-adapter.ts` |
| Bootstrap | `packages/server/src/swarm/providers/contract-bootstrap.ts` |
| Dispatcher wire | `packages/server/src/swarm/dispatcher.ts` → `registerBuiltinContractProviders` |
| Proofs | `packages/server/src/swarm/providers/contract-adapter.test.ts` |

## Provider / job / status / event mapping

| Concern | Contract source | Adapter behavior |
| --- | --- | --- |
| Identity | `manifest.identity.{id,name,label}` | Refuse bind on name mismatch |
| Dispatch gate | `execution.acceptsDispatch` + `lifecycle.dispatch` | Throw before calling inner |
| After dispatch status | `statusMapping.afterDispatch` | Fill when `DispatchResult.jobStatus` omitted |
| Run state → job status | `statusMapping.runStateToJobStatus` | Used by status callback mapping |
| Public health | `health.publicFields` + URL/path flags | `projectPublicHealth` / `redactPublicHealthMessage` |
| Status → ActivityEvent intake | EEPC-A-03 `status` payload | `toStatusCallbackPayload` |
| Proof → ActivityEvent intake | EEPC-A-03 `proof` payload | `toProofCallbackPayload` (public artifact refs only) |

Legacy `healthCheck()` remains a passthrough for internal diagnostics. Public list/health route enforcement remains EEPC-B-01.

## Negative / degraded paths

- Missing or wrong-kind manifest → bind refused
- Provider/manifest identity mismatch → bind refused
- Stub `acceptsDispatch=false` → dispatch refused (inner never called)
- Malformed dispatch (`runHandle` empty) → throw
- Secret-like status summary → callback map refused
- Private-only proof screenshots (`/tmp`, `file://`) → callback map refused
- Secret-bearing proof artifact keys stripped on `collectProof`

## Non-goals honored

- No Doc Hub rebuild / Provider Registry duplicate / Skill Workshop
- No production provider OAuth/secrets wiring
- No production promotion / push / merge
- Codex/eforge stub-specific follow-ons remain EEPC-A-05 / EEPC-A-06

## Verification

```bash
cd packages/server && npm run build && npx vitest run
cd packages/server && npx vitest run src/swarm/providers/contract-adapter.test.ts
```
