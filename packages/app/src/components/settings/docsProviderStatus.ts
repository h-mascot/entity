/**
 * GQR-004 — API-backed DocsSettings provider status mapping.
 *
 * Pure mapping from the redacted provider-admin status payload
 * (GET /api/document-integrations/admin/status) to the ProviderSettings card models.
 * Fail closed: a missing/unloadable status maps to honest defaults — unknown connection,
 * disabled write mode, no destinations, unknown mutation lanes, and a diagnostic that
 * says the status could not be loaded (never invented health).
 */

import type { ProviderSettingsModel, ProviderWriteMode, ProviderConfirmationPolicy, ProviderDestination } from '../document-integrations/ProviderSettings';

export type ProviderMutationLaneState = 'supported' | 'unsupported' | 'unknown';

export interface ProviderAdminMutationSupportView {
  agent_text_mutation: ProviderMutationLaneState;
  agent_range_mutation: ProviderMutationLaneState;
  agent_slide_mutation: ProviderMutationLaneState;
}

export interface ProviderAdminDestinationView {
  id: string;
  displayName: string;
  kind: ProviderDestination['kind'];
  enabled: boolean;
  artifactTypes: string[];
}

export interface ProviderAdminProviderView {
  adapterRegistered: boolean;
  connectionState: string;
  policyConfigured: boolean;
  effectiveWriteMode: string;
  adminWriteAuthorized: boolean;
  writeAuthorizationProven: boolean;
  confirmationPolicy: string | null;
  destinations: ProviderAdminDestinationView[];
  mutationSupport: ProviderAdminMutationSupportView;
}

export interface ProviderAdminStatusView {
  runtime: { mode: string; sandboxBootstrap: string };
  providers: Record<string, ProviderAdminProviderView>;
}

/** Canonical card order: Google, Microsoft 365 (GQR-004), Local Office. */
export const PROVIDER_CARD_ORDER = ['google_workspace', 'microsoft_365', 'local_office'] as const;

const CARD_TITLES: Record<(typeof PROVIDER_CARD_ORDER)[number], ProviderSettingsModel['provider']> = {
  google_workspace: 'Google Workspace',
  microsoft_365: 'Microsoft 365',
  local_office: 'Local Office',
};

const UNKNOWN_LANES: ProviderAdminMutationSupportView = {
  agent_text_mutation: 'unknown',
  agent_range_mutation: 'unknown',
  agent_slide_mutation: 'unknown',
};

function mapConnectionState(state: string): ProviderSettingsModel['connectionState'] {
  switch (state) {
    case 'authorized':
      return 'ready';
    case 'degraded':
      return 'degraded';
    case 'unauthorized':
      return 'reauthorization_required';
    default:
      // 'unknown' (and anything unrecognized) stays honestly unknown — fail closed.
      return 'unknown';
  }
}

function mapWriteMode(mode: string): ProviderWriteMode {
  return mode === 'create_only' || mode === 'create_and_update' ? mode : 'disabled';
}

function mapConfirmation(policy: string | null): ProviderConfirmationPolicy {
  return policy === 'required' || policy === 'auto_approve' ? policy : 'not_required';
}

function providerDiagnostics(
  providerId: (typeof PROVIDER_CARD_ORDER)[number],
  provider: ProviderAdminProviderView | undefined,
  status: ProviderAdminStatusView | null,
  loadError?: string | null,
): string[] {
  const diagnostics: string[] = [];
  if (!status) {
    diagnostics.push(
      'Provider status could not be loaded from the server; showing fail-closed defaults.',
    );
  } else if (status.runtime.sandboxBootstrap === 'refused') {
    diagnostics.push(
      'Provider runtime is fail-closed (sandbox bootstrap refused in production); no provider operations are available.',
    );
  }
  if (!provider?.adapterRegistered) {
    diagnostics.push(
      providerId === 'microsoft_365'
        ? 'No live Microsoft 365 connector (provider adapter) is registered in this build; all operations and mutations are unavailable (fail closed).'
        : 'No provider adapter is registered in this runtime; all operations fail closed.',
    );
  }
  if (providerId === 'local_office') {
    diagnostics.push(
      'Local Office editing is unavailable until the Entity desktop bridge is installed and running.',
    );
  }
  if (loadError) {
    diagnostics.push(`Provider status request failed: ${loadError}`);
  }
  return diagnostics;
}

export interface DocsProviderCard {
  providerId: string;
  adapterRegistered: boolean;
  runtimePosture: string;
  model: ProviderSettingsModel;
}

/**
 * Map the redacted admin status (or a null status when the API is unreachable) to the
 * three provider cards. Every card is a server-authoritative READOUT: policy controls
 * stay disabled because writes are governed server-side (sandbox fixtures / audited
 * gates), never by this UI.
 */
export function providerCardsFromStatus(
  status: ProviderAdminStatusView | null,
  options: { loadError?: string | null } = {},
): DocsProviderCard[] {
  const runtimePosture = status
    ? `runtime ${status.runtime.mode}, bootstrap ${status.runtime.sandboxBootstrap}`
    : 'runtime status unavailable';
  return PROVIDER_CARD_ORDER.map((providerId) => {
    const provider = status?.providers?.[providerId];
    return {
      providerId,
      adapterRegistered: provider?.adapterRegistered ?? false,
      runtimePosture,
      model: {
        provider: CARD_TITLES[providerId],
        connectionState: mapConnectionState(provider?.connectionState ?? 'unknown'),
        writeMode: mapWriteMode(provider?.effectiveWriteMode ?? 'disabled'),
        adminWriteAuthorized: provider?.adminWriteAuthorized ?? false,
        writeAuthorizationProven: provider?.writeAuthorizationProven ?? false,
        confirmationPolicy: mapConfirmation(provider?.confirmationPolicy ?? null),
        destinations: (provider?.destinations ?? []).map((destination) => ({
          id: destination.id,
          displayName: destination.displayName,
          kind: destination.kind,
          enabled: destination.enabled,
        })),
        policyControlsEnabled: false,
        ...(providerId === 'local_office' ? { localReadiness: 'bridge_not_installed' as const } : {}),
        mutationSupport: provider?.mutationSupport ?? UNKNOWN_LANES,
        diagnostics: providerDiagnostics(providerId, provider, status, options.loadError),
      },
    };
  });
}
