/**
 * T-018 (THE-959) — Google preview/open/permissions read-state derivation tests.
 *
 * R-009 acceptance criteria:
 *   1. "Preview failure does not remove the provider open action."
 *   2. "Edit action opens the correct provider artifact."
 *   3. "UI never labels a preview as a full Entity-native editor."
 * §9.3 permission-summary honesty: "Only values actually derivable from provider evidence
 *   may be displayed." §9.4: the UI must not blame the provider when only Entity's
 *   integration policy is read-only.
 *
 * Deterministic: injected capability report + provider metadata projection only. No network,
 * no credentials, no tenant data.
 */
import { describe, expect, it } from 'vitest';

import type { CapabilityReport, CapabilityState, CapabilityType, ResolvedCapability } from '../types';
import { CAPABILITY_NAMES } from '../types';
import {
  deriveGoogleReadState,
  GOOGLE_PERMISSION_SUMMARY_VALUES,
  type GooglePermissionSummary,
} from './read-state';

/** Hand-rolled full-report fixture builder (fail-closed defaults, per-lane overrides). */
function buildReport(overrides: Partial<Record<CapabilityType, CapabilityState>> = {}): CapabilityReport {
  const out: Record<CapabilityType, ResolvedCapability> = {} as Record<CapabilityType, ResolvedCapability>;
  for (const name of CAPABILITY_NAMES) {
    out[name] = {
      name,
      state: overrides[name] ?? (name === 'preview' || name === 'open_external' ? 'supported' : 'unsupported'),
      source: 'adapter',
    };
  }
  return out as CapabilityReport;
}

function baseInput() {
  return {
    capabilityReport: buildReport(),
    providerMetadata: {
      open_url: 'https://docs.google.com/document/d/doc-83/edit',
    },
    entityIntegrationWriteAllowed: false,
  };
}

describe('deriveGoogleReadState', () => {
  it('keeps the provider open action when preview fails (R-009 criterion 1)', () => {
    const state = deriveGoogleReadState({
      ...baseInput(),
      capabilityReport: buildReport({ preview: 'unsupported' }),
    });
    expect(state.previewAvailable).toBe(false);
    expect(state.previewFailureReason).toBeTruthy();
    // Structurally asserted: open affordance survives preview failure.
    expect(state.canOpen).toBe(true);
    expect(state.openUrl).toBe('https://docs.google.com/document/d/doc-83/edit');
    expect(state.editUrl).toBe('https://docs.google.com/document/d/doc-83/edit');
  });

  it('keeps the provider open action when preview evidence is unknown (fail closed on preview only)', () => {
    const state = deriveGoogleReadState({
      ...baseInput(),
      capabilityReport: buildReport({ preview: 'unknown' }),
    });
    expect(state.previewAvailable).toBe(false);
    expect(state.canOpen).toBe(true);
  });

  it('fails closed on open when the open_external capability is not actionable, without dragging the read-like preview lane down', () => {
    const state = deriveGoogleReadState({
      ...baseInput(),
      capabilityReport: buildReport({ open_external: 'unknown' }),
    });
    // Open/edit fail closed on the non-actionable lane...
    expect(state.canOpen).toBe(false);
    expect(state.openUrl).toBe(null);
    expect(state.editUrl).toBe(null);
    // ...but an independently supported read-like preview capability is not demoted by it.
    expect(state.previewAvailable).toBe(true);
  });

  it('resolves the edit action to the provider-evidenced artifact URL, never minted (R-009 criterion 2)', () => {
    const state = deriveGoogleReadState(baseInput());
    expect(state.editLabel).toBe('Edit in Google');
    expect(state.editUrl).toBe('https://docs.google.com/document/d/doc-83/edit');
  });

  it('never mints an open/edit URL when the metadata projection carries no link evidence', () => {
    const state = deriveGoogleReadState({ ...baseInput(), providerMetadata: { title: 'No link here' } });
    expect(state.openUrl).toBe(null);
    expect(state.editUrl).toBe(null);
    expect(state.canOpen).toBe(false);
  });

  it('never labels the preview as an Entity-native editor (R-009 criterion 3)', () => {
    const state = deriveGoogleReadState(baseInput());
    expect(state.previewIsNativeEditor).toBe(false);
    expect(state.previewLabel).toMatch(/not an Entity-native editor/i);
  });

  it('maps provider sharing evidence into the §9.3 vocabulary only', () => {
    const cases: Array<[Record<string, unknown>, GooglePermissionSummary]> = [
      [{ visibility: 'private' }, 'Private'],
      [{ visibility: 'limited' }, 'Private'],
      [{ sharing_state: 'workspace_shared' }, 'Workspace-shared'],
      [{ visibility: 'domain' }, 'Organization-shared'],
      [{ sharing_state: 'link_shared' }, 'Link-shared'],
      [{ visibility: 'anyone_with_link' }, 'Link-shared'],
      [{ sharing_state: 'external_sharing_detected' }, 'External sharing detected'],
    ];
    for (const [metadata, expected] of cases) {
      const state = deriveGoogleReadState({ ...baseInput(), providerMetadata: { ...baseInput().providerMetadata, ...metadata } });
      expect(state.permissionSummary).toBe(expected);
      expect(GOOGLE_PERMISSION_SUMMARY_VALUES).toContain(state.permissionSummary);
    }
  });

  it("never downgrades detected external sharing to a less-exposed label (§9.3)", () => {
    const state = deriveGoogleReadState({
      ...baseInput(),
      providerMetadata: {
        ...baseInput().providerMetadata,
        visibility: 'domain',
        sharing_state: 'external_sharing_detected',
      },
    });
    expect(state.permissionSummary).toBe('External sharing detected');
  });

  it('returns Unknown when no provider evidence derives a permission summary (§9.3 honesty)', () => {
    const state = deriveGoogleReadState({ ...baseInput(), providerMetadata: { title: 'opaque' } });
    expect(state.permissionSummary).toBe('Unknown');
    expect(state.permissionSummaryDerivable).toBe(false);
  });

  it("frames write-disabled as Entity integration policy, never as provider read-only (§9.4)", () => {
    const state = deriveGoogleReadState(baseInput());
    expect(state.writeDisabled).toBe(true);
    expect(state.writeDisabledReason).toBe('entity-integration-policy');
    expect(state.writeDisabledMessage).toMatch(/Entity/i);
    expect(state.writeDisabledMessage!.toLowerCase()).not.toMatch(/google .*read-only|provider is read-only/);
  });

  it("distinguishes genuine provider read-only evidence from Entity policy framing (§9.4)", () => {
    const state = deriveGoogleReadState({
      ...baseInput(),
      entityIntegrationWriteAllowed: true,
      providerMetadata: { ...baseInput().providerMetadata, provider_write_protected: true },
    });
    expect(state.writeDisabled).toBe(true);
    expect(state.writeDisabledReason).toBe('provider');
    expect(state.writeDisabledMessage).toMatch(/Google/i);
  });
});
