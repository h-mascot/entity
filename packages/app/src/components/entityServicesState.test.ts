import { describe, expect, it } from 'vitest';
import { getServiceRegistryStatus } from './entityServicesState.js';

describe('getServiceRegistryStatus', () => {
  it('labels a partial cold registry as discovery in progress', () => {
    expect(getServiceRegistryStatus('refreshing', true)).toEqual({
      label: 'Discovery in progress',
      message: 'Showing the fast internal-service snapshot while full host discovery finishes.',
      tone: 'progress',
    });
  });

  it('surfaces background discovery failures', () => {
    expect(getServiceRegistryStatus('error', true, 'listener scan failed')).toEqual({
      label: 'Discovery failed',
      message: 'listener scan failed',
      tone: 'error',
    });
  });

  it('identifies a completed registry', () => {
    expect(getServiceRegistryStatus('ready', false)).toEqual({
      label: 'Discovery complete',
      message: null,
      tone: 'ready',
    });
  });
});
