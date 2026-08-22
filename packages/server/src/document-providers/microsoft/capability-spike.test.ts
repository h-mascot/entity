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
      for (const artifactType of entry.artifactTypes) {
        expect(['unknown', 'unsupported']).toContain(
          microsoftCapabilityState(entry.capability, artifactType),
        );
      }
    }
  });

  it('falls back to unknown for unknown capabilities and artifact/capability mismatches', () => {
    expect(microsoftCapabilityState('permission_read', 'document')).toBe('unknown');
    expect(microsoftCapabilityState('version_history', 'document')).toBe('unknown');
    expect(microsoftCapabilityState('change_tracking', 'presentation')).toBe('unknown');
    expect(microsoftCapabilityState('agent_text_mutation', 'spreadsheet')).toBe('unknown');
    expect(microsoftCapabilityState('agent_range_mutation', 'presentation')).toBe('unknown');
    expect(microsoftCapabilityState('agent_slide_mutation', 'document')).toBe('unknown');
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

  it('does not authorize non-mutation behavior from documentation-only entries', () => {
    for (const capability of ['create', 'read', 'version_history', 'change_tracking', 'preview', 'open_external', 'embed_editor'] as const) {
      for (const artifactType of ARTIFACT_TYPES) {
        expect(microsoftCapabilityState(capability, artifactType)).toBe('unknown');
      }
    }
  });
});
