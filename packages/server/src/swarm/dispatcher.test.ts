import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SwarmProvider } from './providers/interface';
import type { SwarmJob } from './types';

const mocks = vi.hoisted(() => ({
  providers: new Map<string, SwarmProvider>(),
  getSwarmJob: vi.fn(),
  updateSwarmJob: vi.fn(),
  createSwarmProof: vi.fn(),
  listSwarmJobs: vi.fn(),
  pluginSettingsJson: undefined as string | undefined,
}));

vi.mock('./provider-registry', () => ({
  swarmProviderRegistry: {
    register: vi.fn((provider: SwarmProvider) => {
      mocks.providers.set(provider.name, provider);
    }),
    get: vi.fn((name: string) => mocks.providers.get(name)),
    list: vi.fn(() => Array.from(mocks.providers.values())),
  },
}));

vi.mock('./db', () => ({
  getSwarmJob: mocks.getSwarmJob,
  updateSwarmJob: mocks.updateSwarmJob,
  createSwarmProof: mocks.createSwarmProof,
  listSwarmJobs: mocks.listSwarmJobs,
}));

vi.mock('../../../db/src/entity-db', () => ({
  getEntityDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: vi.fn(() =>
        mocks.pluginSettingsJson === undefined
          ? undefined
          : { settings_json: mocks.pluginSettingsJson }
      ),
    })),
  })),
}));

function job(overrides: Partial<SwarmJob> = {}): SwarmJob {
  return {
    id: 'job-1',
    task_id: 42,
    title: 'Implement dispatcher tests',
    spec: 'Exercise state transitions',
    repo: '/workspace',
    branch: null,
    provider: 'test-provider',
    status: 'queued',
    priority: 'medium',
    context_file: null,
    run_handle: null,
    retry_count: 0,
    max_retries: 3,
    feedback: null,
    created_by: 'tester',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    dispatched_at: null,
    completed_at: null,
    ...overrides,
  };
}

function provider(overrides: Partial<SwarmProvider> = {}): SwarmProvider {
  return {
    name: 'test-provider',
    label: 'Test Provider',
    healthCheck: vi.fn(async () => ({ available: true })),
    dispatch: vi.fn(async () => ({ runHandle: 'run-1', jobStatus: 'running' as const })),
    status: vi.fn(async () => ({ state: 'running' as const })),
    cancel: vi.fn(async () => undefined),
    collectProof: vi.fn(async () => ({})),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.providers.clear();
  mocks.getSwarmJob.mockReset();
  mocks.updateSwarmJob.mockReset();
  mocks.createSwarmProof.mockReset();
  mocks.listSwarmJobs.mockReset();
  mocks.pluginSettingsJson = undefined;
});

describe('swarm dispatcher state machine', () => {
  it('marks a queued job dispatched before forwarding provider payload, then stores the run handle', async () => {
    const testProvider = provider();
    mocks.providers.set(testProvider.name, testProvider);
    mocks.getSwarmJob.mockReturnValue(job({
      branch: 'coverage-branch',
      context_file: 'docs/context.md',
      feedback: 'try again with tests',
    }));

    const { dispatchJob } = await import('./dispatcher');
    await expect(dispatchJob('job-1')).resolves.toEqual({ success: true });

    expect(testProvider.healthCheck).toHaveBeenCalledOnce();
    expect(testProvider.dispatch).toHaveBeenCalledWith({
      jobId: 'job-1',
      title: 'Implement dispatcher tests',
      spec: 'Exercise state transitions',
      repo: '/workspace',
      branch: 'coverage-branch',
      context: 'docs/context.md',
      feedback: 'try again with tests',
    });
    expect(mocks.updateSwarmJob).toHaveBeenNthCalledWith(1, 'job-1', {
      status: 'dispatched',
      dispatched_at: expect.any(String),
    });
    expect(mocks.updateSwarmJob).toHaveBeenNthCalledWith(2, 'job-1', {
      status: 'running',
      run_handle: 'run-1',
    });
  });

  it('does not mutate a job when provider health is degraded', async () => {
    const testProvider = provider({
      healthCheck: vi.fn(async () => ({ available: false, message: 'helm down' })),
    });
    mocks.providers.set(testProvider.name, testProvider);
    mocks.getSwarmJob.mockReturnValue(job());

    const { dispatchJob } = await import('./dispatcher');
    await expect(dispatchJob('job-1')).resolves.toEqual({
      success: false,
      error: 'Provider test-provider unavailable: helm down',
    });

    expect(testProvider.dispatch).not.toHaveBeenCalled();
    expect(mocks.updateSwarmJob).not.toHaveBeenCalled();
  });

  it('records failed state and feedback when provider dispatch throws after the claim transition', async () => {
    const testProvider = provider({
      dispatch: vi.fn(async () => {
        throw new Error('runner rejected job');
      }),
    });
    mocks.providers.set(testProvider.name, testProvider);
    mocks.getSwarmJob.mockReturnValue(job({ status: 'draft' }));

    const { dispatchJob } = await import('./dispatcher');
    await expect(dispatchJob('job-1')).resolves.toEqual({ success: false, error: 'runner rejected job' });

    expect(mocks.updateSwarmJob).toHaveBeenNthCalledWith(1, 'job-1', {
      status: 'dispatched',
      dispatched_at: expect.any(String),
    });
    expect(mocks.updateSwarmJob).toHaveBeenNthCalledWith(2, 'job-1', {
      status: 'failed',
      feedback: 'Dispatch error: runner rejected job',
    });
  });

  it('collects proof for completed runs and advances through proof to review', async () => {
    const testProvider = provider({
      status: vi.fn(async () => ({ state: 'completed' as const })),
      collectProof: vi.fn(async () => ({
        commitSha: 'abc123',
        branch: 'proof-branch',
        buildLog: 'build passed',
        testResult: 'pass' as const,
        testOutput: '7 passed',
        screenshots: ['proof.png'],
        artifacts: { junit: 'report.xml' },
        durationSec: 90,
      })),
    });
    mocks.providers.set(testProvider.name, testProvider);
    mocks.getSwarmJob.mockReturnValue(job({ status: 'running', run_handle: 'run-1' }));

    const { checkJobStatus } = await import('./dispatcher');
    await expect(checkJobStatus('job-1')).resolves.toEqual({ success: true, status: 'review' });

    expect(mocks.updateSwarmJob).toHaveBeenNthCalledWith(1, 'job-1', { status: 'proof' });
    expect(mocks.createSwarmProof).toHaveBeenCalledWith({
      job_id: 'job-1',
      provider: 'test-provider',
      commit_sha: 'abc123',
      branch: 'proof-branch',
      build_log: 'build passed',
      test_result: 'pass',
      test_output: '7 passed',
      screenshots: ['proof.png'],
      artifacts: { junit: 'report.xml' },
      duration_sec: 90,
    });
    expect(mocks.updateSwarmJob).toHaveBeenNthCalledWith(2, 'job-1', { status: 'review' });
  });

  it('requeues failed runs below the retry limit and fails permanently at the limit', async () => {
    const testProvider = provider({ status: vi.fn(async () => ({ state: 'failed' as const })) });
    mocks.providers.set(testProvider.name, testProvider);

    const { checkJobStatus } = await import('./dispatcher');
    mocks.getSwarmJob.mockReturnValue(job({ status: 'running', run_handle: 'run-1', retry_count: 1, max_retries: 3 }));
    await expect(checkJobStatus('job-1')).resolves.toEqual({ success: true, status: 'queued' });
    expect(mocks.updateSwarmJob).toHaveBeenLastCalledWith('job-1', {
      status: 'queued',
      retry_count: 2,
      run_handle: undefined,
    });

    mocks.updateSwarmJob.mockClear();
    mocks.getSwarmJob.mockReturnValue(job({ status: 'running', run_handle: 'run-2', retry_count: 2, max_retries: 3 }));
    await expect(checkJobStatus('job-1')).resolves.toEqual({ success: true, status: 'failed' });
    expect(mocks.updateSwarmJob).toHaveBeenLastCalledWith('job-1', {
      status: 'failed',
      retry_count: 3,
    });
  });

  it('auto-dispatches only queued jobs within configured remaining capacity', async () => {
    const testProvider = provider();
    mocks.providers.set(testProvider.name, testProvider);
    const active = job({ id: 'active', status: 'running', created_at: '2026-07-01T00:00:00.000Z' });
    const newerQueued = job({ id: 'newer', status: 'queued', created_at: '2026-07-01T00:02:00.000Z' });
    const olderQueued = job({ id: 'older', status: 'queued', created_at: '2026-07-01T00:01:00.000Z' });
    mocks.pluginSettingsJson = JSON.stringify({ autoDispatch: true, maxConcurrentJobs: 2 });
    mocks.listSwarmJobs.mockImplementation((filters?: { status?: string }) =>
      filters?.status === 'queued' ? [newerQueued, olderQueued] : [active]
    );
    mocks.getSwarmJob.mockImplementation((id: string) => (id === 'older' ? olderQueued : undefined));

    const { kickAutoDispatch } = await import('./dispatcher');
    await expect(kickAutoDispatch()).resolves.toEqual({ dispatched: 1, attempted: 1 });

    expect(testProvider.dispatch).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'older' }));
    expect(testProvider.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ jobId: 'newer' }));
  });
});
