import { describe, expect, it } from 'vitest';
import {
  buildPermissionSafeEnvelope,
  evaluatePermission,
  filterAccessibleObjects,
  normalizeSensitivityCategories,
  resolveInheritedRole,
  type PrincipalPermissionContext,
  type ProtectedObject,
} from './permissions';

const orgManager: PrincipalPermissionContext = {
  principal_id: 'user-1',
  grants: [
    {
      role: 'manager',
      org_id: 'org-a',
      sensitivity_categories: ['customer', 'legal', 'financial', 'security', 'production', 'confidential_strategy'],
    },
  ],
};

function object(overrides: Partial<ProtectedObject> = {}): ProtectedObject {
  return {
    object_type: 'task',
    object_id: 'task-1',
    org_id: 'org-a',
    team_id: 'team-a',
    project_id: 42,
    title: 'Sensitive renewal',
    snippet: 'Customer renewal summary',
    content: 'Full restricted customer renewal details',
    ...overrides,
  };
}

describe('permission evaluator', () => {
  it('inherits org roles down to team/project scoped objects', () => {
    expect(resolveInheritedRole(orgManager, object({ object_type: 'native_document' }))).toBe('manager');

    const decision = evaluatePermission({
      principal: orgManager,
      object: object({ object_type: 'native_document', sensitivity: 'customer' }),
      action: 'read',
    });

    expect(decision).toMatchObject({
      allowed: true,
      effective_role: 'manager',
      required_role: 'viewer',
      sensitivity_categories: ['customer'],
    });
    expect(decision.redacted).toMatchObject({ title: 'Sensitive renewal', snippet: 'Customer renewal summary' });
  });

  it('tightens inherited access with object ACL requirements', () => {
    const decision = evaluatePermission({
      principal: {
        principal_id: 'user-2',
        grants: [{ role: 'viewer', org_id: 'org-a', sensitivity_categories: ['customer'] }],
      },
      object: object({
        object_type: 'evidence_artifact',
        acl_json: JSON.stringify({ required_role: 'manager' }),
        sensitivity: 'customer',
      }),
      action: 'read',
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain('requires manager role');
    expect(decision.redacted).toEqual({ title: null, snippet: null, content: null });
  });

  it('denies explicitly listed principals even when their inherited role is sufficient', () => {
    const decision = evaluatePermission({
      principal: orgManager,
      object: object({
        object_type: 'activity',
        acl_json: JSON.stringify({ denied_principal_ids: ['user-1'] }),
      }),
      action: 'read',
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain('principal denied by object policy');
  });

  it('requires sensitive category clearance for HR, customer, legal, financial, security, production, strategy, and workspace-defined data', () => {
    expect(normalizeSensitivityCategories('people customer legal financial security production confidential workspace_restricted')).toEqual([
      'hr',
      'customer',
      'legal',
      'financial',
      'security',
      'production',
      'confidential_strategy',
      'workspace_defined',
    ]);

    const decision = evaluatePermission({
      principal: {
        principal_id: 'user-3',
        grants: [{ role: 'admin', org_id: 'org-a', sensitivity_categories: ['hr'] }],
      },
      object: object({
        object_type: 'notification',
        sensitivity: 'people confidential workspace_restricted',
      }),
      action: 'notify',
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain('requires sensitivity clearance: hr, confidential_strategy, workspace_defined');
  });

  it('denies cross-org access without leaking restricted search result content', () => {
    const restrictedResult = object({
      object_type: 'search_result',
      object_id: 'search-1',
      org_id: 'org-b',
      sensitivity: 'customer',
      title: 'Other org account',
      snippet: 'Should not be visible',
      content: 'Should not be visible in full',
    });

    const envelope = buildPermissionSafeEnvelope(orgManager, restrictedResult, 'search');

    expect(envelope.permission.allowed).toBe(false);
    expect(envelope.permission.reasons).toEqual(expect.arrayContaining(['requires viewer role', 'requires sensitivity clearance: customer']));
    expect(envelope.object).toMatchObject({
      id: 'search-1',
      object_type: 'search_result',
      object_id: 'search-1',
      title: null,
      snippet: null,
      content: null,
      permission_state: 'restricted',
      entity_permission_state: 'restricted',
      restricted: true,
      placeholder: true,
    });
    expect(JSON.stringify(envelope.object)).not.toContain('Should not be visible');
  });

  it('filters mixed search collections to accessible objects only', () => {
    const visible = object({ object_type: 'search_result', object_id: 'visible', sensitivity: 'customer' });
    const hidden = object({ object_type: 'search_result', object_id: 'hidden', org_id: 'org-b', sensitivity: 'customer' });

    expect(filterAccessibleObjects(orgManager, [visible, hidden]).map((entry) => entry.object_id)).toEqual(['visible']);
  });

  it('marks visible envelopes without changing readable content', () => {
    const envelope = buildPermissionSafeEnvelope(orgManager, object({ object_type: 'external_document_ref', sensitivity: 'customer' }), 'preview');

    expect(envelope.permission.allowed).toBe(true);
    expect(envelope.object).toMatchObject({
      title: 'Sensitive renewal',
      snippet: 'Customer renewal summary',
      content: 'Full restricted customer renewal details',
      permission_state: 'visible',
      entity_permission_state: 'visible',
      restricted: false,
      placeholder: false,
      permission_reasons: [],
    });
  });
});
