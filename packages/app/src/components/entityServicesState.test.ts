import assert from 'node:assert/strict';
import test from 'node:test';
import { getServiceRegistryStatus } from './entityServicesState.js';

test('getServiceRegistryStatus labels a partial cold registry as discovery in progress', () => {
    assert.deepEqual(getServiceRegistryStatus('refreshing', true), {
      label: 'Discovery in progress',
      message: 'Showing the fast internal-service snapshot while full host discovery finishes.',
      tone: 'progress',
    });
});

test('getServiceRegistryStatus surfaces background discovery failures', () => {
    assert.deepEqual(getServiceRegistryStatus('error', true, 'listener scan failed'), {
      label: 'Discovery failed',
      message: 'listener scan failed',
      tone: 'error',
    });
});

test('getServiceRegistryStatus identifies a completed registry', () => {
    assert.deepEqual(getServiceRegistryStatus('ready', false), {
      label: 'Discovery complete',
      message: null,
      tone: 'ready',
    });
});
