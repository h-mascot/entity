# ClickClack Reuse Assessment For Entity Chat

**Date:** 2026-05-16
**Entity repo:** `/Users/henrymascot/Code/entity-discord-core-chat`
**Entity branch:** `feature/discord-core-chat`
**ClickClack checkout:** `/tmp/clickclack`
**ClickClack commit inspected:** `d77dd568d8ff5c9d3d7c1063b4c317c1e3cd1be2`
**Native WIP patch preserved:** `docs/specs/entity-discord-core-chat-native-wip-before-clickclack-pivot.patch`

## Decision

Use **Path A: ClickClack as a sidecar/service embedded into Entity** as the default next implementation path.

ClickClack is materially better than Entity's previous chat baseline and similar or better than the frozen native WIP for the hardest chat primitives: schema, one-level threads, DMs, reactions, uploads, durable events, HTTP replay, WebSocket recovery, bot identities, bot tokens, SDK, CLI direction, and test coverage.

Do not continue the native TypeScript/React implementation by default. Keep the preserved patch as a reference artifact. Only fall back to native porting if the sidecar spike proves a concrete integration blocker.

## Paths Considered

| Path | Assessment | Decision |
| --- | --- | --- |
| A. Use ClickClack wholesale as a sidecar/service embedded into Entity | Best real reuse. Preserves ClickClack's tested Go/SQLite backend, Svelte SPA, OpenAPI contract, TypeScript SDK, durable event behavior, and bot ergonomics. Can be mounted behind an Entity proxy/feature flag and reversed if needed. | **Choose this first.** |
| B. Copy/adapt ClickClack modules into Entity | Possible for protocol docs, SDK ideas, API names, tests, and small UI patterns. Weak for core backend reuse because ClickClack is Go/sqlc/SQLite and Entity is TypeScript/better-sqlite3. Copying large modules becomes a rewrite. | Use selectively after A, not as default. |
| C. Port ClickClack concepts only | This is effectively the frozen native path. It works technically but rejects Henry's reuse direction unless sidecar integration fails. | Hold as fallback. |
| D. Keep native Entity chat because ClickClack is materially worse | Not supported by evidence. Entity baseline has only categories, channels, messages, threads, unread counts, and agent/model send compatibility. | Reject. |

## Comparison

| Dimension | Entity previous chat baseline | Frozen native WIP | ClickClack evidence | Reuse conclusion |
| --- | --- | --- | --- | --- |
| Data model | `chat_categories`, `chat_channels`, `chat_messages`, `chat_threads`; no workspace/member/DM/event model. | Adds workspace, members, DMs, events, reactions, uploads, pins, mentions, FTS, reads. | `users`, `identities`, `workspaces`, `workspace_members`, `channels`, `direct_conversations`, `messages`, `thread_state`, `reactions`, `events`, `event_recipients`, `uploads`, reads, bot tokens, FTS schema in `apps/api/internal/store/sqlite/sqlc/schema.sql`. | ClickClack is production-shaped and tested; reuse it. |
| Backend/API | Express routes for channels, threads, `/api/chat/send`, `/api/chat/models`; agent reply routing is strong, chat API is narrow. | Adds broad TypeScript API surface. | Go HTTP API covers workspaces, channels, messages, thread replies, reactions, realtime replay/ws, search, uploads, DMs, reads, auth, bot scopes. Routes are visible in `apps/api/internal/httpapi/server.go`. | Sidecar gives richer API now; Entity should adapt `/api/chat/send` into ClickClack rather than rebuild all primitives. |
| Realtime/event recovery | None for chat. | Adds durable log and replay. | Durable `events` plus `event_recipients`; HTTP replay via `/api/realtime/events`; WebSocket first sends backlog via `ListEventsAfter(... after_cursor, 500)` then live events. | ClickClack matches the required architecture. |
| DMs | None. | Adds DMs. | Multi-party workspace DMs with membership checks, private events, direct reads, DM threads. | Reuse. |
| Threads | Basic thread table and drawer; one-level invariant not strongly modeled. | Adds one-level invariant. | Root/reply sequence model with `thread_state`; nested replies rejected; thread APIs and e2e tests. | Reuse. |
| Reactions | None. | Adds reaction idempotency. | `(message_id, user_id, emoji)` uniqueness; add/remove APIs and durable events. | Reuse. |
| Uploads | None. | Metadata-style upload endpoint. | Real multipart uploads, local storage, authenticated file streaming, message attachment hydration. | ClickClack is stronger. |
| Search | None. | Adds FTS. | SQLite FTS5 workspace/channel search with privacy tests. Explicit gap: DM search is not implemented. | Reuse channel search; add DM search extension. |
| Auth/identity | Entity-specific local app identity and agent registry; no chat membership model. | Adds chat members. | Magic link, optional GitHub OAuth, session/Bearer auth, dev user header, bot users/tokens/scopes. | Sidecar needs an Entity identity bridge; not a blocker. |
| Agent/bot ergonomics | Strong Entity-specific model registry and OpenClaw/Hermes/LLM routing. | Preserves routing while adding chat primitives. | First-class bot users, bot tokens, TypeScript SDK, bot example, agent-friendly CLI direction. No Entity model routing/all-agent semantics. | Reuse ClickClack bot layer; keep Entity routing adapter. |
| UI portability | React components already live inside Entity. | React WIP exists. | Svelte SPA has channels, DMs, thread panel, search, uploads, typing, presence, unread behavior. | Start by embedding/proxying the SPA; only rebuild React UI if needed after proof. |
| Integration cost | Low for native incremental work but high time-to-quality for chat primitives. | Already partly implemented, but now frozen. | Requires a sidecar binary, route proxy, identity bridge, data path, and agent routing adapter. | Sidecar cost is concrete and smaller than reimplementing all chat behavior. |

## ClickClack Strengths To Reuse

- Single self-hostable service with embedded web UI and SQLite.
- Data model already has workspace, membership, DMs, threads, reactions, uploads, reads, durable events, private recipients, bot tokens, and FTS.
- HTTP replay means WebSocket is not the sole source of truth.
- OpenAPI and TypeScript SDK give Entity a stable adapter surface.
- Bot identities are first-class users with scoped tokens.
- Tests already cover important permission, realtime, DM, upload, search, routing, and e2e behavior.
- The UI is already much closer to the requested Discord-core workflow than Entity's previous chat UI.

## Gaps And Required Entity Extensions

- ClickClack does not implement pinned messages as a durable message feature. Entity still needs pins.
- ClickClack does not implement mention extraction, mention tables, mention counts, or mention notifications. Entity still needs mentions.
- ClickClack workspace/channel search intentionally excludes DMs; Entity needs a DM-scoped search endpoint.
- ClickClack does not know Entity's selected-agent, all-agents, mentions-to-agent, route/model visibility, OpenClaw, Hermes, or local/cloud model policies.
- ClickClack auth must not expose dev identity headers publicly. Entity needs a trusted server-side identity bridge.
- ClickClack UI is Svelte. Entity's app shell is React/Vite. Initial reuse should embed or proxy the ClickClack web app, then decide whether a React-native shell is worth building with the TypeScript SDK.
- ClickClack has its own SQLite database. Entity must define data directory, backup, migration, and export/import policy before production use.

## Recommended Integration Plan

1. Vendor or pin ClickClack at commit `d77dd568d8ff5c9d3d7c1063b4c317c1e3cd1be2` outside the Entity source-of-truth checkout until the sidecar spike is accepted.
2. Add an Entity-managed sidecar launcher for local development and test, binding ClickClack to a private localhost port such as `127.0.0.1:3091`.
3. Add an Entity server proxy namespace, for example `/clickclack/*` for the SPA and `/api/clickclack/*` for the API. Do not overwrite existing `/api/chat/*` during the spike.
4. Create an identity bridge that maps Entity humans and agents to ClickClack users. In development this can use a trusted proxy header; production must use sessions or bot tokens.
5. Create or sync the default Entity workspace and known agents as ClickClack bot users.
6. Adapt existing `/api/chat/send` compatibility so selected-agent, all-agent, mention-triggered, and thread-reply requests post into ClickClack and route agent replies back as bot-authored ClickClack messages.
7. Extend ClickClack or an Entity-side adapter for pins, mentions, and DM search before declaring full spec parity.
8. Use the preserved native WIP patch as a reference for Entity-specific route/model UI and tests, not as the default implementation.

## Files Inspected

- Entity baseline from `HEAD:packages/db/src/chat.ts`
- Entity baseline from `HEAD:packages/server/src/routes/chat.ts`
- Current Entity WIP diff preserved in `docs/specs/entity-discord-core-chat-native-wip-before-clickclack-pivot.patch`
- `/tmp/clickclack/README.md`
- `/tmp/clickclack/SPEC.md`
- `/tmp/clickclack/docs/data-model.md`
- `/tmp/clickclack/docs/architecture/overview.md`
- `/tmp/clickclack/docs/features/realtime.md`
- `/tmp/clickclack/docs/features/messages.md`
- `/tmp/clickclack/docs/features/threads.md`
- `/tmp/clickclack/docs/features/dms.md`
- `/tmp/clickclack/docs/features/reactions.md`
- `/tmp/clickclack/docs/features/uploads.md`
- `/tmp/clickclack/docs/features/search.md`
- `/tmp/clickclack/docs/features/bots.md`
- `/tmp/clickclack/docs/agent-friendly-cli.md`
- `/tmp/clickclack/apps/api/internal/store/sqlite/sqlc/schema.sql`
- `/tmp/clickclack/apps/api/internal/httpapi/server.go`
- `/tmp/clickclack/apps/api/internal/httpapi/features.go`
- `/tmp/clickclack/apps/api/internal/httpapi/mutations.go`
- `/tmp/clickclack/apps/api/internal/httpapi/auth.go`
- `/tmp/clickclack/apps/api/internal/httpapi/bot_scope.go`
- `/tmp/clickclack/apps/api/internal/store/sqlite/events.go`
- `/tmp/clickclack/apps/api/internal/store/sqlite/dms.go`
- `/tmp/clickclack/apps/api/internal/store/sqlite/search.go`
- `/tmp/clickclack/apps/api/internal/realtime/hub.go`
- `/tmp/clickclack/packages/sdk-ts/src/index.ts`
- `/tmp/clickclack/apps/web/src/ChatApp.svelte`
- `/tmp/clickclack/apps/web/src/components/messages/MessageRow.svelte`
- ClickClack HTTP/store/e2e tests under `/tmp/clickclack/apps/api/internal/**` and `/tmp/clickclack/tests/e2e/**`

## Stop Point

This assessment deliberately stops before implementation. The next implementation step is a narrow sidecar spike, not additional native chat development.
