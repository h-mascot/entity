# EEPC-A-02 — Execution-engine plugin manifest schema

**Linear:** THE-890  
**Build-plan task:** EEPC-A-02  
**Parent:** THE-831 (Entity Execution-Engine Plugin Contract — Phase A)  
**Decision:** IMPLEMENTED (schema + validation + fixtures; no production registration wiring)  
**Dependency:** EEPC-A-01 / THE-889 Done (`c0ab3bfa36550a98c100d5814525ab57df6c329b`)

Grill authority (Q44–Q45): Swarm/Codex/eforge register through an execution-engine contract; Entity owns task state / proof / callback intake; runners are swappable arms. Q46 ActivityEvent kinds appear only as placeholders.

## What this delivers

A durable **execution-engine plugin manifest** schema grounded in the EEPC-A-01 Swarm provider inventory:

| Area | Manifest surface |
| --- | --- |
| Identity / version | `identity.{id,name,label,version,category}` + `schemaVersion` / `kind` |
| Execution mode | `execution.mode` ∈ `push\|pull\|hybrid\|stub` + `acceptsDispatch` / poll vs claim flags |
| Lifecycle capabilities | `lifecycle.*` booleans for dispatch/status/cancel/collectProof + callback caps |
| Callback / event mapping | `callbacks.intake[]` path templates + auth/idempotency + ActivityEvent kind placeholder |
| Status mapping | `statusMapping.afterDispatch` + `runStateToJobStatus` |
| Health public-safety | `health.publicFields` / `privateFields` + URL/path public-message flags |
| Config secret classification | `config.bindings[]` with `secret` boolean (names only, never values) |
| Dangerous actions | `dangerousActions[]` with `requiresExplicitAllow: true` (eforge daemon control) |

Pure validate API: `validateExecutionEngineManifest` / `parseExecutionEngineManifest` in  
`packages/server/src/swarm/manifest/`. **No** change to `ensureProvidersRegistered`, routes, or live dispatch.

## Schema review findings

1. **Grounded in inventory, not invented providers.** Valid fixtures exist for `acp`, `symphony`, `eforge`, `codex`, `ccp`, `flywheel` matching EEPC-A-01 bootstrap order and modes.
2. **Stub discipline.** `mode=stub` requires `acceptsDispatch=false` and `lifecycle.dispatch=false` — closes the inventory gap where dispatcher ignored `acceptsDispatch`.
3. **Pull/hybrid claim contract.** `expectsClaimCallbacks=true` requires `lifecycle.claimCallback` and a `claim` intake mapping — formalizes today’s ad hoc tracker routes without implementing EEPC-A-03 ActivityEvent intake yet.
4. **Secret classification.** Keys matching `API_KEY|TOKEN|SECRET|PASSWORD|…` must set `secret=true`. Manifest JSON must not embed secret-like values (bearer/long opaque tokens).
5. **Health redaction posture for EEPC-B-01.** New manifests default `allowUrlsInPublicMessage=false` and `allowPathsInPublicMessage=false`; URLs/paths belong in `privateFields` (current runtime health messages may still leak — wiring deferred).
6. **Dangerous actions are explicit.** eforge `POST /api/swarm/providers/eforge/control` is declared with `shells=true` and `requiresExplicitAllow=true`; health must not imply shell control.
7. **Non-goals preserved.** No Provider Registry (inference) duplicate; no Skill Workshop; no production mutation; no Doc Hub rebuild; no secret values in fixtures/docs.

## Fixtures

Under `packages/server/src/swarm/manifest/fixtures/`:

**Valid**

- `valid-acp.json` — push, Entity polls
- `valid-symphony.json` — pull + full tracker callback map + secret key class
- `valid-eforge.json` — hybrid + dangerous daemon control
- `valid-codex.json` — push build-system
- `valid-ccp-stub.json` / `valid-flywheel-stub.json` — stubs

**Invalid (negative proofs)**

- `invalid-missing-identity-version.json`
- `invalid-stub-accepts-dispatch.json`
- `invalid-secret-unclassified.json`
- `invalid-pull-missing-claim.json`
- `invalid-dangerous-undeclared-allow.json`
- `invalid-secret-value-leak.json`
- `invalid-health-public-secret-field.json`

## Source layout

| Path | Role |
| --- | --- |
| `packages/server/src/swarm/manifest/types.ts` | Types + constants |
| `packages/server/src/swarm/manifest/schema.ts` | Zod shape + semantic validate |
| `packages/server/src/swarm/manifest/index.ts` | Public export surface |
| `packages/server/src/swarm/manifest/fixtures/*.json` | Valid/invalid fixtures |
| `packages/server/src/swarm/manifest/schema.test.ts` | Colocated proof tests |
| `docs/context/entity-eepc-a-02-execution-engine-plugin-manifest-schema.json` | Machine-readable twin |

## Deferred (explicit)

- Manifest-driven `ensureProvidersRegistered` (EEPC-A-04+)
- Callback → ActivityEvent spine implementation (EEPC-A-03)
- Public list/health redaction enforcement in routes (EEPC-B-01)
- Auth on tracker routes (EEPC-A-07)
- ARCHITECTURE.md OpenClaw/`ready` status drift cleanup

## Verification

```bash
cd packages/server && npm run build && npx vitest run src/swarm/manifest/schema.test.ts
cd packages/server && npx vitest run
```
