import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeProjectOption,
  selectMissionControlProjectOptions,
} from './projectOptions.ts';

test('normalizes project domain identity needed by create-task defaults', () => {
  assert.deepEqual(
    normalizeProjectOption({
      id: 11,
      name: 'Entity Engineering',
      color: '#2563eb',
      project_key: 'entity-engineering',
      work_domain: 'engineering',
    }),
    {
      id: 11,
      name: 'Entity Engineering',
      color: '#2563eb',
      created_at: null,
      project_key: 'entity-engineering',
      work_domain: 'engineering',
    },
  );
});

test('domain projects are opt-in so shared non-Engineering selectors remain unchanged', () => {
  const payload = [
    { id: 1, name: 'Soteria', color: null },
    {
      id: 11,
      name: 'Entity Engineering',
      color: null,
      project_key: 'entity-engineering',
      work_domain: 'engineering',
    },
    { id: 99, name: 'Unrelated Business Project', color: null, work_domain: 'general' },
  ];

  assert.deepEqual(
    selectMissionControlProjectOptions(payload).map((project) => project.id),
    [1],
  );
  assert.deepEqual(
    selectMissionControlProjectOptions(payload, {
      includeWorkDomains: ['engineering'],
    }).map((project) => project.id),
    [1, 11],
  );
});
