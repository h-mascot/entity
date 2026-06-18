# Multiplayer Identity & Attribution Design

Date: 2026-06-18
Status: Draft for owner review
Scope: Design only. No code changes in this doc.

## 1. Problem & Goals

Entity is meant to be **multiplayer**: multiple humans and multiple agents
working in the same workspace with real authorship, attribution, and presence.
Today it is effectively single-player with a cosmetic login.

What exists now (verified in code):

- **No `users` table.** Identity is implicit, free-text, and inconsistent:
  - `tasks.assignee` defaults to `'Unassigned'`; the UI shows
    `Created by {task?.createdBy ?? 'Unknown'}`
    (`packages/app/src/components/mission-control/TaskDetailPanel.tsx:1952`).
  - `task_comments.author` defaults to `'Human'` (`packages/db/src/index.ts:592`).
  - `activities` attributes via free-text `agent_name`/`agent_emoji`
    (`packages/db/src/index.ts:559`).
  - Editor/document tables key authorship on a free-text `author` /
    `agent_id` string (`human` | `assistant` | agent slugs like `ada`,
    `spock`, `scotty`) — see `document_authorship_ranges`,
    `document_presence`, `document_comments` (`packages/db/src/index.ts:749-848`).
- **Two parallel auth systems, neither tied to a human identity:**
  - Global shared bearer `ENTITY_API_TOKEN`, **skipped entirely when unset**
    (`packages/server/src/middleware/api-auth.ts:150-193`). One token, no actor.
  - Scoped `agent_tokens` table (`token_type` `agent`|`service`, `actor`,
    `scopes_json`) used only by the editor routes
    (`packages/db/src/agent-tokens.ts`, `packages/server/src/editor/auth.ts`).
    Service tokens carry an `X-Entity-Actor` header gated by a `knownActorIds`
    allowlist.
- **Human "login" is fake.** `AuthSession { username, loggedInAt }` lives only
  in `localStorage`; the `entity.auth.login-required.v1` flag and Admin
  "Require login" toggle gate the SPA shell client-side only
  (`packages/app/src/App.tsx:863-911`). The username is a display string —
  never sent to the server, never verified, no password storage.
- **Agents already are real principals** via `entity_agents`
  (`id`, `slug`, `name`, `emoji`, `avatar_url`, `status`) plus module grants
  (`packages/db/src/index.ts:869-883`).

### Goals

1. Give every actor — human or agent — a **stable principal id** that
   attribution columns can reference.
2. Replace "Created by Unknown" with real, durable authorship across tasks,
   comments, activities, and documents.
3. Add real **human accounts + server-verified sessions** without breaking the
   token model agents/services already use.
4. Extend the editor's existing presence/WS to **workspace-wide multi-user
   presence**.
5. **Keep single-player local installs working with zero login** by default.

### Non-goals (this round)

- Org/team/multi-tenant boundaries, RBAC beyond a coarse role.
- Federated SSO directory sync, SCIM, audit-grade compliance logging.
- Rewriting the editor CRDT/authorship engine; we only re-key it.

## 2. Data Model

### 2.1 Principal model — recommended: unified `principals` + typed profiles

Humans and agents should share **one identity space** so a single `created_by`
column can point at either. Agents are already first-class; forcing two
attribution columns (`created_by_user` vs `created_by_agent`) everywhere would
double every join and every UI branch.

```
principals
  id            TEXT PRIMARY KEY        -- e.g. usr_<uuid>, agt_<slug>
  kind          TEXT NOT NULL           -- 'human' | 'agent' | 'service'
  display_name  TEXT NOT NULL
  handle        TEXT UNIQUE             -- stable @mention slug
  avatar_url    TEXT
  status        TEXT NOT NULL DEFAULT 'active'
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
```

`principals` is the **thin shared spine**. Type-specific data stays in profile
tables; we do **not** merge auth secrets into it.

```
users                                   -- human-only profile + auth
  principal_id    TEXT PK REFERENCES principals(id) ON DELETE CASCADE
  email           TEXT UNIQUE
  password_hash   TEXT                  -- argon2id; NULL for SSO-only
  password_algo   TEXT
  role            TEXT NOT NULL DEFAULT 'member'   -- 'owner'|'admin'|'member'
  last_login_at   TEXT

user_sessions                           -- server-verified human sessions
  id              TEXT PRIMARY KEY      -- opaque, random
  principal_id    TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE
  token_hash      TEXT NOT NULL         -- sha256 of session secret
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  expires_at      TEXT NOT NULL
  revoked_at      TEXT
  user_agent      TEXT
  CREATE UNIQUE INDEX idx_user_sessions_token ON user_sessions(token_hash)
```

`entity_agents` and `agent_tokens` stay as-is. We **back-link** them to the
spine rather than migrating their data:

- Add `entity_agents.principal_id TEXT REFERENCES principals(id)` (nullable
  during transition; backfilled `agt_<slug>` for every agent).
- `agent_tokens.actor` already holds the agent/service actor id; it resolves to
  a principal via `entity_agents.slug` / a `service` principal row. No schema
  break needed there.

> Rejected alternative: separate `users` and `agents` tables with no shared
> spine. It keeps each domain clean but forces every attribution column to be a
> polymorphic `(actor_type, actor_id)` pair and every reader to branch. The
> spine costs one extra table and buys single-column FKs everywhere.

### 2.2 Attribution columns

Add nullable `*_by` columns that reference `principals(id)`, keeping the
existing free-text columns during transition (dual-write, then deprecate):

| Table | Add | Replaces / complements |
|---|---|---|
| `tasks` | `created_by`, `updated_by` | the UI's `createdBy` ?? 'Unknown'; `assignee` stays free-text for now, plus optional `assignee_principal_id` |
| `task_comments` | `author_principal_id` | `author` default `'Human'` |
| `activities` | `actor_principal_id` | `agent_name`/`agent_emoji` (now derivable from principal) |
| `task_history` | `changed_by_principal_id` | `changed_by` free-text |
| `document_*` (`authorship_ranges`, `presence`, `comments`, `comment_replies`, `suggestions`, `review_runs`) | `author_principal_id` / `principal_id` | the free-text `author` / `agent_id` (`human`/`assistant`/slug) |

All additions follow the existing `hasColumn(db, table, col)` + `ALTER TABLE`
idiom in `bootstrap` / `ensureTaskSchema` (`packages/db/src/index.ts:929-979`),
so they are additive and non-breaking. No column is dropped in Phase A.

### 2.3 Reserved/system principals

Seed three rows so existing data and the default agent keep resolving:

- `usr_local` — the implicit local single-player human (kind `human`,
  no `users` row, no password). Default `created_by` when login is off.
- `agt_assistant` — links the seeded `assistant` agent
  (`packages/db/src/index.ts:982-993`).
- `svc_system` — for service-token / automated writes (`Task Merge Bot`, etc.).

Legacy free-text values map deterministically: `'Human'`/`'human'` → `usr_local`,
`'assistant'`/known agent slugs → their `agt_*`, everything else →
`usr_local` with original text preserved in a side column for audit.

## 3. AuthN / AuthZ

### Coexistence requirement

Any human auth must **layer onto**, not replace, the two existing token paths:

1. `ENTITY_API_TOKEN` — single shared bearer, the deployment-level gate. Keep
   it as the outermost trust boundary for service-to-service and CI.
2. `agent_tokens` — per-agent/service scoped tokens with `X-Entity-Actor`. Keep
   for agent and programmatic access; already actor-aware.

### Options

**(a) Local username + password accounts.** Add `users.password_hash`
(argon2id) + `user_sessions`. Login endpoint verifies, issues an opaque session
cookie (httpOnly, sha256-hashed at rest). Self-hostable, zero external
dependency, matches the existing self-contained SQLite posture.
- Cost: own the password reset / lockout surface.

**(b) OAuth / SSO (GitHub / Google).** No password storage; trusted email +
avatar out of the box. Provisions a `principals` + `users` row on first login.
- Cost: requires configured client id/secret and a public callback URL — bad
  fit for the air-gapped/localhost default install. Best as an **opt-in
  provider on top of (a)**, not the base.

**(c) Keep bearer for service/agents + add human sessions.** Exactly the layered
model above: tokens unchanged, humans get real sessions.

### Recommendation

**Adopt (c) as the architecture, with (a) as the default human auth and (b) as
an optional pluggable provider.**

- Middleware resolution order per request:
  1. Valid `user_sessions` cookie → human principal.
  2. `agent_tokens` bearer + `X-Entity-Actor` → agent/service principal
     (existing editor path, generalized to all routes).
  3. `ENTITY_API_TOKEN` bearer → `svc_system` principal (back-compat).
  4. None, and login not required → `usr_local` (single-player).
  5. None, and login required → `401`.
- The resolved **principal id is attached to the request** and is what
  attribution columns are written with — no more client-supplied author strings.

### Trust boundaries

- **Client-supplied author/actor strings become untrusted.** Today the SPA can
  claim any `loginUsername`; after this, the server stamps `created_by` from the
  authenticated principal and ignores client-sent author fields.
- `X-Entity-Actor` stays allowlist-gated (it already is, via `knownActorIds`)
  and is only honored for valid `service` tokens.
- Passwords: argon2id, never logged; sessions are opaque + hashed at rest like
  `agent_tokens` already are (sha256).
- `ENTITY_API_TOKEN` remains the deployment gate; when it is unset **and** login
  is not required, the install is explicitly single-player/trusted-LAN (current
  behavior, preserved).

## 4. Presence & Real-time

The editor already has the full machinery: `document_presence`
(`doc_id` + `agent_id` + `status` + `cursor_json`, unique per doc/actor),
a typed WS broadcaster with `document.presence` events
(`packages/server/src/editor/ws.ts`), and client cursor handling keyed on
`actor` (`packages/app/src/App.tsx:2092-2192`). We **generalize, not rebuild**.

1. **Re-key presence on `principal_id`.** Rename/extend `agent_id` →
   `principal_id` (keep `agent_id` as alias during transition). Humans get
   presence rows the same way agents do.
2. **Add a workspace presence channel.** Generalize the editor WS envelope to a
   `presence` event that is not doc-scoped: `workspace`, `board:<id>`,
   `doc:<id>` surfaces. Reuse the existing `EditorWsBroadcaster` fanout pattern;
   add a `surface` field to the envelope.
3. **Per-surface attribution UI.** Each surface renders live participants from
   presence rows joined to `principals` (avatar + display_name + cursor color).
   This is what visibly replaces "Created by Unknown": cards, comments, and doc
   ranges resolve `*_by` → `principals.display_name`/`avatar_url`.
4. **Session lifecycle.** On WS connect, upsert presence (`active`); on
   disconnect/idle timeout, transition `idle`/`offline` (statuses already
   exist in the `CHECK` constraint at `packages/server/src/index.ts:480`).

WS auth reuses `createWsAuthHandler` (`api-auth.ts:205`), extended to also
accept a `user_sessions` cookie so humans authenticate the socket the same way.

## 5. Migration & Back-Compat

Principle: **identity is additive and opt-in; nothing breaks when it's off.**

- **Default = single-player, no login.** With `ENTITY_API_TOKEN` unset and
  "Require login" off, every write is attributed to `usr_local`. The UI shows a
  real name instead of "Unknown", but no login wall appears. This is the current
  default behavior, improved.
- **Additive schema only in Phase A.** New columns are nullable; free-text
  columns are dual-written, never dropped this round. A backfill pass maps legacy
  strings to seeded principals (§2.3).
- **Token paths untouched.** `ENTITY_API_TOKEN` and `agent_tokens` keep working
  byte-for-byte; agents need no changes.
- **Client localStorage session is deprecated gracefully.** The existing
  `AuthSession`/`login-required` flag keeps gating the shell until Phase B server
  sessions land; then the client flag becomes a thin reflection of server state.
- **Reversibility.** Because old columns remain, Phase A is safe to ship and
  roll back without data loss.

## 6. Phased Implementation Plan

Each phase is independently shippable and leaves the app working.

### Phase A — Identity data model + attribution (no auth yet)
- Add `principals`, seed `usr_local` / `agt_assistant` / `svc_system`.
- Add `entity_agents.principal_id`; backfill `agt_<slug>`.
- Add `*_by` / `*_principal_id` columns (§2.2) via `hasColumn`+`ALTER`.
- Server stamps `created_by`/`updated_by` from the resolved principal
  (defaults to `usr_local`); dual-writes legacy author fields.
- UI: resolve `*_by` → `principals` so "Created by Unknown" shows real names.
- Ship value: real attribution everywhere, still single-player.

### Phase B — Human auth & sessions
- Add `users` + `user_sessions`; login/logout/session endpoints; argon2id.
- Middleware resolves principal in the order in §3; attach to request.
- Promote "Require login" from client-only to a **server-enforced** gate
  (reuse `entity.auth.login-required`, but the server is now authoritative).
- Optional: GitHub/Google provider behind config (option (b)).
- Ship value: real multi-human accounts; writes attributed to the logged-in
  human.

### Phase C — Presence & multi-user UI
- Re-key `document_presence` on `principal_id`; add workspace/board presence
  channel over the existing WS broadcaster.
- Live participant avatars per surface; human cursors in the editor alongside
  agents.
- @mention + assignment pickers source from `principals` (humans + agents).
- Ship value: visible multiplayer — who's here, who did what, in real time.

## 7. DECISIONS NEEDED FROM OWNER

1. **One principal space or two?** Recommended: unified `principals` spine with
   typed `users`/`entity_agents` profiles (single-column attribution FKs). The
   alternative is fully separate tables + polymorphic `(type,id)` attribution.
2. **Human auth method.** Recommended: local username+password (option a) as the
   default, GitHub/Google SSO (option b) as an opt-in provider. Approve, or pick
   SSO-first?
3. **Default posture for local installs.** Confirm: no-login single-player stays
   the default, with all writes attributed to a `usr_local` principal. (Blocks
   the back-compat story in §5.)
4. **Roles for v1.** Is a coarse `owner | admin | member` role enough, or do we
   need per-module/per-board permissions in this round? (Affects `users.role` vs
   a full grants table.)
5. **Drop legacy author strings?** Recommended: keep dual-write through Phase B,
   drop free-text author columns only in a later cleanup. Confirm we are not
   dropping any column in Phase A.
