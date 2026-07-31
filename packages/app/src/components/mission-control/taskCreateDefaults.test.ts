import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTaskCreateDomainDefaults } from './taskCreateDefaults.ts';

const projects = [
  {
    id: 7,
    name: 'Platform Engineering',
    color: null,
    project_key: 'platform-engineering',
    work_domain: 'engineering',
  },
  {
    id: 11,
    name: 'Entity Engineering',
    color: '#2563eb',
    project_key: 'entity-engineering',
    work_domain: 'engineering',
  },
];

test('Engineering task creation defaults the canonical seeded project as primary', () => {
  assert.deepEqual(resolveTaskCreateDomainDefaults(projects, 'engineering'), {
    projectIds: [11],
    error: null,
  });
});

test('ordinary task creation retains an empty project default', () => {
  assert.deepEqual(resolveTaskCreateDomainDefaults(projects, null), {
    projectIds: [],
    error: null,
  });
});

test('Engineering creation fails closed when no Engineering project is available', () => {
  assert.deepEqual(
    resolveTaskCreateDomainDefaults(
      [{ id: 3, name: 'Business Ops', color: null, work_domain: 'general' }],
      'engineering',
    ),
    {
      projectIds: [],
      error: 'Engineering project is unavailable. Task creation is disabled to prevent unclassified work.',
    },
  );
});
