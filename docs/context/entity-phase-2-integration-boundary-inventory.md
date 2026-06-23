# Entity Phase 2 Integration Boundary Inventory

**Linear issue:** `THE-24` / source `THE-6.4`  
**Date:** 2026-06-23  
**Scope:** Read-only inventory of current integration seams, configuration requirements, degraded states, and Phase 2 boundary risks for Helm/runtime status, ClickClack, Google Docs/Drive, and notification/channel delivery.

This document is a Slice 0 input for later Helm boundary, ClickClack, Google Docs/Drive, notification, search, migration, and release-gate tickets. It does not change source schema, run external connector writes, or copy credential values into docs.

## Sources Inspected

- `packages/server/src/index.ts` - top-level route registration, runtime config bootstrap, ClickClack proxy/chat registration, file-source/indexer registration, plugin/swarm route mounting.
- `packages/server/src/clickclack/bridge.ts` - ClickClack compatibility bridge, sidecar workspace/channel/bot bootstrap, manifest behavior, and degraded fallback toggle.
- `packages/server/src/clickclack/proxy.ts` - Entity proxy for ClickClack app/API routes, auth handling, path rewriting, and upstream failure behavior.
- `scripts/clickclack-sidecar-lib.mjs`, `scripts/clickclack-sidecar.mjs`, `scripts/entity-dev.js`, `scripts/entity-doctor.js`, and `docs/specs/clickclack-sidecar-pin.json` - local sidecar checkout, startup, verification, smoke, and dev defaults.
- `packages/db/src/file-sources.ts`, `packages/db/src/file-index.ts`, `packages/server/src/fs/**`, `packages/server/src/routes/docs.ts`, and `packages/app/src/hooks/useFileSources.ts` - current file/source, docs, indexing, sync, health, metrics, and UI source management seams.
- `packages/app/src/components/settings/FileSourcesSettings.tsx`, `packages/app/src/components/SourceFileTree.tsx`, `packages/app/src/components/UnifiedFileDashboard.tsx`, and `packages/app/src/types/filesystem.ts` - source UI, source health display, read-only/write capability behavior, and file search result envelope.
- `packages/app/src/hooks/useNotificationCenter.ts`, `packages/app/src/components/NotificationHistoryPanel.tsx`, `packages/app/src/App.tsx`, `packages/server/src/agent/tools.ts`, and `packages/server/src/agent/events.ts` - current UI notification, toast, activity, and Task Master notification-like paths.
- `packages/server/src/plugins/entity-services/routes.ts`, `packages/server/src/config/onboarding-modules.ts`, `packages/server/src/config/runtime.ts`, `packages/server/src/config/effective.ts`, `packages/app/src/components/settings/AgentRegistrySettings.tsx`, and `packages/server/src/swarm/**` - current service/runtime discovery, admin-only module posture, agent runtime metadata, and provider status/control surfaces.
- `docs/specs/entity-phase-2-prd-canonical-20260620.md` and `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md` - target integration contracts and degraded-state requirements.

Commands and searches used:

```bash
linear_api.py get-issue THE-24
linear_api.py get-issue THE-6
rg "ClickClack|clickclack|sidecar|bridge|proxy" packages scripts docs
rg "Google|Drive|docsify|http-markdown|file_sources|file_index|source.health|degraded" packages
rg "notification|Notification|inbox|webhook|message_sent|notifyAgent" packages
rg "Helm|helm|runtime status|provider|health|safe actions|services" packages scripts docs
```

## Target Phase 2 Boundary

The target Phase 2 posture is explicit:

- Entity owns work-plane semantics: task/work-object context, docs/files/artifacts, proof trails, review, permissions, search, activity, object links, and canonical notifications.
- Helm owns deep runtime/admin authority: runtime/provider config, credentials, schedules, operational controls, health internals, deployment/admin settings, and destructive controls.
- ClickClack owns chat primitives: channels, threads, messages, composer, bridge/proxy behavior.
- Google Docs/Drive V1 is read/index/link/preview only. It is not the canonical low-level proof store and must not mutate external docs by default.
- Entity inbox/activity is the canonical notification record. External channels are delivery routes.

## Current Boundary Summary

| Area | Current implementation | Current degraded state | Phase 2 gap |
|---|---|---|---|
| Helm/runtime status | No dedicated Helm adapter. Agent registry stores `adapter_type`, `runtime_type`, and metadata; service plugin can discover configured/ambient services; swarm provider routes expose provider health/control. | Service health can be `operational`, `degraded`, `offline`, or `unknown`; swarm providers return `available` and messages. | Need a dedicated Helm status contract with runtime binding IDs, source-labeled status, safe light controls only, and no deep admin/config exposure. |
| ClickClack | Sidecar pin, local dev sidecar launcher, proxy routes, and optional chat compatibility bridge exist. Chat send can delegate to ClickClack when enabled. | Bridge failures return a degraded `202` while persisting the Entity chat message; proxy failures return upstream errors. Dev script can restart sidecar until budget is exhausted. | Need first-class readiness state (`live`, `staged`, `degraded`, `unavailable`, `not_configured`) and Entity-owned work-object thread refs with permission checks. |
| Google Docs/Drive | No first-class Google Docs/Drive connector found. Current closest seam is file sources: `docsify`, `http-markdown`, local, and placeholder `github`/`s3`/`custom` adapters. Docs route can read configured sources and local docs roots. | File sources carry `ok`, `degraded`, or `error`; sync runs store status/error/counts; FS metrics track last error. | Need `ExternalDocumentRef` with connector/auth/readiness state, external permission summary, Entity visibility policy, and explicit no-write V1 behavior. |
| Notifications | Frontend has in-memory toast/history panel. Server emits activity rows and WebSocket broadcasts. Task Master `notifyAgent()` writes `message_sent` activity and broadcasts `agent:notify`. | Toasts disappear with session state; activity/message broadcasts are best-effort. No delivery attempt record. | Need durable notification table/API, inbox-first creation, route attempts, delivery failure/degraded states, and object-ref deep links. |

## Helm / Runtime / Service Boundary Inventory

### What exists

There is no concrete Helm adapter or Helm API client in current source. The closest current seams are:

- Agent registry records:
  - `entity_agents.adapter_type`
  - `entity_agents.runtime_type`
  - `entity_agents.metadata_json`
- Runtime config seeding:
  - `applyRuntimeConfigSeeds()` seeds agents and file sources from `entity.config.yaml`.
  - Agent metadata can include file-source bindings, gateway settings, health URLs, and workspace root.
  - `buildConfiguredAgentHealthEndpoints()` derives health URLs from configured agent health URLs or gateway URLs.
- Admin/settings UI:
  - `AgentRegistrySettings` lets users edit agent identity, status, adapter, runtime, avatar, description, metadata JSON, and module scopes.
  - This is an Entity registry surface, not a Helm runtime-admin plane.
- Services plugin:
  - `entity-services` can list internal plugins, configured external HTTP services, and discovered host listeners.
  - Service status values are `operational`, `degraded`, `offline`, and `unknown`.
  - Service integrations are intentionally admin-only in onboarding copy.
- Swarm provider surface:
  - `/api/swarm/providers`, `/api/swarm/providers/:name/health`, and provider-specific status endpoints expose build/provider availability.
  - Providers use a generic `SwarmProvider` interface with `healthCheck`, `dispatch`, `status`, `cancel`, and `collectProof`.

### Config/env requirements

Current runtime/service behavior is driven by config files, database settings, and provider-specific environment variables. The inventory did not copy any credential values. Relevant variable classes include:

- Entity runtime bootstrap: server port, workspace root, public/API/WebSocket base URLs, DB path, and server log path.
- Agent registry seeding: configured agents, file-source bindings, gateway type/URL, and health URLs.
- Service plugin: configured service URLs/health URLs and optional host discovery settings.
- Swarm providers: provider-specific API URLs, queue directories, and web URLs.

### Degraded and unavailable states

- Services can become `degraded`, `offline`, or `unknown` based on health probes and cache freshness.
- Swarm providers report `available: false` with an explanatory message when unconfigured or unreachable.
- Provider-specific status routes may return server errors when a status check fails.
- Onboarding marks service/runtime integrations as admin-only and not first-run safe.

### Boundary risks

- The swarm provider control endpoints include provider-specific control behavior. Later Helm-boundary work should decide whether these remain build-provider implementation details or move behind a Helm-managed status/light-control contract.
- Agent registry runtime fields are display/config metadata, not authoritative runtime bindings.
- The services plugin can discover ambient host listeners. Later search/permission work must ensure service names, links, and probes do not expose sensitive runtime/admin details.
- There is no current `runtime_binding_id`, `helm_managed`, or `binding_state` model.

## ClickClack Inventory

### What exists

Current ClickClack integration is real but local/dev-oriented:

- `docs/specs/clickclack-sidecar-pin.json` pins a sidecar checkout and describes Entity namespace routes.
- `scripts/clickclack-sidecar-lib.mjs` can verify prerequisites, clone/check out the pinned sidecar, start it, check health, and run smoke requests through Entity.
- `scripts/entity-dev.js` starts Entity and supervises the sidecar by default; `ENTITY_CLICKCLACK_SIDECAR=0` disables the sidecar and disables chat bridge routing.
- `registerClickClackProxyRoutes()` exposes proxied ClickClack app/API routes under Entity namespaces.
- `createClickClackBridge()` can:
  - select or create an Entity workspace in the sidecar;
  - select or create an Entity agents channel;
  - create bot identities/auth material in the sidecar for configured agents;
  - persist a bridge manifest under the ignored sidecar data directory;
  - send a user message and agent replies through ClickClack.
- `registerChatRoutes()` uses the bridge only when `ENTITY_CHAT_CLICKCLACK_BRIDGE=1`.

### Config/env requirements

Relevant ClickClack controls include:

- Sidecar enabled/disabled flag.
- Chat bridge enabled/disabled flag.
- Sidecar base URL, checkout path, data directory, bind address, and Entity URL.
- Bridge manifest path.
- Optional human-agent fallback flag for sidecar bot creation failure.
- Optional Entity API credential used by the proxy/smoke path.

No credential values were read or copied.

### Degraded and unavailable states

- If the bridge is configured but sidecar delivery fails, `/api/chat/send` persists the Entity-side user message and returns a degraded response with no agent replies.
- Chat history still shows the persisted local user message after sidecar failure.
- Proxy route failures return `clickclack_proxy_failed` JSON for API routes or a plain proxy failure response for app routes.
- Dev startup supervises the sidecar, retries with backoff, and eventually reports chat degraded when restart budget is exhausted.
- Doctor/smoke scripts can report bridge disabled, sidecar unhealthy, missing checkout, or missing prerequisites.

### Boundary risks

- The compatibility bridge performs sidecar mutations (workspace/channel/bot creation) when enabled. That is acceptable for the local sidecar spike but should be clearly separated from Entity work-object state.
- Current chat messages/channels are chat primitives. Phase 2 needs Entity-owned object links and permission policy around task/doc/proof references.
- Current readiness is inferred from sidecar health and bridge errors, not represented as a stable Entity readiness object.

## Google Docs / Drive and Document Source Inventory

### What exists

No first-class Google Docs/Drive connector or `ExternalDocumentRef` model was found in current code. The current document/source layer provides adjacent seams:

- `file_sources` tracks source identity, type, base URL/path, auth type/ref, enabled flag, icon, JSON capabilities, health, and sync timestamp.
- `file_index` tracks source/path/title/type/agent/origin/tags/preview/hash/index timestamps.
- `file_sync_runs` tracks source sync status, error, scanned count, and indexed count.
- Supported file source types are `local`, `docsify`, `http-markdown`, `github`, `s3`, and `custom`.
- Implemented adapters are local, docsify, and http-markdown. GitHub, S3, and custom are placeholder adapters that validate basic config but throw on operations.
- Docs routes can resolve `/docs/source/<source>/<path>` and `/api/docs/source/<source>/<path>` through enabled file-source adapters.
- File source UI supports add/edit/enable/delete/test and shows source type/location/test feedback.
- Unified file search can use indexed results, then fallback source listing when the index has no matches.

### Config/env requirements

Relevant source/docs controls include:

- File-source records from DB or runtime config.
- Source base paths/base URLs and optional auth references.
- Allowed remote host list for remote source validation.
- Source indexing enablement and interval.
- File audit max size and excludes.
- Docs workspace fallback roots.
- Optional documents collaboration auth material stored client-side for Entity document collaboration APIs.

No connector credential values were read or copied.

### Degraded and unavailable states

- Source test failure sets source health to `error` and returns a non-throwing test response with a message.
- Tree/list failure sets source health to `degraded`.
- File/read or write failure sets source health to `error`.
- FS metrics track per-source last error and timestamp.
- Sync runs record status and error.
- Source disabled produces a permission-style error for file/tree access.
- Read-only adapters reject write/folder mutation paths.
- Source search fallback logs per-source errors and continues across sources where possible.

### Boundary risks

- Current file-source health is source-level, not object-level connector readiness.
- Current previews are stored in `file_index.preview` without Phase 2 object sensitivity or permission-state envelope.
- `auth_ref` exists in storage/API response shape. Later connector work should ensure credential material is reference-only, redacted by default, and never surfaced in search/docs previews.
- Placeholder adapters make Google/Drive-like behavior easy to overstate. The current implementation does not provide Google Docs auth, external permission summaries, Drive item IDs, or read-only connector scope proof.
- Entity-native docs/editor collaboration exists separately from external connector refs. Later work should keep `NativeDocument`, `ExternalDocumentRef`, and `EvidenceArtifact` distinct.

## Notification and Channel Delivery Inventory

### What exists

Current notification-like behavior is split across frontend local UI, activity rows, WebSocket broadcasts, and Task Master helper actions:

- `useNotificationCenter()` stores notification history and visible toasts in React state only.
- `NotificationHistoryPanel` renders the in-memory history with mark-read and clear-all actions.
- App code calls `pushToast()` for offline sync, build update, document presence, document auth, suggestions, review findings, clipboard, and other UI feedback.
- Chat has channel unread counts, but those are chat-specific state, not Entity notification records.
- Task Master `notifyAgent()` writes a `message_sent` activity row and broadcasts an `agent:notify` WebSocket message.
- Task-agent events use `notifyAgent()` for review output missing/invalid/weak and stale nudges.
- Comment responder and task tools broadcast task comment/update/move events over WebSocket.

### Config/env requirements

Current notification behavior has minimal dedicated configuration. It depends on:

- WebSocket connectivity and API auth.
- Frontend session state/local browser availability.
- Task-agent scheduler/event configuration for when notifications are emitted.
- ClickClack bridge settings only when chat compatibility delivery is enabled.

There is no notification route table, external channel route config, recipient preference config, or canonical notification API.

### Degraded and unavailable states

- UI toasts/history are lost on reload and are not shared across clients.
- WebSocket broadcast failures remove failed clients and log a warning.
- Task Master notification attempts are recorded as activity rows, but there is no delivery attempt status.
- Offline sync can show local toasts, but these are UI feedback, not durable Entity notifications.
- Comments endpoint fallback can write to activity, but that is not a canonical notification fallback.

### Boundary risks

- `message_sent` activity currently carries notification-like meaning, but Phase 2 needs a distinct canonical notification record.
- No durable inbox means review requests, human-gate requests, escalations, reassignment notices, receipt failures, and connector degradation notices cannot be audited as notification records.
- External channels are not yet modeled as delivery routes with failure/degraded status.
- Current `agent:notify` broadcasts do not prove receipt by the target principal.

## Cross-Cutting Gap Map

| Phase 2 target | Current state | Gap severity | Recommended input to later tickets |
|---|---|---:|---|
| `HelmRuntimeStatus` adapter | Missing dedicated adapter; service/swarm health are adjacent only | High | Create explicit Helm contract and refuse deep admin/credential fields in Entity responses. |
| Runtime binding fields | Agent registry has adapter/runtime strings and metadata JSON | High | Add `runtime_binding_id`, generic provider type, Helm-managed flag, and binding state. |
| ClickClack readiness object | Sidecar health/proxy/bridge errors only | Medium | Normalize readiness into `live`, `staged`, `degraded`, `unavailable`, `not_configured`. |
| ClickClack object refs | Chat channel/message/thread state exists | Medium | Add Entity-owned refs from task/doc/proof objects to ClickClack thread/channel refs. |
| Google Docs/Drive read-only connector | Not implemented as Google connector | High | Add `ExternalDocumentRef` and connector adapter with no V1 mutation endpoints. |
| External connector permission state | Source health only, no external permission summary | High | Model connector auth/readiness separately from Entity visibility policy. |
| Source/document permission envelope | Source/file routes have path checks but no RBAC object sensitivity | High | Apply Phase 2 permission evaluator before previews/snippets/search results. |
| Canonical notifications | Missing durable notification model | High | Add notification record, inbox API, delivery attempts, route status, and object refs. |
| Degraded channel delivery | Only UI toasts/activity/broadcasts | High | Preserve canonical notification before external route attempts and record failures. |
| Credential redaction | FS audit redacts sensitive payload keys; config effective output redacts credential paths | Medium | Extend no-credential checks to integration status/search/activity/notification payloads. |

## No-Mutation and Credential Handling Notes

- This inventory did not start sidecars, call remote connector APIs, send chat messages, test configured services, or mutate Linear beyond normal issue-body reads.
- No credential literal, auth reference value, or environment credential value is included.
- Where config/env requirements are listed, they are named by variable class or variable name only, without values.
- Any later live integration proof should use sanitized receipts and should not paste connector responses that include credentials, internal hostnames, or private profile defaults.

## Acceptance Mapping

- Current integration code paths and config/env requirements documented: yes.
- Known unavailable/degraded states listed: yes.
- Boundary risks mapped to Phase 2 requirements: yes.
- Integration inventory artifact path: `docs/context/entity-phase-2-integration-boundary-inventory.md`.
- No external mutations performed: yes, inventory only.
- No credential values copied into docs: yes.
