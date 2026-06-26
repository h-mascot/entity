# ADR: ClickClack Readiness Contract

Status: Accepted
Date: 2026-06-24
Issue: THE-76

## Context

Entity owns task/work-object context, proof, docs/files, review state, and local chat history. ClickClack owns chat primitives and sidecar-backed collaboration transport. The ClickClack integration is optional in local and production-like environments, so Entity must report collaboration readiness honestly without blocking core Entity work flows.

## Readiness States

- `live`: ClickClack is configured, the bridge is enabled, and sends can route through the ClickClack compatibility bridge.
- `staged`: ClickClack configuration or base URL exists, but the Entity bridge is not enabled. Entity can show the planned integration without claiming live delivery.
- `degraded`: ClickClack is configured and intended for use, but a known partial condition exists, such as the sidecar being intentionally disabled in the current environment.
- `unavailable`: ClickClack is configured and the bridge is enabled, but the bridge or sidecar cannot complete a send/readiness check.
- `not_configured`: No ClickClack bridge configuration is present. Entity chat and work-object state remain local.

## Ownership Boundary

Entity may:

- Report the readiness state and reason.
- Persist local chat messages before attempting ClickClack delivery.
- Return degraded send responses that preserve Entity-owned message history.
- Link work-object context to chat channels/threads when available.

ClickClack owns:

- Chat transport primitives.
- Sidecar workspace/channel/bot identities.
- Message delivery through its bridge/proxy.
- Chat-specific runtime behavior outside Entity work-state invariants.

Entity must not make task/docs/proof/review state depend on ClickClack readiness. When ClickClack is unavailable or not configured, Entity should keep local work state usable and surface the collaboration state as degraded or unavailable rather than silently coercing it to live.

## Test Expectations

- Readiness tests cover live, staged, degraded, unavailable, and not configured.
- Send-path tests prove local Entity messages persist when ClickClack delivery fails.
- Setup/channel/history endpoints continue to work without a configured ClickClack bridge.
