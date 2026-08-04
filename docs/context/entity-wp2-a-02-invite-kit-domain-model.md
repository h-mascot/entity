# THE-877 / WP2-A-02 — Invite-kit domain model and status machine

Status: **IMPLEMENTED** (domain + durable schema foundation; no shipped invite HTTP API)  
Date: 2026-07-31  
Worktree: `/Users/enterprise/Code/entity-the-877-wp2-a-02`  
Parent: THE-829 — Workplanes Slice 2 Phase A  
Dependency: THE-876 / WP2-A-01 Done (`f9bc960`)

## Verdict

Added the smallest durable invite-kit foundation:

1. Pure status machine + compatibility mapping under `packages/server/src/agent/invite-kit/`
2. Durable `agent_invites` + `agent_invite_progress` schema/repository under `packages/db/src/agent-invites.ts`

Existing tokenized onboarding session routes remain unchanged. **No** `/api/agents/invites*` routes were invented.

## Product status enum

`created` → `opened` → `in_progress` → `completed`  
also: `expired`, `revoked` (terminal blockers for tokenized access)

## Compatibility (from THE-876 audit)

| Invite-kit | Legacy onboarding session |
| --- | --- |
| `created` | `created` |
| `opened` | `opened` |
| `in_progress` | `installing` / `configured` (write-back canonical: `installing`) |
| `completed` | `verified` (mapping only; completion requires checklist evidence) |
| `expired` | `expired` |
| `revoked` | *(none — fail-closed; do not coerce)* |

`creation_source`:

- `onboarding_first_run` — may mutate global `onboarding.state`
- `agents_invite` — must **not** mutate global `onboarding.state`

## Transition events

| Event | Allowed from → to |
| --- | --- |
| `open_manifest` | `created→opened` (+ idempotent stay on opened/in_progress/completed) |
| `report_progress` | `created\|opened→in_progress`, `in_progress→in_progress` |
| `complete` | `opened\|in_progress→completed` **only with** all progress steps `done` |
| `expire` | `created\|opened\|in_progress→expired` |
| `revoke` | active + completed/expired → `revoked` |
| `regenerate` | any → `created` with **rotated** `token_hash`, `generation++`, prior hash retained as `previous_token_hash` |

Tokenized endpoint access (`canAccessTokenizedEndpoints`):

- Blocked: `revoked`, `expired`, or past `expiresAt`
- Allowed: `created` / `opened` / `in_progress` / `completed` before expiry

## Persistence

Tables (also ensured in main db `index.ts` schema):

- `agent_invites` — durable invite row with `token_hash` (never raw token), status, TTL, revoke/regenerate lineage fields, selection/permissions JSON
- `agent_invite_progress` — per-step checklist rows keyed by `(invite_id, step_id)`

Repository: `createAgentInviteRepository()` in `@entity/db` / `packages/db/src/agent-invites.ts`.

## Explicit non-goals (later tickets)

- WP2-A-03 — Agents → Add Agent UI
- WP2-A-04 — Invite prompt shape / copy controls
- WP2-A-05 — Revoke/regenerate HTTP + wire tokenized routes to durable invites
- WP2-A-06 — Agent Desk invite progress view
- No `/api/agents/invites*` in this ticket

## Modules

| Path | Role |
| --- | --- |
| `packages/server/src/agent/invite-kit/types.ts` | Status/domain types |
| `packages/server/src/agent/invite-kit/status-machine.ts` | Transitions, expiry/revoke/regenerate, tokenized access |
| `packages/server/src/agent/invite-kit/compatibility.ts` | Legacy session mapping + onboarding.state policy |
| `packages/server/src/agent/invite-kit/token.ts` | Mint + SHA-256 hash helpers |
| `packages/db/src/agent-invites.ts` | Schema + repository |
