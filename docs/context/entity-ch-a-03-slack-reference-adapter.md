# CH-A-03 — Slack reference adapter behind feature flag

**Linear:** THE-919  
**Build-plan task:** CH-A-03  
**Parent:** THE-836 (Entity Channel Integrations — Phase A: Adapter foundation)  
**Decision:** REFERENCE ADAPTER IMPLEMENTED  
**Dependency:** CH-A-02 / THE-918 Done (`2d2fd7ae66b8c9ebe292b6c49a7c4b7d841d02ed`)  
**Proof:** adapter tests + degraded offline path  

Source SHA-256 (consolidated packet): `84541727830ef8f4018ad2b9fdf587d653dfbba940b38b279ae3f90ca18ba895`

## Goal

Implement one reference channel adapter (Slack) behind a feature flag, using a deterministic offline/fake transport so no production Slack sends occur by default.

## Feature flag

| Env | Default | Effect |
| --- | --- | --- |
| `ENTITY_CHANNEL_SLACK_ADAPTER` | off | When `1`/`true`/`yes`/`on`, `registerSlackReferenceAdapterIfEnabled` registers the adapter |

Flag-off behavior: adapter `enabled: false`, availability `not_configured`, intake fails closed, notify `skipped`.

## Module layout

| Path | Role |
| --- | --- |
| `packages/server/src/channels/feature-flag.ts` | Flag reader |
| `packages/server/src/channels/slack-transport.ts` | Offline/fake transport (no network) |
| `packages/server/src/channels/slack-reference-adapter.ts` | Slack `ChannelAdapter` + conditional registry helper |
| `packages/server/src/channels/slack-reference-adapter.test.ts` | Success + degraded offline tests |

## Behavior

- **Intake:** Maps Slack Events API-ish `{ event: { ts, channel, text, thread_ts } }` into host-applied task/ActivityEvent proposals via `normalizeChannelIntakeRaw`.
- **Notify:** Posts through injected transport; default offline transport never opens sockets.
- **Availability:** Offline transport reports `degraded` (honest — not live Slack). Unreachable transport → `unavailable` / notify `skipped`. Mid-flight offline failure → `degraded`.
- **Secrets:** Public text/metadata sanitized; registry snapshots and notify results never include tokens (`xoxb-`, api keys, bearer).

## Non-goals (honored)

- No live Slack/Telegram/Discord/email production integration
- No Doc Hub rebuild / Provider Registry duplicate / Skill Workshop
- No adapter-owned task truth store (host applies proposals; CH-A-04 hardens further)
- No boot auto-registration without the feature flag

## CH-A-04 handoff

Ensure channel adapters never become alternate task truth stores (architecture test/receipt).

## Verification

See proof under `remaining-roadmap-runner/receipts/proof/CH-A-03/`.

Machine-readable twin: `entity-ch-a-03-slack-reference-adapter.json`.
