# EEPC-B-01 — List registered execution engines with health without leaking secrets

**Linear:** THE-896  
**Build-plan task:** EEPC-B-01  
**Parent:** THE-832 (Entity Execution-Engine Plugin Contract — Phase B)  
**Decision:** IMPLEMENTED  
**Dependency:** EEPC-A-04 / THE-892 Done (`3552b422bd443fd6bbc048e8138c5a753b8fe278`)

Grill authority (Q45): Swarm/Codex/eforge register through the execution-engine contract; Entity owns task state / proof / callback intake; runners are swappable arms.

## What this delivers

1. `GET /api/swarm/execution-engines` — registered engines + public health
2. `GET /api/swarm/providers` — back-compat list with public health attached (`providers` + `engines`)
3. `GET /api/swarm/providers/:name/health` — public projection via `projectPublicHealth` (no raw `healthCheck` leak)
4. Plugin Admin UI tab **Execution Engines** renders public health with client-side redaction defense-in-depth
5. API + UI redaction tests prove URLs/paths/Bearer/sk-tokens never appear on public surfaces

| Surface | Path |
| --- | --- |
| Server list/health | `packages/server/src/swarm/execution-engines.ts` |
| Routes | `packages/server/src/swarm/routes.ts` |
| API proofs | `packages/server/src/swarm/execution-engines.test.ts` |
| UI redaction | `packages/app/src/lib/executionEnginePublicHealth.ts` |
| UI proofs | `packages/app/src/lib/executionEnginePublicHealth.test.ts` |
| Operator UI | `packages/app/src/components/plugins/PluginAdminPanel.tsx` + `pluginStore.ts` |

## Negative / degraded paths

- Unknown engine → `{ available: false, message: "Unknown provider: …" }`
- Health probe throws → `{ available: false, message: "Health check unavailable" }`
- Leaky ACP raw health (`http://…`, `/Users/…`, Bearer) → redacted on route
- UI missing health → explicit `Health unknown` (not silently healthy)

## Non-goals honored

- No Doc Hub rebuild / Provider Registry duplicate / Skill Workshop
- No production mutation / secret exposure
- No production promotion / push / merge in this worker pass
