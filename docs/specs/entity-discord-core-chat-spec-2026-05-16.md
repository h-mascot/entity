# Entity Discord-Core Chat Spec

**Date:** 2026-05-16
**Target branch:** `feature/discord-core-chat` in `/Users/henrymascot/Code/entity-discord-core-chat`
**Protected checkout:** `/Users/henrymascot/Code/entity` must not be modified.
**Current decision:** ClickClack-first reuse. Use ClickClack as a sidecar/service embedded into Entity unless a narrow spike proves a concrete blocker.
**ClickClack assessment:** `docs/specs/clickclack-reuse-assessment-2026-05-16.md`
**Frozen native WIP patch:** `docs/specs/entity-discord-core-chat-native-wip-before-clickclack-pivot.patch`

## 2026-05-16 Pivot

Henry changed direction: stop building native Entity chat by default and evaluate ClickClack-first reuse.

The previous native TypeScript/React implementation work is preserved as a patch/reference artifact, but it is not the active implementation path. Do not resume it unless the ClickClack sidecar path fails on concrete integration evidence or Henry explicitly asks for the native path.

## Executive Decision

Entity should use **ClickClack as the chat core** and embed it into Entity as a sidecar/service.

This does not mean replacing Entity as a product. Entity remains the workspace shell for tasks, files, docs, activity, services, plugins, review state, and agent/model routing. ClickClack should own the chat primitives it already implements well: chat database, channel/DM messages, one-level threads, reactions, uploads, search, durable event replay, WebSocket recovery, bot users, bot tokens, SDK, and chat UI.

Recommended path:

1. Preserve the current native WIP patch and stop extending it by default.
2. Pin ClickClack at an inspected commit and run it as a local sidecar behind Entity.
3. Proxy the ClickClack SPA/API through Entity under a non-conflicting namespace.
4. Bridge Entity identity and agents into ClickClack users/bots.
5. Keep `/api/chat/send` compatibility and Entity model-routing semantics in an Entity adapter that writes to ClickClack.
6. Extend ClickClack or the adapter for missing pins, mentions, and DM search before claiming full parity.

## Why ClickClack First

ClickClack is not just a reference design; it is already a working self-hostable chat system for humans and agents with the same core shape Entity needs.

ClickClack provides:

- workspace and membership model
- channels and multi-party DMs
- one-level threads
- message sequence and pagination behavior
- soft-delete semantics
- reactions
- uploads and message attachments
- read tracking
- durable event log
- private event recipients
- HTTP event replay
- WebSocket live delivery with cursor recovery
- SQLite FTS5 search for workspace/channel messages
- magic-link/session auth and bot tokens
- first-class bot users
- TypeScript SDK and agent-friendly CLI direction
- Svelte web UI with channels, DMs, search, uploads, threads, unread state, and realtime behavior

Entity's previous chat baseline has valuable Entity-specific agent/model routing, but the chat system itself is much thinner: categories, channels, messages, basic threads, unread counts, and `/api/chat/send`.

## Product Target

Build Discord-like core chat for humans and agents only.

In scope:

- channels
- DMs and group DMs
- message timeline
- one-level thread drawer
- reactions
- edit/delete soft delete
- pins
- uploads/attachments
- read tracking
- unread and mention badges
- search and jump to message
- durable event replay
- WebSocket or Entity event integration as live transport only
- agent/bot membership
- Entity selected-agent, all-agent, mention-triggered, and thread-reply routing
- `/api/chat/send` compatibility for existing callers

Out of scope:

- voice
- video
- calls
- screen share
- gaming/activity rich presence
- Nitro-like features
- livestreaming
- federation
- E2EE
- full Discord API compatibility
- multi-node websocket fanout
- enterprise compliance suite

## Integration Architecture

### Sidecar Boundary

ClickClack should run as a private local service managed by Entity in development and deployment.

Initial shape:

- ClickClack binds to a private localhost port such as `127.0.0.1:3091`.
- Entity exposes a proxy namespace such as `/clickclack/*` for the SPA.
- Entity exposes a proxy namespace such as `/api/clickclack/*` for ClickClack API calls.
- Existing `/api/chat/*` remains in place during transition.
- The sidecar data directory is Entity-managed and must not reuse or overwrite Entity's production SQLite DB.

### Identity Bridge

Entity must map its current actors into ClickClack:

- humans become ClickClack users
- Entity agents become ClickClack bot users
- service actors use scoped bot tokens
- default Entity workspace maps to a ClickClack workspace
- Entity agent slugs map to stable ClickClack user IDs or metadata

Development may use a trusted local proxy identity header. Production must use sessions or bot tokens and must not expose a dev override header to clients.

### Agent Routing Adapter

Entity keeps responsibility for model and agent routing.

The adapter must preserve:

- selected agent routing
- all-agent fanout
- mention-triggered agent routing
- thread-reply routing
- route/model visibility in the UI
- OpenClaw, Hermes, direct LLM, local/cloud inventory, and fallback behavior

Adapter behavior:

1. Receive old `/api/chat/send` requests.
2. Resolve Entity route/model semantics.
3. Create the human message in ClickClack.
4. Run selected agent/model logic in Entity.
5. Post agent replies back to ClickClack as bot-authored messages.
6. Return a compatibility response to the old caller.

### UI Strategy

Start with ClickClack's web UI embedded or proxied into Entity. This is the fastest way to prove reuse and avoids rewriting an already complete chat UI.

After sidecar proof:

- Keep the proxied ClickClack UI if it feels native enough inside Entity.
- Or build a React shell against ClickClack's TypeScript SDK only if the Svelte UI blocks core Entity workflows.

Do not rewrite the UI in React before the sidecar proof.

## Required ClickClack Extensions

ClickClack is the preferred base, but Entity still needs these gaps closed:

- Durable pinned messages and pin/unpin API.
- Mention extraction and mention counts.
- Mention notification events and private mention badges.
- DM-scoped search endpoint.
- Entity route/model metadata visibility.
- Entity-specific agent routing adapter.
- Migration/import path for existing Entity chat data if preserving old local chat history is required.

## Compatibility Requirements

The transition must preserve:

- existing `/api/chat/send` callers
- existing channel/thread callers until the UI is migrated
- current ChatModelRegistry behavior
- agent model-selection behavior
- offline/local fallback behavior where practical
- existing Entity database safety rules

Native WIP may be used as a reference for these compatibility mappers, but not as the default chat-core implementation.

## Validation Expectations For The Next Implementation Phase

The next implementation phase is a narrow sidecar spike.

Minimum proof:

- ClickClack is pinned or vendored reproducibly.
- Entity starts or connects to ClickClack on a private local port.
- Entity proxies the ClickClack UI/API.
- Browser can load chat through Entity.
- A human can send a channel message in the proxied UI.
- `/api/chat/send` can post into ClickClack without breaking compatibility.
- At least one Entity agent reply is posted back as a ClickClack bot-authored message.
- Browser screenshots exist for desktop and mobile chat.
- `npm --prefix packages/app run build` passes if frontend code changes.
- `cd packages/server && npm run build && npx vitest run` passes if server code changes.
- `npm run ctrl:full` runs if the environment permits; otherwise record the exact blocker.

## Stop Rule

Until the ClickClack sidecar pivot is accepted and implemented as a narrow spike, do not continue broad native chat implementation. The current native diff is a preserved reference only.
