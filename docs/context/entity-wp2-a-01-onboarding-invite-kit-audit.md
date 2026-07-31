# THE-876 / WP2-A-01 — OnboardingFlow + agent-session API audit

Status: **CHARACTERIZED** (audit only; no runtime behavior change required by this ticket)  
Date: 2026-07-31  
Worktree: `/Users/enterprise/Code/entity-the-876-wp2-a-01`  
Parent: THE-829 — Workplanes Slice 2 Phase A (invite kit productization)  
Dependency: THE-875 / WP1-C-07 Done  
Authority spec: `remaining-roadmap-runner/artifacts/agent-onboarding-invite-kit-spec.md`

## Verdict

Entity already has a **first-run onboarding invite/setup kit** that is substantially reusable for Slice 2A productization. It is **not** yet an Agents → Add Agent invite system: storage is ephemeral `app_settings` JSON keyed by raw token, status enum differs from the invite-kit spec, and revoke/regenerate/human invite APIs do not exist.

Do **not** invent `/api/agents/invites*` yet in this ticket — those routes are absent. Next ticket (WP2-A-02) should define the durable domain model + status machine against the real seams below.

## Inspected files

| Path | Role |
| --- | --- |
| `packages/app/src/components/OnboardingFlow.tsx` | First-run + `/onboard/agent/:token` UI; creates session; builds/copies prompt |
| `packages/app/src/App.tsx` | Routes `/onboarding` and `/onboard/agent/:token` into `OnboardingFlow` |
| `packages/server/src/config/routes.ts` | Onboarding + agent-session HTTP handlers |
| `packages/server/src/config/schema.ts` | `OnboardingStateSchema`, `OnboardingAgentSessionSchema` |
| `packages/server/src/config/onboarding-modules.ts` | Module registry, selection resolve, safe-stops, Entity MC URL helpers |
| `packages/server/src/middleware/api-auth.ts` | Tokenized agent-session path auth exemptions |
| `packages/server/src/config/routes.test.ts` | Create/manifest/skill/bundle/progress + expiry negative tests |
| `packages/server/src/middleware/api-auth.test.ts` | Bearer exemption for tokenized onboarding paths |
| `packages/app/src/components/settings/AgentRegistrySettings.tsx` | Agents admin CRUD/grants — **no invite kit** |
| `packages/server/src/routes/agents.ts` | `/api/agents` registry — **no invites endpoints** |
| `packages/app/src/components/AgentManagementSurface.tsx` | Agent desk/runtime controls — **no invite/progress view** |

## Current API map (real)

### First-run / selection (auth-gated when API auth enabled)

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/api/onboarding/state` | Load `onboarding.state` from `app_settings` |
| `PATCH` | `/api/onboarding/state` | Partial patch; clears `skipped` |
| `POST` | `/api/onboarding/complete` | Marks completed/skipped + `completedAt` |
| `GET` | `/api/onboarding/modules` | Registry-backed module catalog + bundles/groups |
| `GET` | `/api/onboarding/readiness` | Runtime readiness gates for onboarding |
| `POST` | `/api/onboarding/resolve-selection` | Resolve modules/install order/checklist/safe-stops |
| `POST` | `/api/onboarding/dry-run` | Same resolution shape as resolve (dry-run plan) |
| `POST` | `/api/onboarding/agent-session` | Create tokenized setup session (TTL **30 minutes**) |

### Tokenized agent-session (public via path token)

Auth exemption regex in `api-auth.ts`:

```text
/^\/api\/onboarding\/agent-session\/[^/]+\/(manifest|progress|skill|bundle)$/
```

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/api/onboarding/agent-session/:token/manifest` | Builds manifest; transitions `created` → `opened`; merges checklist |
| `PATCH` | `/api/onboarding/agent-session/:token/progress` | Updates checklist item status/message; optional `sessionStatus` |
| `GET` | `/api/onboarding/agent-session/:token/skill` | Serves Entity MC `SKILL.md` |
| `GET` | `/api/onboarding/agent-session/:token/bundle` | Serves allowlisted Entity MC files as JSON |

### Confirmed absent (do not invent as existing)

- `POST/GET /api/agents/invites*`
- regenerate / revoke endpoints
- `GET` progress/status human poll endpoint (progress is **PATCH-only**)
- heartbeat / presence invite APIs
- durable `agent_invites` table

## Data / status machine (actual)

`OnboardingAgentSessionSchema` (`schema.ts`):

| Field | Actual |
| --- | --- |
| `token` | raw string (≥8); also used as settings key suffix |
| `createdAt` / `expiresAt` | ISO strings; TTL = `30 * 60 * 1000` |
| `status` | `created` \| `opened` \| `installing` \| `configured` \| `verified` \| `expired` |
| `state` | full `OnboardingState` (first-run wizard fields) |
| `progress[]` | `{ id, label, moduleId?, status, message?, updatedAt }` with step status `pending\|running\|done\|error` |

Storage: `app_settings` key `onboarding.agentSession.<rawToken>` via `setSettingJson` / `getSettingJson`.  
**Not** token-hashed. **Not** a dedicated table. Creating a session also writes normalized selection into global `onboarding.state`.

### Spec vs actual status mapping (for WP2-A-02)

| Invite-kit spec | Closest current | Gap |
| --- | --- | --- |
| `created` | `created` | align |
| `opened` | `opened` | align (manifest GET promotes) |
| `in_progress` | `installing` / `configured` | rename or map |
| `completed` | `verified` | rename or map |
| `expired` | `expired` | align (auto on read past `expiresAt`) |
| `revoked` | *(missing)* | must add |

## UI seams (`OnboardingFlow.tsx`)

Reusable now:

1. **`createAgentSession()`** — `POST /api/onboarding/agent-session` with `{ state }`
2. **URL builders** — setup `/onboard/agent/:token`, absolute manifest/bundle/skill/progress URLs
3. **Agent prompt builder** — copyable block with Session / Selected setup / modules / install order / safe stops / instructions / guardrails
4. **Copy controls** — setup URL + full prompt (`navigator.clipboard`; silent catch, no visible fallback)
5. **Checklist/timeline** — from session progress or resolved modules
6. **Module selection** — resolve-selection driven picker (required/recommended/optional)
7. **Route modes** — first-run wizard vs agent deep-link (`routeToken` / `isAgentRoute`)

First-run-only / not invite-kit ready:

- Prompt framing is “setting up Entity for this user”, not “invited as `<agent_name>/<role>`”
- Missing prompt sections: role, permissions scope, work domain/project, Workplane/task, chief routing, expiry timestamp line (TTL shown as UI copy “30 minutes”, not ISO `Expires:` in prompt)
- No copy buttons for individual manifest/bundle/skill/progress URLs
- No revoke / regenerate controls
- No Agent Desk / Agents → Add Agent entry point (lives under `/onboarding` only via `App.tsx`)
- Selecting “Invite setup agent” still sits inside first-run step 6

## Module registry seams (`onboarding-modules.ts`)

Reusable for invite kits:

- Bundles: `minimal` / `default` / `custom`
- Default modules: `entity-agent-contracts`, `entity-fs`, `entity-mc`, `entity-linker`
- `resolveOnboardingSelection` → modules, installOrder, checklist, gates, dryRun, `safeStopConditions`, `canApply`
- `buildCompatibilityEntityMcUrls(token)` for skill/bundle/progress paths
- Entity MC bundle allowlist in `routes.ts` (`ENTITY_MC_ALLOWED_FILES`) — secrets/private paths excluded; tests assert no home/private markers

Admin-only / third-party modules are excluded from first-run apply path via readiness/selection warnings — preserve that fail-closed posture in invite kits.

## Auth / security observations (audit, not fix-in-place)

1. Tokenized endpoints bypass bearer auth and self-auth via path token — correct for agent consumption; expiry enforced (401).
2. Raw token is stored in the settings key **and** returned in create/manifest responses — acceptable for first-run; invite-kit spec prefers `token_hash` + show-once.
3. `PATCH .../progress` accepts `sessionStatus` string validated by Zod enum — token holder can mark `verified` without server-side verification proof. WP2-A-02/05 should tighten transitions.
4. No revoke path; only expiry (30m) or overwriting settings key.
5. Bundle endpoint is allowlisted file serve — keep this pattern; do not broaden to arbitrary FS.
6. `POST /api/onboarding/agent-session` is **not** in the public pattern list — creation remains auth-gated when API auth is on (good for human create; invite APIs should stay that way).

## Agents surface placement (for WP2-A-03+)

| Surface | Current | Invite-kit need |
| --- | --- | --- |
| Agents admin (`AgentRegistrySettings`) | CRUD agent + module grants | Primary **Add Agent → invite kit** host |
| Agent management (`AgentManagementSurface`) | runtime controls | Agent Desk invite/progress/verification |
| `/api/agents` | registry list/create/grants | Needs sibling `/api/agents/invites*` (new) |
| OnboardingFlow | first-run kit | Keep for first-run; extract shared prompt/URL helpers |

## Gaps vs invite-kit spec (priority for follow-ups)

1. **WP2-A-02** — Durable invite model + status machine (`revoked`, completed naming, token hash, no global onboarding.state mutation on invite create).
2. **WP2-A-03** — Agents → Add Agent UI (not inside first-run wizard).
3. **WP2-A-04** — Generalize prompt builder to invite shape; copy buttons for each URL; include expiry ISO + permissions/role/target fields.
4. **WP2-A-05** — Revoke/regenerate/expiry controls; block tokenized endpoints on revoke; regenerate rotates token.
5. **WP2-A-06** — Agent Desk invite/setup/verification display from durable progress.
6. Later WP2-B — heartbeat/presence; Workplane attach; Chief routing (out of Phase A).

## Exact implementation guidance for WP2-A-02

1. Prefer new `agent_invites` (+ progress) tables; keep reading legacy `onboarding.agentSession.*` as compatibility during migration if needed.
2. Map status enum explicitly; do not silently coerce `verified` → healthy completed without checklist evidence.
3. Keep tokenized URL paths under `/api/onboarding/agent-session/:token/*` for compatibility; add human-facing `/api/agents/invites` separately.
4. Stop writing invite creation into `onboarding.state` for Agents-created invites (first-run may continue to).
5. Add transition table tests: `created→opened` on manifest; progress → `in_progress`/`installing`; complete → `completed`/`verified`; revoke blocks all tokenized GETs/PATCHs; expire blocks similarly.
6. Reuse `resolveOnboardingSelection`, `buildAgentManifest` (generalize name), and Entity MC allowlist — do not fork module resolution.

## Proof / non-goals for this ticket

- No source behavior change required beyond this durable audit doc.
- Browser proof: **N/A** (no user-facing UI change).
- Production promotion: avoided.
- Secrets/OAuth: untouched.
