/**
 * CH-A-02 / THE-918 — Channel adapter interface surface.
 * CH-A-03 / THE-919 — Slack reference adapter behind feature flag.
 *
 * Entity owns the work plane. Channel adapters only:
 *   - parse intake → task / ActivityEvent proposals
 *   - notify ← status
 *
 * Production Slack/Telegram/Discord/email sends are not registered by default.
 * The Slack reference adapter opts in via ENTITY_CHANNEL_SLACK_ADAPTER=1 and
 * uses a deterministic offline transport (no live Slack API).
 */

export {
  asNotificationDeliveryAdapter,
  buildIntakeActivityProposal,
  buildIntakeTaskProposal,
  createNullChannelAdapter,
  isChannelAdapter,
  isChannelAdapterKind,
  normalizeChannelIntakeRaw,
  type ChannelAdapter,
  type ChannelAdapterDescriptor,
} from './adapter';

export {
  createChannelAdapterRegistry,
  type ChannelAdapterRegistry,
  type ChannelAdapterRegistryEntry,
  type ChannelAdapterRegistrySnapshot,
} from './registry';

export {
  redactChannelSensitiveText,
  sanitizeChannelMetadata,
  sanitizeChannelPublicText,
  looksLikeChannelSecret,
} from './sanitize';

export {
  isSlackReferenceAdapterEnabled,
  SLACK_REFERENCE_FEATURE_FLAG,
} from './feature-flag';

export {
  createSlackReferenceAdapter,
  mapSlackIntakeRaw,
  registerSlackReferenceAdapterIfEnabled,
  SLACK_REFERENCE_ADAPTER_ID,
  SLACK_REFERENCE_DISPLAY_NAME,
  type SlackReferenceAdapterOptions,
} from './slack-reference-adapter';

export {
  createOfflineSlackTransport,
  type OfflineSlackTransportOptions,
  type SlackTransport,
  type SlackTransportMessage,
  type SlackTransportMode,
  type SlackTransportResult,
} from './slack-transport';

export {
  CHANNEL_ADAPTER_AVAILABILITY,
  CHANNEL_ADAPTER_KINDS,
  channelKindToNotificationChannel,
  type ChannelAdapterAvailability,
  type ChannelAdapterKind,
  type ChannelExternalRef,
  type ChannelIntakeActivityProposal,
  type ChannelIntakeMessage,
  type ChannelIntakeMode,
  type ChannelIntakeParseResult,
  type ChannelIntakeTaskProposal,
  type ChannelNotifyResult,
  type ChannelNotifyStatus,
  type ChannelStatusNotifyRequest,
} from './types';
