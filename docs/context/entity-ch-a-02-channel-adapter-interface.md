# CH-A-02 — Channel adapter interface review

**Linear:** THE-918  
**Build-plan task:** CH-A-02  
**Parent:** THE-836 (Entity Channel Integrations — Phase A: Adapter foundation)  
**Decision:** INTERFACE DEFINED  
**Dependency:** CH-A-01 / THE-917 Done (`9a0fed4eaf0a010b5333b810f0d0e8afecb64103`)  
**Proof:** interface review  

Source SHA-256 (consolidated packet): `84541727830ef8f4018ad2b9fdf587d653dfbba940b38b279ae3f90ca18ba895`

## Goal

Define a minimal bidirectional channel adapter contract:

1. **intake → task / ActivityEvent** — external messages become host-applied proposals
2. **notify ← status** — Entity task status changes fan out to external channels

Channels remain adapters over Entity work state (grill Q48). They must not become alternate task truth stores (CH-A-04).

## Non-goals (honored)

- No Slack / Telegram / Discord / email production integration (CH-A-03)
- No Doc Hub rebuild; no Provider Registry duplicate
- No production mutation; no secret exposure
- No Skill Workshop in Entity core

## Module layout

| Path | Role |
| --- | --- |
| `packages/server/src/channels/types.ts` | Kinds, availability, intake/notify request/result types |
| `packages/server/src/channels/adapter.ts` | `ChannelAdapter` interface, intake normalizer, notify bridge |
| `packages/server/src/channels/registry.ts` | In-memory registry (empty by default at boot) |
| `packages/server/src/channels/sanitize.ts` | Public-safe redaction for adapter I/O |
| `packages/server/src/channels/index.ts` | Public exports |
| `packages/server/src/channels/adapter.test.ts` | Interface contract tests |

Boot does **not** register production adapters. `createNotificationRoutingService` remains unwired at boot (CH-A-01 finding unchanged).

## Interface

```ts
interface ChannelAdapter {
  id: string;
  kind: ChannelAdapterKind; // clickclack|email|discord|slack|telegram|agentpush|webhook|other
  displayName: string;
  enabled: boolean;
  getAvailability(): ChannelAdapterAvailability; // available|degraded|unavailable|not_configured
  parseIntake(raw: unknown): ChannelIntakeParseResult;
  notifyStatus(request: ChannelStatusNotifyRequest): ChannelNotifyResult;
}
```

### Intake → task / ActivityEvent

`parseIntake` / `normalizeChannelIntakeRaw` produce:

- `ChannelIntakeMessage` (normalized, public-safe)
- optional `ChannelIntakeTaskProposal` (`origin_channel`, backlog default, externalId in metadata)
- optional `ChannelIntakeActivityProposal` (`task_created` or `task_updated` + `action: channel_intake`)

**Host applies proposals.** Adapters must not write tasks or ActivityEvents themselves. Missing `externalId` fails closed. Empty body is explicit `degraded`, never silent healthy content.

### Notify ← status

`notifyStatus` accepts Entity `taskId` + `status` (+ optional previous status, ActivityEvent id, deep link). Results: `sent | failed | degraded | skipped`. `not_configured` / `unavailable` → `skipped` with reason; degraded never coerced to healthy sent.

### Bridge to existing notification routing

`asNotificationDeliveryAdapter(adapter)` wraps `notifyStatus` as `NotificationDeliveryAdapter` so inbox-first routing can reuse one model. `telegram` maps to notification channel `other` until the DB enum gains an explicit value.

## Relationship to CH-A-01 seams

| Seam | Relationship |
| --- | --- |
| `NotificationDeliveryAdapter` | Outbound-only subset; bridged via `asNotificationDeliveryAdapter` |
| ClickClack bridge/proxy | Remains chat compatibility; a future `kind: 'clickclack'` adapter may wrap it |
| Mission Chat `/api/chat/*` | Unchanged; not an external IM intake surface |
| Inbox API | Unchanged; still the canonical notification record |

## Explicit CH-A-03 handoff

1. Implement one reference adapter (Slack or Telegram) behind a feature flag
2. Register only when flag enabled; prove degraded offline path
3. Do not mount production credentials by default
4. Keep host-applied intake proposals (no adapter-owned task store)

## Secrets posture

- Sensitive metadata keys/text redacted (`sanitizeChannelMetadata`)
- Provider token shapes (`xoxb-`, `sk-`, bearer-like) redacted
- Registry snapshots expose id/kind/availability only — never credentials
- Adapter I/O must remain public-safe for API/UI surfaces

## Verification

See proof under `remaining-roadmap-runner/receipts/proof/CH-A-02/`.

Machine-readable twin: `entity-ch-a-02-channel-adapter-interface.json`.
