/**
 * CH-A-02 / THE-918 — Channel adapter interface surface.
 *
 * Entity owns the work plane. Channel adapters only:
 *   - parse intake → task / ActivityEvent proposals
 *   - notify ← status
 *
 * No production outbound integrations are registered here.
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
