/** T-021 / THE-962 — fail-closed Microsoft capability catalogue proof. */
import { describe, expect, it } from 'vitest';
import type { DocumentArtifactType } from '../../../../db/src/document-integrations';
import {
  MICROSOFT_CAPABILITY_MATRIX,
  microsoftCapabilityState,
  microsoftMutationAllowed,
} from './capability-spike';
import type { CapabilityType } from '../types';

const ARTIFACT_TYPES: readonly DocumentArtifactType[] = ['document', 'spreadsheet', 'presentation'];
const MUTATIONS: readonly CapabilityType[] = [
  'agent_text_mutation',
  'agent_range_mutation',
  'agent_slide_mutation',
];

describe('Microsoft capability spike', () => {
  it('keeps every current matrix entry non-actionable from documentation metadata alone', () => {
    for (const entry of MICROSOFT_CAPABILITY_MATRIX) {
      expect(['unknown', 'unsupported']).toContain(entry.defaultState);
      for (const artifactType of entry.artifactTypes) {
        expect(['unknown', 'unsupported']).toContain(
          microsoftCapabilityState(entry.capability, artifactType),
        );
      }
    }
  });

  it('falls back to unknown for unknown capabilities and every wrong artifact/capability pair', () => {
    expect(microsoftCapabilityState('permission_read', 'document')).toBe('unknown');
    for (const entry of MICROSOFT_CAPABILITY_MATRIX) {
      for (const artifactType of ARTIFACT_TYPES) {
        if (!entry.artifactTypes.includes(artifactType)) {
          expect(microsoftCapabilityState(entry.capability, artifactType)).toBe('unknown');
        }
      }
    }
  });

  it('denies every mutation lane for every artifact type', () => {
    for (const capability of MUTATIONS) {
      for (const artifactType of ARTIFACT_TYPES) {
        expect(
          microsoftMutationAllowed(
            capability as Extract<CapabilityType, 'agent_text_mutation' | 'agent_range_mutation' | 'agent_slide_mutation'>,
            artifactType,
          ),
        ).toBe(false);
      }
    }
  });

  it('keeps every applicable non-mutation disposition unknown', () => {
    for (const entry of MICROSOFT_CAPABILITY_MATRIX) {
      if (!MUTATIONS.includes(entry.capability)) {
        for (const artifactType of entry.artifactTypes) {
          expect(microsoftCapabilityState(entry.capability, artifactType)).toBe('unknown');
        }
      }
    }
  });
});
