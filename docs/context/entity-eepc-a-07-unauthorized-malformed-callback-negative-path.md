# EEPC-A-07 — Unauthorized/malformed callback negative path

**Linear:** THE-895  
**Build-plan task:** EEPC-A-07  
**Parent:** THE-831 (Entity Execution-Engine Plugin Contract — Phase A)  
**Decision:** IMPLEMENTED (authRequired enforcement + public-safe negative paths)  
**Dependencies:** EEPC-A-03 / THE-891 Done

## What this delivers

Hardened negative path for execution-engine callback intake:

1. **Unauthorized** — `authRequired` callbacks (and emits-only ActivityEvent callbacks) require `Authorization: Bearer <token>` or `X-Entity-Callback-Token`
2. **Fail-closed misconfig** — authRequired without a configured secret → HTTP 503 `auth_misconfigured` (never silently accepts)
3. **Malformed** — non-object payloads, missing provider/jobId, invalid events, unsupported status/proof/progress shapes → HTTP 400
4. **Public-safe errors** — responses scrub secret-like values and private filesystem paths
5. **No side effects** — rejected callbacks never append ActivityEvents or create proof records

| Surface | Path |
| --- | --- |
| Auth | `packages/server/src/swarm/callback-intake/auth.ts` |
| Public-safe scrubbing | `packages/server/src/swarm/callback-intake/public-safe.ts` |
| Validate | `packages/server/src/swarm/callback-intake/validate.ts` |
| Routes | `packages/server/src/swarm/callback-intake/routes.ts` |
| Swarm wiring | `packages/server/src/swarm/routes.ts` (`ENTITY_EEPC_CALLBACK_TOKEN` / secret env bindings) |
| Security proofs | `packages/server/src/swarm/callback-intake/callback-negative.test.ts` |

## Auth resolution order

1. `ENTITY_EEPC_CALLBACK_TOKEN`
2. First manifest `config.bindings[]` entry with `secret: true` and `source: env`
3. `ENTITY_EEPC_CALLBACK_TOKEN_<PROVIDER>`

Credentials are header-only. Secret-bearing JSON body keys remain rejected by EEPC-A-03 shape validation.

## Negative codes (stable)

| Code | HTTP | Meaning |
| --- | --- | --- |
| `unauthorized` | 401 | Missing/invalid callback credential |
| `auth_misconfigured` | 503 | authRequired but no secret configured |
| `malformed_payload` / `missing_provider` / `missing_job_id` / `invalid_event` | 400 | Shape/identity failures |
| `invalid_status` / `invalid_test_result` / `invalid_percent` / `malformed_data` | 400 | Unsupported event shapes |
| `private_path_forbidden` / `secret_key_forbidden` / `secret_value_leak` | 400 | Public-unsafe payload content |
| `unknown_provider` / `unknown_job` | 404 | Unknown identifiers (messages stay generic) |
| `job_provider_mismatch` | 409 | Job/provider binding conflict |
| `event_not_allowed` | 400 | Manifest does not allow event |

## Non-goals honored

- No Doc Hub rebuild / Provider Registry duplicate / Skill Workshop
- No production mutation / OAuth / secret exposure in responses
- Reuses EEPC-A-03 intake; no new product surfaces
