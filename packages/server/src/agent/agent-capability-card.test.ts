import { describe, expect, it } from 'vitest';
import { buildAgentCapabilityCard, type AgentCapabilitySource, type ModuleGrantSource, type ModuleSource } from './agent-capability-card';

const MODULES: ModuleSource[] = [
  {
    id: 'tasks',
    slug: 'tasks',
    name: 'Mission Control',
    permissions_schema_json: '["read","assign","review","admin"]',
    ui_config_json: '{"label":"Mission Control"}',
  },
  {
    id: 'docs',
    slug: 'docs',
    name: 'Docs',
    permissions_schema_json: '["read","write","comment","review"]',
    ui_config_json: '{"label":"Docs"}',
  },
  {
    id: 'files',
    slug: 'files',
    name: 'Files',
    permissions_schema_json: '["read","write","search"]',
    ui_config_json: '{"label":"Files"}',
  },
];

function buildAgent(overrides: Partial<AgentCapabilitySource> = {}): AgentCapabilitySource {
  return {
    id: 'geordi',
    slug: 'geordi',
    description: 'Engineering operator',
    adapter_type: 'codex',
    runtime_type: 'mac',
    status: 'active',
    metadata_json: '{}',
    ...overrides,
  };
}

function buildGrant(overrides: Partial<ModuleGrantSource> = {}): ModuleGrantSource {
  return {
    agent_id: 'geordi',
    module_id: 'tasks',
    enabled: true,
    permissions_json: '[]',
    scope_json: '{}',
    ...overrides,
  };
}

describe('buildAgentCapabilityCard', () => {
  it('uses registry metadata when owner and verification are present', () => {
    const card = buildAgentCapabilityCard({
      agent: buildAgent({
        metadata_json:
          '{"modules":["tasks","docs"],"owner":"Henry Mascot","verification":"Registry + grants","permissions":["approve"]}',
      }),
      grants: [buildGrant(), buildGrant({ module_id: 'docs' })],
      modules: MODULES,
    });

    expect(card.ownerLabel).toBe('Henry Mascot');
    expect(card.verificationLabel).toBe('Registry + grants');
    expect(card.capabilityLabels).toEqual(['Mission Control', 'Docs']);
    expect(card.permissionLabels).toEqual(['Approve', 'Read', 'Assign', 'Review']);
    expect(card.runtimeLabel).toBe('Codex · Mac · Active');
    expect(card.identityLabel).toBe('Engineering operator');
  });

  it('falls back to default owner and module permissions when grant permissions are empty', () => {
    const card = buildAgentCapabilityCard({
      agent: buildAgent({
        slug: 'book',
        id: 'book',
        runtime_type: 'remote',
        metadata_json: '{"modules":["docs","files"]}',
      }),
      grants: [buildGrant({ agent_id: 'book', module_id: 'docs' }), buildGrant({ agent_id: 'book', module_id: 'files' })],
      modules: MODULES,
    });

    expect(card.ownerLabel).toBe('Entity');
    expect(card.verificationLabel).toBe('Registry + 2 grants');
    expect(card.capabilityLabels).toEqual(['Docs', 'Files']);
    expect(card.permissionLabels).toEqual(['Read', 'Write', 'Comment', 'Review']);
    expect(card.moduleCount).toBe(2);
  });

  it('prefers explicit grant permissions over module schemas', () => {
    const card = buildAgentCapabilityCard({
      agent: buildAgent({
        slug: 'spock',
        id: 'spock',
      }),
      grants: [
        buildGrant({
          agent_id: 'spock',
          module_id: 'tasks',
          permissions_json: '["assign","triage"]',
        }),
      ],
      modules: MODULES,
    });

    expect(card.ownerLabel).toBe('Entity');
    expect(card.permissionLabels).toEqual(['Assign', 'Triage']);
    expect(card.verificationLabel).toBe('Registry + 1 grant');
  });
});
