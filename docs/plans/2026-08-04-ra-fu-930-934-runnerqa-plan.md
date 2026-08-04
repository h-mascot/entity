# RA-FU 930–934 RunnerQA Implementation Plan (2026-08-04)

Branch: `runnerqa/ra-fu-930-934-20260804` (base `4c9dd5c`). Production forbidden.
Gate: `cd packages/server && npm run build && npx vitest run` (Node 22; better-sqlite3 won't build on Node 26).
Evidence root: `/Users/enterprise/clawd/output/entity/ra-fu-runnerqa-20260804/`.

## Approach
Coherent repairs to existing implementations (no greenfield rebuild). Vertical TDD slices per behavior: RED → minimal impl → GREEN → next. Colocated `*.test.ts`.

## THE-934 — doc-intelligence schema fail-closed
- [ ] RED: `validateDocAskInput` rejects malformed `schema` (non-array / dup / empty-string / oversized) BEFORE model call.
- [ ] RED: post-model exact field match — required `Owner` not satisfied by `Homeowner`.
- [ ] Impl: extend `validateDocAskInput` + `buildDocAskPrompt` for `schema`; add `validateDocSchemaExtraction` exact-match; `/ask` returns 400 `schema_invalid` and 422 `schema_incomplete` without leaking.
- [ ] Preserve comments/notes degraded state (no behavior change).
- [ ] DocIntelligencePanel: generic copy for schema validation errors.
Files: `packages/server/src/routes/doc-intelligence.ts`, `doc-intelligence.test.ts`, `DocIntelligencePanel.tsx`.

## THE-931 — chat-history authorization
- [ ] RED: agent principal with no grants → 404 (uniform) on channel messages.
- [ ] RED: missing channel → identical 404 (no-leak).
- [ ] RED: list-all (`/api/chat/channels`) denied for untrusted/no-grant principal when token auth on.
- [ ] Impl: add `authorizeChatResource` helper using `requireRequestOrg` + grant check; uniform 404 on unauth/missing. Confirm `/api/documents` is the only self-auth exemption (api-auth stays exact).
Files: `packages/server/src/routes/chat.ts`, `chat.test.ts` (new auth slice), `middleware/api-auth.ts` (verify only).

## THE-930 — agent noise controls
- [ ] RED: `createAgentNoiseGuard` suppresses concurrent duplicate send for same (agent, channel, content) within cooldown.
- [ ] RED: suppression uses server-canonical sender/timestamp, not client-supplied (caller cannot bypass/trigger).
- [ ] RED: muted agent never sends; cooldown bounded; mixed targets each reply.
- [ ] Impl: `AgentNoiseGuard` with atomic reservation (in-process lock keyed by scope), bounded state, mute + cooldown. Wire into `/api/chat/send` reply loop. Persist mute/cooldown via settings-store. Chat Settings UI shows selected backend + muted/cooldown/degraded.
Files: `packages/db/src/chat.ts` (mute state accessor), `packages/server/src/routes/chat.ts` (guard), new `agent-noise-guard.ts`, `ChatSidebar.tsx`/settings.

## THE-932 — provider health/healer
- [ ] RED: `validateSmtpBackendConfig` rejects plaintext SMTP auth (port 25 / `secure:false` no STARTTLS / auth without TLS).
- [ ] RED: callback `summary`/detail bounded in length; `occurredAt` clamped/validated.
- [ ] RED: healer persists last result/time/error; exposed via `/api/swarm/healer/status`.
- [ ] Impl: new `packages/server/src/swarm/providers/backend-health.ts` (SMTP + backend config validators); bound validate.ts; healer persistence in `app_settings`; SwarmBoard empty-vs-load-failure distinct degraded state.
Files: `backend-health.ts`, `callback-intake/validate.ts`, `healer.ts`, `swarm/routes.ts`, `SwarmBoard.tsx`.

## THE-933 — task handoffs
- [ ] RED: `createHandoff` is mode-aware (local vs cloud); cloud id never touches unrelated local handoff.
- [ ] RED: org/team scope enforced; cross-org rejected.
- [ ] RED: downstream task update + handoff edge + accountability fields commit atomically.
- [ ] RED: validate/authorize target principal.
- [ ] Impl: handoff persistence in db (`agent_handoff` activity/evidence + settings-store edge), atomic transaction, principal validation, generic UI copy + rollback in TaskDetailPanel.
Files: `packages/db/src/index.ts`, `packages/server/src/routes/tasks.ts`, `TaskDetailPanel.tsx`.

## Review gates
- [ ] Jeff Dean architecture/maintainability self-review.
- [ ] Luke W / Ryan Singer UI self-review for UI changes.
- [ ] Full gate: server build + vitest, app build.
- [ ] Receipt `worker-final.json` with `productionUntouched=true`.

## Notes / assumptions
- Node 22 must be on PATH for native builds; tests run under Node 22.
- THE-934 schema = caller-supplied required-field list for `/ask`; exact-match post-validation.
- THE-931 ownership model = org/team grant via existing `requireRequestOrg` (no new schema column; chat has no per-channel org yet).
- THE-932 backend-health is a new focused validator module (specified path) — coherent with existing secret-safe health posture.
