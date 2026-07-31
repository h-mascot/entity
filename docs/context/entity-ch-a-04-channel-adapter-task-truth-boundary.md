# CH-A-04 — Channel adapters never become alternate task truth stores

**Linear:** THE-920  
**Build-plan task:** CH-A-04  
**Parent:** THE-836 (Entity Channel Integrations — Phase A: Adapter foundation)  
**Decision:** ARCHITECTURE GUARD IMPLEMENTED  
**Dependency:** CH-A-03 / THE-919 Done (`096eb314a857b834898984d0df71345657d66936`)  
**Proof:** architecture test/receipt  

Source SHA-256 (consolidated packet): `84541727830ef8f4018ad2b9fdf587d653dfbba940b38b279ae3f90ca18ba895`

## Goal

Ensure channel adapters never become alternate task truth stores (grill Q48).

Channels remain intake/notification adapters over Entity work state. The host/task service is the only writer of task rows and ActivityEvents.

## Architecture

| Layer | Allowed | Forbidden |
| --- | --- | --- |
| Channel adapter | `parseIntake` → proposals; `notifyStatus` ← status | DB/task repository writes; `createTask`/`updateTask`/`deleteTask`; SQL against `tasks`; better-sqlite3; forbidden persist methods |
| Host boundary | `applyChannelIntakeProposals` with injected writers | Treating adapter proposals as already-persisted truth |
| Task repository / ActivityEvent service | Persist task truth | Being called directly from adapter modules |

## Module layout

| Path | Role |
| --- | --- |
| `packages/server/src/channels/task-truth-boundary.ts` | Host apply path + architecture scan helpers |
| `packages/server/src/channels/task-truth-boundary.test.ts` | Architecture + success/negative tests |
| `packages/server/src/channels/index.ts` | Public exports |

## Host apply contract

```ts
applyChannelIntakeProposals(parseResult, {
  createTask: (proposal) => hostCreate(proposal),
  appendActivity: (taskId, event) => hostAppend(taskId, event),
})
```

- Missing writers → `host_writers_required` (degraded, fail closed)
- Failed intake parse → propagate code; zero writes
- Success → `truthOwner: 'host_task_service'`

## Architecture scan

Production adapter sources (`adapter.ts`, `registry.ts`, `slack-reference-adapter.ts`, …) are scanned for forbidden truth-store patterns. `import type` from db (e.g. notification channel enum) is allowed; value imports are not.

Runtime guard `assertChannelAdapterNotTaskTruthStore` rejects adapters that expose forbidden methods (`persistTask`, `createTask`, …).

## Non-goals (honored)

- No live Slack/Telegram/Discord/email production sends
- No Doc Hub rebuild / Provider Registry duplicate / Skill Workshop
- No production mutation / secret exposure
- No adapter-owned SQLite/task repository

## CH-A-05 handoff

Channel adapter proof pack (E2E + negative proof) builds on CH-A-03 + CH-A-04.
See `docs/context/entity-ch-a-05-channel-adapter-proof-pack.md` and
`packages/server/src/channels/channel-adapter-proof-pack.e2e.test.ts`.

## Verification

See proof under `remaining-roadmap-runner/receipts/proof/CH-A-04/`.

Machine-readable twin: `entity-ch-a-04-channel-adapter-task-truth-boundary.json`.
