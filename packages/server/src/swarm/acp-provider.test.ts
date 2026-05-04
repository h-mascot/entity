import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcpProvider } from './providers/acp';

describe('AcpProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails dispatch when ACP accepts the request but never returns a runId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }));

    const provider = new AcpProvider();

    await expect(provider.dispatch({
      jobId: 'job-1',
      title: 'Test job',
      spec: 'Ship it',
      repo: 'repo',
    })).rejects.toThrow(/runId/i);
  });

  it('surfaces ACP reachability failures during status checks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8100')));

    const provider = new AcpProvider();
    const status = await provider.status('run-123');

    expect(status.state).toBe('failed');
    expect(status.progress).toMatch(/ECONNREFUSED/);
  });
});
