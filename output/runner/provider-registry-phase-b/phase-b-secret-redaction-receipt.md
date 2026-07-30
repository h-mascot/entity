# Phase B Secret Redaction Receipt — PR-B-01/07/08

**Source SHA:** `4eaafc6815db1d731b0683ae4bf54096e64cc30e91a2b89d984fccc520ebd733`
**Worktree HEAD:** `2ad32ee47889ad69bb37efba4712dac7d8a084ea`
**Generated at:** 2026-07-30T03:31:08Z

## Guarantees implemented

1. Registry schema stores `secret_ref` only (env name or legacy setting path) — never raw API keys.
2. `looksLikeRawSecret` rejects pasted key-shaped values on profile create/update.
3. `serializeProfile` emits safe DTOs with `auth.configured` + `referenceHint` only — **no** `secretRef` / `apiKeys` / raw keys.
4. Health `details_json` and audit `details_json` strip forbidden keys and secret-like strings.
5. `redactUnsafeMessage` strips Bearer/api_key/sk-/AIza/xai- fragments from free-form text.

## Commands

```bash
cd packages/server && npx vitest run src/provider-registry/serialize.test.ts src/provider-registry/audit.test.ts src/provider-registry/types.test.ts
npm run scan:private-defaults --if-present
```

## Results

| Check | Result |
| --- | --- |
| Serializer / audit / type redaction tests | **PASS** (32 provider-registry tests overall) |
| `scan:private-defaults` | Ran — findings=206 warnings (baseline scan; errors=0). No new raw keys introduced in registry DTOs. |

## Sentinel note

Compatibility tests keep a legacy `apiKeys` sentinel **only** inside `app_settings` (legacy store) and assert registry migration does not copy it into registry tables/DTOs.
