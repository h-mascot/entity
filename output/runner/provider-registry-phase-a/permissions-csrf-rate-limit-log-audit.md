# PR-A-10 — Permissions, CSRF, Rate Limiting, and Logs Audit

**Issue:** THE-742 / PR-A-10  
**Proof type:** Security map (SuperSpec §4.6)  
**Source SHA:** SuperSpec `4eaafc6815db1d731b0683ae4bf54096e64cc30e91a2b89d984fccc520ebd733`  
**Worktree HEAD:** `a87a6fd9527f06654291be174c88f7271ad5db66`

## §4.6 checklist

| Item | Answer |
| --- | --- |
| Admin authorization middleware | Optional Bearer `ENTITY_API_TOKEN` (`middleware/api-auth.ts`). No distinct admin/provider role. Dev mode skips auth when token unset. |
| CSRF protection | **None** on agent/doc-intelligence mutation routes. `cors()` wide open. |
| Request rate limiting | **None** HTTP rate limiter found for settings/trigger. In-process scan concurrency flags only. |
| Outbound URL/SSRF protections | Base URL: `http`/`https` scheme check only (`normalizeBaseUrl`). **No** private-IP/DNS allowlist. |
| Structured log redaction facilities | **Partial / domain-specific:** `fs/security.redactSensitive`, `notification-routing.redactSensitiveText`, phase2 observability sensitive reasons. **No** global request-body redactor for `/api/agent/settings` PATCH (`apiKey` field). |
| Central server-only response serialization | **No** central exclude layer. Task Agent relies on hand-written DTOs (`getTaskAgentSettings` omits `apiKeys`). Must keep that discipline / add serializer in Phase B. |
| Audit-log facilities | `app_settings.updated_by`, `agent_log`, activity events. No provider-profile audit table. |
| Browser endpoints need resolved credentials? | **No** — GET returns flags/sources only. |
| Health-test runner credential resolution | N/A today (no inference health-test API). Future tests must resolve secrets **server-side only**. |
| Provider response bodies/headers logged by default? | **Risk found:** Task Agent failures log raw `Error.message`, and `/api/doc-intelligence/ask` can return provider/SDK error messages directly in its 502 response. SDK errors may include provider response details. Phase C adapters must sanitize provider errors before logs/API responses and emit stable redacted envelopes only. |

## Design-freeze recommendations

1. Explicit admin permission for provider mutation / health test / Run Now / Smoke Test.
2. Rate limits for health tests + triggers.
3. Global PATCH body redaction for `apiKey`.
4. SSRF policy before expanding custom base URL admin UX.

## Acceptance

- [x] §4.6 inventory answered
- [x] No secrets in artifact

## Provider-error sanitization gate (review follow-up)

- `TaskAgent.invokeModel()` currently catches provider failures and logs `Error.message`; this must be treated as potentially provider-supplied and unsafe for raw logs.
- `/api/doc-intelligence/ask` may return the caught provider/SDK message directly in its 502 response; this is not safe for a registry rollout.
- Phase C adapter acceptance must require a redacted provider-error envelope with stable codes, no raw provider response body/header forwarding, and tests for Task Master + Doc Intelligence failure paths.
