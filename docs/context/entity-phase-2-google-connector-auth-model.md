# Entity Phase 2 Google Connector Auth Model

## Scope

THE-81 defines the Google Docs/Drive V1 authorization and readiness model only. V1 connector capability is limited to read/index/link/preview so Entity can reference externally owned Google content without becoming a Google Docs/Drive mutation surface.

## Model

External Google refs carry separate connector and Entity-side policy fields:

- `auth_state`: `authorized`, `unauthorized`, `expired`, `insufficient_scope`, `revoked`, or `unknown`.
- `readiness_state`: `ready`, `degraded`, `unavailable`, `not_configured`, or `unknown`.
- `granted_scopes` and `missing_scopes`: constrained to `read`, `index`, `link`, and `preview`.
- `auth_expires_at`: token expiry when known.
- `external_ref_state`: `available`, `permission_revoked`, `deleted`, or `unknown`.
- `external_permission_summary`: connector-side permission status where safe to summarize.
- `entity_visibility_policy_json`: Entity-side visibility, evaluated separately before snippets or previews render.

## Security Notes

The allowed V1 scope set is `read/index/link/preview`. Mutation capabilities are forced false for Google refs: `write`, `export`, `sync`, `create`, and `update` are not enabled by the V1 model, even if a caller submits them.

External connector permission does not grant Entity visibility. Entity must still apply its own org/object visibility policy before rendering metadata snippets, previews, search content, or linked context.

Expired, insufficient-scope, revoked, deleted, unavailable, and unknown states are degraded states. They preserve the external reference when Entity policy allows, but they must not refresh snippets/previews or attempt Google Docs/Drive mutation.
