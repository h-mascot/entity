# CH-A-01 — ClickClack / chat / outbound integration seams inventory

**Linear:** THE-917  
**Build-plan task:** CH-A-01  
**Parent:** THE-836 (Entity Channel Integrations — Phase A: Adapter foundation)  
**Decision:** CHARACTERIZED  
**Dependencies:** WP1-C-07 / THE-875 Done; EEPC-B-04 / THE-899 Done  
**Scope:** Read-only inventory of existing ClickClack sidecar/proxy/bridge, Mission Chat HTTP seams, task Chat Context readiness, and notification outbound delivery seams. No production mutation. No secret values copied into this receipt. No new outbound production integrations.

Source SHA-256 (consolidated packet): `84541727830ef8f4018ad2b9fdf587d653dfbba940b38b279ae3f90ca18ba895`

Related prior inventory: `docs/context/entity-phase-2-integration-boundary-inventory.md` (THE-24). This receipt narrows to the channel-adapter foundation substrate for CH-A-02.

## Sources inspected

| Path | Role |
| --- | --- |
| `packages/server/src/routes/chat.ts` | Mission Chat REST surface + ClickClack readiness + send dual-path |
| `packages/server/src/routes/chat-model-registry.ts` | Cloud/local/per-agent model policy for chat send |
| `packages/server/src/clickclack/bridge.ts` | Compatibility bridge to local ClickClack sidecar |
| `packages/server/src/clickclack/proxy.ts` | Reverse proxy `/api/clickclack/*` and `/clickclack/*` |
| `packages/server/src/clickclack/readiness.ts` | Readiness classifier (`live\|staged\|degraded\|unavailable\|not_configured`) |
| `packages/server/src/notification-routing.ts` | `NotificationDeliveryAdapter` + inbox-first routing library |
| `packages/server/src/routes/notifications.ts` | Inbox list/update only (no send) |
| `packages/server/src/index.ts` | Mount chat, ClickClack proxy, notification routers |
| `docs/specs/clickclack-sidecar-pin.json` | Sidecar pin + namespace |
| `packages/app/src/components/Chat/*` | Mission Chat UI |
| `packages/app/src/lib/chat-store.ts`, `hooks/useChat.ts` | Chat client store |
| `packages/app/src/components/Chat/ChatOfflineProvider.tsx` | Offline/cloud transport |
| `packages/app/src/components/mission-control/TaskChatContextPanel.tsx` | Task↔ClickClack readiness/context |
| `packages/app/src/hooks/useEntityNotifications.ts`, `NotificationHistoryPanel.tsx` | Inbox UI |

## Architecture (current)

```text
Entity UI (Mission Chat)
  → /api/chat/*  (Entity-owned channels/threads/messages/object-refs)
      → POST /api/chat/send
           ├─ ClickClack bridge (when ENTITY_CHAT_CLICKCLACK_BRIDGE=1)
           │     → local sidecar http://127.0.0.1:3091
           └─ else OpenClaw CLI / Hermes CLI / cloud LLM / local fallback

Entity UI (Task Chat Context)
  → GET /api/chat/clickclack/readiness
  → GET /api/chat/task/:taskId
  → GET /api/chat/channels/:id/object-refs
  (read-only; no compose)

ClickClack SPA/API proxy (always registered)
  → /clickclack/*     → sidecar SPA
  → /api/clickclack/* → sidecar API
  (Entity auth stripped before upstream; 502 on upstream fail)

Notifications
  → GET/PATCH /api/notifications  (inbox read/update)
  → createNotificationRoutingService (library only; NOT mounted at boot)
      → entity_inbox always
      → external channels: clickclack|email|discord|slack|agentpush|webhook|other
         (adapters optional; missing → skipped)
```

Key principle already encoded in product boundaries: Entity owns the work plane; ClickClack owns chat primitives; external channels are delivery routes, not canonical truth. Inbox-first notification creation is designed; production external adapters are not wired.

## Mission Chat API seams (`/api/chat/*`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/chat/me` | Hardcoded human member stub |
| GET | `/api/chat/clickclack/readiness` | Readiness snapshot; 503 + `unavailable` on probe throw |
| GET | `/api/chat/task/:taskId` | Local SQLite lookup for task-linked channel/messages/threads |
| GET | `/api/chat/models` | Model registry (OpenClaw/Hermes/Ollama/cloud policy) |
| GET | `/api/chat/channels` | Categories + channels |
| GET/POST | `/api/chat/channels/:channelId/object-refs` | Org-required ObjectRef links |
| GET/POST | `/api/chat/threads/:threadId/object-refs` | Org-required ObjectRef links |
| GET | `/api/chat/channels/:id/messages`, `/threads` | Timeline reads |
| GET | `/api/chat/threads/:id/messages`, `/messages/:id`, `/threads/by-parent/:id` | Thread/message reads |
| POST | `/api/chat/categories`, `/channels`, `/threads`, `/setup` | Structure CRUD / bootstrap |
| PATCH/DELETE | `/api/chat/channels/:id` | Channel update/delete |
| POST | `/api/chat/channels/:id/read` | Mark read |
| POST | `/api/chat/send` | Dual-path send (bridge or CLI/LLM); bridge fail → **202** degraded with user msg persisted |

### Auth / org

- Global `/api/*` bearer when `ENTITY_API_TOKEN` set; skipped when unset (local/dev).
- `/api/clickclack` is a public prefix for the global middleware and re-auths inside the proxy.
- **Org binding only on object-ref routes** (`requireRequestOrg`). Default object-ref access allows all; deny is injectable for tests.
- Channels/messages/send/setup/models have **no org checks** today.

### External transmit from chat (non-production-channel)

When bridge off (or bridge talks to local sidecar), send can invoke:

1. ClickClack sidecar (local HTTP, default `127.0.0.1:3091`)
2. OpenClaw CLI
3. Hermes CLI (`book` / `hermes`)
4. Cloud LLM HTTP (Anthropic / OpenAI / Z.ai / Gemini) via process env keys
5. Ollama local tags for model inventory

**No Slack / Telegram / Discord / email send** from chat routes.

## ClickClack package seams

| File | Role |
| --- | --- |
| `bridge.ts` | Compatibility chat bridge: Entity workspace/channel bootstrap, bot identities, manifest (`0o600`), `sendCompatibilityMessage` (dev echo spike, not production agents). Pin `d77dd568…`. |
| `proxy.ts` | Reverse proxy with path/JSON rewrite; Entity bearer/cookie auth; does not forward Entity `Authorization`/`Cookie` upstream; optional `X-ClickClack-User`. |
| `readiness.ts` | Pure classifier + env probe. |

### Env / defaults (names only; no values)

| Env | Meaning / default |
| --- | --- |
| `ENTITY_CHAT_CLICKCLACK_BRIDGE` | `1` enables bridge for `/api/chat/send` |
| `ENTITY_CLICKCLACK_SIDECAR` | `0` disables sidecar; readiness `degraded` + `clickclack_sidecar_disabled` when bridge configured |
| `ENTITY_CLICKCLACK_BASE_URL` | default `http://127.0.0.1:3091` |
| `ENTITY_CLICKCLACK_CHECKOUT` | default `/tmp/clickclack` |
| `ENTITY_CLICKCLACK_DATA_DIR` | default `var/clickclack-sidecar` |
| `ENTITY_CLICKCLACK_BRIDGE_MANIFEST` | default `{dataDir}/entity-bridge.json` |
| `ENTITY_CLICKCLACK_DEV_USER` | optional proxy user header |
| `ENTITY_CLICKCLACK_ALLOW_HUMAN_AGENT_FALLBACK` | `1` allows human post if bot create fails (default reject) |
| `ENTITY_API_TOKEN` | proxy + global API auth |

Sidecar pin: `docs/specs/clickclack-sidecar-pin.json` — bind `127.0.0.1:3091`, namespaces `/clickclack/*` and `/api/clickclack/*`.

### Degraded modes

| Mode | Behavior |
| --- | --- |
| Bridge off | Readiness `staged` when configured; send uses CLI/LLM path |
| Sidecar `ENTITY_CLICKCLACK_SIDECAR=0` + bridge on | Readiness `degraded` |
| Bridge send fail | Persist user message; **202** `{ degraded: true, clickclack: { mode, baseUrl, error } }` |
| Proxy upstream fail | **502** `clickclack_proxy_failed` |
| Unconfigured | Readiness `not_configured` |
| Unreachable (`reachable: false`) | Readiness `unavailable` |

Env probe does **not** HTTP-probe live reachability when bridge enabled (`reachable: null` → treated as live unless other flags).

### Secrets posture

- Bot tokens stored in local manifest mode `0o600` — disk-only; not returned in chat API bodies.
- Proxy strips Entity auth before upstream.
- Degraded chat responses may echo error strings + `baseUrl` (no API keys).
- Proxy **502** may include upstream error text (sidecar internals risk; not Entity secrets by design).
- Notification routing redacts sensitive metadata keys/text before store.

## Notification / outbound seams

### What exists

- **`NotificationDeliveryAdapter`** in `notification-routing.ts`: `channel` + `deliver(request) → result`.
- Routing always creates **entity_inbox** delivery first.
- External channel enum: `clickclack | email | discord | slack | agentpush | webhook | other`.
- Defaults: normal → `['clickclack']`; high/critical → `['clickclack','email']`.
- Missing adapter → delivery `skipped` + `adapter not configured`.
- Unavailable/degraded availability recorded without calling adapter.
- Inbox API: `GET /api/notifications`, `PATCH /api/notifications/:id` (inbox_state only).

### What does **not** exist in the running server

- `createNotificationRoutingService` is **not mounted** in `index.ts` (unit-tested only).
- No registered Slack/Discord/email/webhook/Telegram delivery adapters in boot.
- No inbound intake adapter (external IM → task / ActivityEvent).
- No Telegram channel type beyond optional future enum extension.

Related non-channel webhooks (out of CH-A scope but adjacent): OpenClaw review-result ingress; deploy webhook path in node-ops.

## UI seams

### Mission Chat (`packages/app/src/components/Chat/`)

- Surfaces: `ChatView`, `ChatSidebar`, `ChannelView`, `ThreadPanel`, `MessageInput`, `MessageBubble`, `ChatOfflineProvider`.
- Client: `lib/chat-store.ts` + `hooks/useChat.ts` → `/api/chat/*`.
- Offline: cloud probe via `GET /api/chat/channels`; fail → localStorage queue + optional Ollama local replies; reconnect flush every 30s.
- Transport badge: Cloud online / Local fallback.
- **No WebSocket chat subscription** (`useSharedWebSocket` used elsewhere).
- Composer toggles (`mode`, `autoRoute`, `toolsEnabled`, `threadMemory`) are local UI only — not in send payload.
- Attachment `+` is a no-op.
- There is **no** `packages/app/src/components/Chat/clickclack/` package.

### Task Chat Context

- `TaskChatContextPanel.tsx` (hosted by `TaskDetailPanel`): readiness + linked channel summary + ObjectRefs.
- Read-only; cannot open Mission Chat to the linked channel or compose.

### Notifications UI

- `useEntityNotifications` + `NotificationHistoryPanel`: renders opaque `delivery.channel` + status/degraded/failure.
- No configure/retry/bind UI for external channels.
- Admin `OfflineAwareChat` is a separate completions surface (`/api/chat/completions` / cloud URL) — not Mission Chat.

## Wiring (`index.ts`)

```text
app.use("/notifications", createNotificationRouter(...))
app.use("/api/notifications", createNotificationRouter(...))
…
const clickClackBridge = ENTITY_CHAT_CLICKCLACK_BRIDGE === '1'
  ? createClickClackBridge()
  : undefined;
registerClickClackProxyRoutes(app);          // always
registerChatRoutes({ app, openClawBaseUrl, clickClackBridge });
```

No notification routing service registration. Proxy always on even when sidecar disabled.

## Tests that lock seam behavior

| File | Locks |
| --- | --- |
| `routes/chat-clickclack.test.ts` | Readiness states; persist-on-bridge-fail (**202**); successful bridge send metadata |
| `routes/chat-degraded-core-flows.test.ts` | Chat/docs/search usable when ClickClack unavailable |
| `routes/chat-object-refs.test.ts` | ObjectRef org/permission; links readable when readiness unavailable |
| `routes/chat.test.ts` | OpenClaw parse/NO_REPLY/batch; persisted assistant ids |
| `routes/chat-model-registry.test.ts` | Normalize/local; per-agent policy; reject unavailable local |
| `clickclack/proxy.test.ts` | Namespace rewrite; auth/cookie; strip bearer; **502** degraded |
| `clickclack/bridge.test.ts` | Human+agent post; Entity parent/thread ids stay local; bot-create fail-closed |
| `notification-routing.test.ts` | Inbox-first; prefs/availability; skipped missing adapter; redaction |
| `routes/notifications.test.ts` | Inbox list + external delivery summary; PATCH validation |
| `ch-a-01-inventory.test.ts` | Durable inventory contract + readiness states + no-secret channel enum |

## Explicit gaps for CH-A-02 (channel adapter interface)

1. **No shared Channel Adapter interface** spanning chat intake/notify and notification delivery — notification has `NotificationDeliveryAdapter`; chat has ad-hoc bridge/CLI/LLM paths.
2. **`createNotificationRoutingService` unwired** — no production external adapters registered.
3. **ClickClack is dual-homed**: chat bridge (compatibility send) vs notification channel name `clickclack` — not one adapter.
4. **No inbound intake** (Slack/Telegram/email → task/ActivityEvent).
5. **Org scoping incomplete** on chat CRUD/send (object-refs only).
6. **Bridge is echo/dev-sidecar**, not real agent runtime; Entity↔ClickClack message ID map deferred.
7. **Proxy always on**; readiness env probe does not verify live HTTP when bridge enabled.
8. **UI channel model is Mission Channels** — no `externalChannelId`, provider, webhook URL, or delivery policy fields.
9. **No WS realtime for chat** — external ingress would need store/WS merge not present.
10. **Composer routing toggles unused** — cannot express adapter/mode to server.
11. **Notification `delivery.channel` opaque in UI** — display-only.
12. **Secrets contract for adapters**: forbid secret echo (notification redaction is a start); bot tokens stay disk-only; proxy 502 message passthrough needs policy.

## Non-goals honored

- No Doc Hub rebuild; no Provider Registry duplicate tickets.
- No production mutation; no secret exposure; no outbound production integrations created.
- No Skill Workshop in Entity core.
- Isolated worktree only; canonical dirty tree untouched.

## Verification

See proof receipt under `remaining-roadmap-runner/receipts/proof/CH-A-01/`.

Machine-readable twin: `entity-ch-a-01-clickclack-chat-outbound-inventory.json`.
