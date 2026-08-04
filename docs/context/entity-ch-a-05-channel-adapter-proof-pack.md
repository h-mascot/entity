# CH-A-05 — Channel adapter proof pack

**Linear:** THE-921
**Build-plan task:** CH-A-05
**Parent:** THE-836 (Entity Channel Integrations — Phase A: Adapter foundation)
**Decision:** PROOF PACK IMPLEMENTED
**Dependencies:** CH-A-03 / THE-919, CH-A-04 / THE-920
**Proof:** E2E + negative proof


Source SHA-256 (consolidated packet): `84541727830ef8f4018ad2b9fdf587d653dfbba940b38b279ae3f90ca18ba895`

## Goal

Prove the Phase A channel adapter foundation end-to-end:

1. Slack reference adapter behind `ENTITY_CHANNEL_SLACK_ADAPTER` (CH-A-03)
2. Host-owned task truth via `applyChannelIntakeProposals` (CH-A-04)
3. Explicit negative/degraded paths (flag off, missing host writers, unavailable transport, forbidden truth methods, secret redaction)

## E2E success chain

```text
flag ON
  → registerSlackReferenceAdapterIfEnabled (offline transport)
  → parseIntake (Slack Events API-ish → proposals)
  → assertChannelAdapterNotTaskTruthStore
  → applyChannelIntakeProposals (injected host writers)
  → notifyStatus (degraded offline — never invents live Slack health)
  → NotificationDeliveryAdapter bridge (degraded)
```

## Negative / degraded coverage

| Case | Expected |
| --- | --- |
| Feature flag off | No registry entry; intake `adapter_disabled`; notify `skipped` / `not_configured`; zero host writes |
| Missing host writers | `host_writers_required`, degraded, truthOwner still `host_task_service` |
| Unavailable transport | notify `skipped` + `slack_transport_unavailable` |
| Forbidden truth methods | runtime guard throws `channel_adapter_truth_store_forbidden` |
| Malformed intake | parse fails; host writers never called |
| Architecture scan | production adapter sources have zero truth-store violations |
| Secrets in payload | redacted from intake / notify / registry snapshot |

## Module layout

| Path | Role |
| --- | --- |
| `packages/server/src/channels/channel-adapter-proof-pack.e2e.test.ts` | E2E + negative proof pack |
| `docs/context/entity-ch-a-05-channel-adapter-proof-pack.md` | This review |
| `docs/context/entity-ch-a-05-channel-adapter-proof-pack.json` | Machine-readable twin |

No new production adapter module is required — the pack composes CH-A-03 + CH-A-04 surfaces.

## Non-goals (honored)

- No live Slack/Telegram/Discord/email production sends
- No adapter writes to DB/task repository as source of truth
- No Doc Hub rebuild / Provider Registry duplicate / Skill Workshop
- No production mutation / secret exposure
- No user-facing UI (browser proof N/A)

## Verification

See proof under `remaining-roadmap-runner/receipts/proof/CH-A-05/`.

Machine-readable twin: `entity-ch-a-05-channel-adapter-proof-pack.json`.
