# Provider Registry Phase B reviewer follow-up receipt

- generated_at: 2026-07-30T05:17:00Z
- status: PASS

## Review findings addressed

1. Production migration assets: embedded the Phase B SQL migration in `migrations.ts` and added a compiled-dist smoke proving migrations run when the disk migration directory is absent.
2. Provider configuration secret boundary: recursively reject secret keys and secret-like values in `providerConfig` on create/update; expanded key detection for OAuth/common credential names (`clientSecret`, access/refresh tokens, credential/private key suffixes).
3. Reference hints and safe DTOs: only expose env-style references for `env_ref` and dotted settings paths for `legacy_setting_ref`; dotted unknown tokens/JWT-like values are masked; secret-like substrings are rejected in DTO assertions.
4. Base URL boundary: reject non-http(s) URLs, URL userinfo credentials, credential-like query parameters, and secret-like path fragments before persistence.
5. Health details/messages: recursively sanitize arrays/nested objects and redact bearer/API-key/token/password/secret/client-secret labels and secret-like values before persistence.
6. Capability integrity: defaults and consumer bindings now require the selected model to explicitly support the requested capability, and capability removal is blocked while defaults/bindings depend on it.
7. Update/upsert invariants: profile updates reject empty display labels; global bindings reject non-empty supplied `scopeId`; model upsert preserves existing label/enabled state when optional fields are omitted.

## Proof

- `npm --prefix packages/server run test -- src/provider-registry`: 6 files / 44 tests PASS.
- `npm --prefix packages/server run build`: PASS.
- compiled-dist migration smoke with missing migration directory: applied `001-inference-provider-registry.sql`, missing tables `[]`, table count `8`.
- `npm run ctrl:gate`: PASS — build + workspace unit gates; server tests 106 files / 780 tests PASS.
