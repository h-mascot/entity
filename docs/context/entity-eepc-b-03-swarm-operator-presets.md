# EEPC-B-03 — Operator presets for Swarm dispatch using contract

**Linear:** THE-898  
**Build-plan task:** EEPC-B-03  
**Parent:** THE-832 (Entity Execution-Engine Plugin Contract — Phase B)  
**Decision:** IMPLEMENTED  
**Dependency:** EEPC-B-01 / THE-896 Done (`743cfc3712d6e7f47385f5f5580589604f07fbae`)

Grill authority (Q45): Swarm/Codex/eforge register through the execution-engine contract; Entity owns task state / proof / callback intake; runners are swappable arms.

## What this delivers

1. Pure preset projection from EEPC-B-01 public execution-engine list items
2. SwarmBoard operator preset picker (replaces hardcoded eforge/symphony select)
3. Create/dispatch payload built from contract (`acceptsDispatch` → `auto_dispatch`)
4. Degraded / refuses-dispatch / health-unknown states visible (not silently healthy)
5. Secret-shaped health messages redacted before operator display
6. Focused preset tests (success + stub refusal + empty/malformed)

| Surface | Path |
| --- | --- |
| Preset logic | `packages/app/src/lib/swarmOperatorPresets.ts` |
| Preset proofs | `packages/app/src/lib/swarmOperatorPresets.test.ts` |
| Operator UI | `packages/app/src/components/SwarmBoard.tsx` |
| Contract health (dep) | `packages/app/src/lib/executionEnginePublicHealth.ts` |
| Public list API (dep) | `GET /api/swarm/execution-engines` |

## Negative / degraded paths

- Stub engines (`acceptsDispatch=false`) → visible as non-selectable / payload builder throws
- Unhealthy selectable engines → `Degraded` status with redacted message; still selectable for queue/pull
- Missing health → `Health unknown` (not invented healthy)
- Empty/malformed engine list → empty presets + visible empty state on SwarmBoard
- Leaky health URLs/paths/Bearer → redacted via EEPC-B-01 helpers

## Non-goals honored

- No Doc Hub rebuild / Provider Registry duplicate / Skill Workshop
- No production mutation / secret exposure
- No production promotion / push / merge in this worker pass
