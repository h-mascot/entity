import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_CONFIG } from './config';
import { createTaskAgentScheduler } from './scheduler';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('AGENT_CONFIG.enabled', () => {
  it.each(['1', 'true', 'TRUE', ' yes ', 'on'])('treats %s as enabled', (value) => {
    vi.stubEnv('ENTITY_AGENT_ENABLED', value);
    expect(AGENT_CONFIG.enabled).toBe(true);
  });

  it.each([undefined, '', '0', 'false', ' no ', 'off', 'maybe'])('treats %s as disabled', (value) => {
    if (typeof value === 'undefined') {
      vi.unstubAllEnvs();
    } else {
      vi.stubEnv('ENTITY_AGENT_ENABLED', value);
    }
    expect(AGENT_CONFIG.enabled).toBe(false);
  });
});

describe('createTaskAgentScheduler', () => {
  it('runs all configured scheduled scans once per tick and stops cleanly', async () => {
    vi.useFakeTimers();
    const scanRunner = {
      runStaleScan: vi.fn(async () => undefined),
      runReviewHygieneScan: vi.fn(async () => undefined),
      runOwnershipCheck: vi.fn(async () => undefined),
    };
    const scheduler = createTaskAgentScheduler(scanRunner, { enabled: true, intervalMs: 1000 });

    scheduler.start();
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(scanRunner.runStaleScan).toHaveBeenCalledTimes(1);
    expect(scanRunner.runStaleScan).toHaveBeenCalledWith('scheduled');
    expect(scanRunner.runReviewHygieneScan).toHaveBeenCalledTimes(1);
    expect(scanRunner.runReviewHygieneScan).toHaveBeenCalledWith('scheduled');
    expect(scanRunner.runOwnershipCheck).toHaveBeenCalledTimes(1);
    expect(scanRunner.runOwnershipCheck).toHaveBeenCalledWith('scheduled');

    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(scanRunner.runStaleScan).toHaveBeenCalledTimes(1);
  });

  it('does not schedule work when disabled', async () => {
    vi.useFakeTimers();
    const scanRunner = { runStaleScan: vi.fn(async () => undefined) };
    const scheduler = createTaskAgentScheduler(scanRunner, { enabled: false, intervalMs: 1 });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(10);

    expect(scheduler.isRunning()).toBe(false);
    expect(scanRunner.runStaleScan).not.toHaveBeenCalled();
  });

  it('falls back to the default interval for zero, negative, and non-finite intervals', async () => {
    vi.useFakeTimers();
    const scanRunner = { runStaleScan: vi.fn(async () => undefined) };

    for (const intervalMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const scheduler = createTaskAgentScheduler(scanRunner, { enabled: true, intervalMs });
      scheduler.start();
      await vi.advanceTimersByTimeAsync(AGENT_CONFIG.scanIntervalMs - 1);
      expect(scanRunner.runStaleScan).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(scanRunner.runStaleScan).toHaveBeenCalledTimes(1);
      scheduler.stop();
      scanRunner.runStaleScan.mockClear();
      vi.clearAllTimers();
    }
  });

  it('logs degraded scan failures without throwing out of the scheduler tick', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const scanRunner = {
      runStaleScan: vi.fn(async () => {
        throw new Error('stale scan failed');
      }),
      runReviewHygieneScan: vi.fn(async () => {
        throw new Error('review scan failed');
      }),
      runOwnershipCheck: vi.fn(async () => {
        throw new Error('ownership scan failed');
      }),
    };
    const scheduler = createTaskAgentScheduler(scanRunner, { enabled: true, intervalMs: 1000 });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(errorSpy).toHaveBeenCalledWith('[TaskAgentScheduler] Stale scan failed:', 'stale scan failed');
    expect(errorSpy).toHaveBeenCalledWith('[TaskAgentScheduler] Review hygiene scan failed:', 'review scan failed');
    expect(errorSpy).toHaveBeenCalledWith('[TaskAgentScheduler] Ownership check failed:', 'ownership scan failed');
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
  });
});
