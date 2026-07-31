# EEPC-B-04 — Execution-engine contract end-to-end proof pack

**Linear:** THE-899  
**Build-plan task:** EEPC-B-04  
**Parent:** THE-832 (Entity Execution-Engine Plugin Contract — Phase B)  
**Decision:** IMPLEMENTED  
**Dependencies:** EEPC-B-02 / THE-897, EEPC-B-03 / THE-898, EEPC-A-07 / THE-895

Grill authority (Q45–Q46, Q55): Swarm/Codex/eforge register through the execution-engine contract; Entity owns task state / proof / callback intake; runners are swappable arms. UI verification evidence is required for execution-engine packs.

## What this delivers

Durable E2E + security receipt tying the Phase A/B contract surfaces:

1. **list_engines_no_secrets** — public execution-engine list/health with redaction
2. **operator_presets_dispatch** — contract presets; stub refuses; selectable builds payload
3. **callback_to_workplane_proof** — authorized callback ActivityEvents → Workplane job proof/status
4. **unauthorized_callback_rejected** — missing/wrong credential → 401, no side effects
5. **malformed_callback_rejected** — bad/secret-bearing payload → 400, public-safe errors
6. **degraded_health_visible** — degraded/unknown health not silently coerced to healthy

| Surface | Path |
| --- | --- |
| App pack contract | `packages/app/src/lib/executionEngineContractE2EProofPack.ts` |
| App pack proofs | `packages/app/src/lib/executionEngineContractE2EProofPack.test.ts` |
| Server E2E + security | `packages/server/src/swarm/execution-engine-contract-e2e.test.ts` |
| Dep security (landed) | `packages/server/src/swarm/callback-intake/{auth,public-safe,callback-negative}.ts` |

## Negative / degraded paths

- Unauthorized / wrong credential → `401 unauthorized`; no ActivityEvent append
- Malformed / secret-bearing body keys → `400`; errors scrubbed
- Stub engines visible but non-selectable; dispatch payload builder throws
- Unhealthy / missing health → `Degraded` / `Health unknown` (never invented healthy)
- Leaky health URLs/paths/Bearer → redacted on public list + presets

## Non-goals honored

- No Doc Hub rebuild / Provider Registry duplicate / Skill Workshop
- No production mutation / secret exposure
- No production promotion / push / merge in this worker pass
