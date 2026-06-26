# ADR: Runtime/Admin Boundary and Provider-Agnostic Agents

Status: Accepted
Date: 2026-06-24
Issue: THE-75

## Context

Entity Phase 2 adds agent identity, runtime binding status, Helm status references, and safe reversible light controls. These features must not move runtime ownership into Entity. Entity is the work, collaboration, context, review, and proof plane. Helm owns runtime/admin configuration and operational authority.

OpenClaw, Hermes, Codex, Claude Code, local processes, remote HTTP workers, and future providers are runtime/provider-backed agents. They are examples of execution substrates, not Entity itself and not the only supported model.

## Decision

Helm owns deep runtime/admin configuration:

- Runtime/provider setup and deployment settings.
- Credential material and provider keys.
- Schedule, cron, loop, and deployment mutation.
- Tool grants and runtime permission mutation.
- Destructive or irreversible runtime operations.
- Deep provider object inventory and runtime object search.

Entity may expose:

- Agent principal identity and lifecycle state.
- Provider-agnostic runtime references such as `provider_type`, `runtime_binding_id`, `helm_managed`, and `binding_state`.
- Helm-backed status summaries: health, readiness, current work, heartbeat, stale/unavailable reasons, and Helm links.
- Safe reversible light-control requests: pause, resume, and request retry, after policy checks and with audit records.
- Search references that point to status or proof records already indexed in Entity.

Entity must not:

- Treat OpenClaw or Hermes as the Entity runtime model.
- Duplicate Helm's deep admin forms or object search.
- Persist provider credentials or provider-specific configuration in Entity UI/search contracts.
- Convert an unavailable Helm integration into a broken Entity work flow.

## Search Boundary

Entity search can surface Helm status references when those references are ordinary indexed Entity records, such as a status note, runtime binding record, or proof artifact. Search results should remain Entity envelopes with `objectType`, `source`, `deepLink`, `permissionState`, provenance, and connector state.

Search must not expose a Helm object browser or deep Helm object query API. A result may link to Helm when a safe `helm_link` or source reference exists, but runtime object exploration and configuration remain in Helm.

## Test Expectations

- Provider fixtures include OpenClaw, Hermes, and a generic provider, and assert all are runtime/provider-backed agents rather than Entity-only special cases.
- Registry/status APIs preserve generic provider fields and degraded/unavailable states.
- Search tests prove Helm status references remain file/status references and do not include deep Helm object payloads or admin mutation affordances.

## Consequences

Users can understand runtime readiness from Entity without confusing Entity for the runtime/admin surface. Helm can evolve providers and operational controls independently. Entity stays provider-agnostic and continues to function when Helm status or control forwarding is unavailable.
