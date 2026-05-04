import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTaskAgentScheduler } from '../agent/scheduler';
import { AGENT_CONFIG } from '../agent/config';

describe('AGENT_CONFIG', () => {
  const originalEnv = process.env.ENTITY_AGENT_ENABLED;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ENTITY_AGENT_ENABLED = originalEnv;
    } else {
      delete process.env.ENTITY_AGENT_ENABLED;
    }
  });

  it('should have correct defaults', () => {
    expect(AGENT_CONFIG.model).toBe('gemini-3-flash-preview');
    expect(AGENT_CONFIG.provider).toBe('google');
    expect(AGENT_CONFIG.scanIntervalMs).toBe(30 * 60 * 1000);
    expect(AGENT_CONFIG.maxActionsPerScan).toBe(10);
  });

  it('should be disabled by default', () => {
    delete process.env.ENTITY_AGENT_ENABLED;
    expect(AGENT_CONFIG.enabled).toBe(false);
  });

  it('should be enabled when env is set to true', () => {
    process.env.ENTITY_AGENT_ENABLED = 'true';
    expect(AGENT_CONFIG.enabled).toBe(true);
  });

  it('should be disabled when env is set to false', () => {
    process.env.ENTITY_AGENT_ENABLED = 'false';
    expect(AGENT_CONFIG.enabled).toBe(false);
  });
});

describe('createTaskAgentScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not start when disabled', () => {
    const scanner = { runStaleScan: vi.fn().mockResolvedValue(null) };
    const scheduler = createTaskAgentScheduler(scanner, { enabled: false });

    scheduler.start();
    expect(scheduler.isRunning()).toBe(false);
    expect(scanner.runStaleScan).not.toHaveBeenCalled();
  });

  it('should start and run scans on interval when enabled', () => {
    const scanner = { runStaleScan: vi.fn().mockResolvedValue(null) };
    const scheduler = createTaskAgentScheduler(scanner, { enabled: true, intervalMs: 1000 });

    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(scanner.runStaleScan).toHaveBeenCalledTimes(1);
    expect(scanner.runStaleScan).toHaveBeenCalledWith('scheduled');

    vi.advanceTimersByTime(1000);
    expect(scanner.runStaleScan).toHaveBeenCalledTimes(2);

    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('runs review hygiene and ownership scans when the runner supports them', () => {
    const scanner = {
      runStaleScan: vi.fn().mockResolvedValue(null),
      runReviewHygieneScan: vi.fn().mockResolvedValue(null),
      runOwnershipCheck: vi.fn().mockResolvedValue(null),
    };
    const scheduler = createTaskAgentScheduler(scanner, { enabled: true, intervalMs: 1000 });

    scheduler.start();
    vi.advanceTimersByTime(1000);

    expect(scanner.runStaleScan).toHaveBeenCalledWith('scheduled');
    expect(scanner.runReviewHygieneScan).toHaveBeenCalledWith('scheduled');
    expect(scanner.runOwnershipCheck).toHaveBeenCalledWith('scheduled');

    scheduler.stop();
  });

  it('should not start twice', () => {
    const scanner = { runStaleScan: vi.fn().mockResolvedValue(null) };
    const scheduler = createTaskAgentScheduler(scanner, { enabled: true, intervalMs: 5000 });

    scheduler.start();
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    vi.advanceTimersByTime(5000);
    expect(scanner.runStaleScan).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('should handle scan errors gracefully', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const scanner = { runStaleScan: vi.fn().mockRejectedValue(new Error('Network failure')) };
    const scheduler = createTaskAgentScheduler(scanner, { enabled: true, intervalMs: 1000 });

    scheduler.start();
    vi.advanceTimersByTime(1000);

    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
    consoleError.mockRestore();
  });

  it('should stop gracefully when not running', () => {
    const scanner = { runStaleScan: vi.fn().mockResolvedValue(null) };
    const scheduler = createTaskAgentScheduler(scanner, { enabled: true });

    expect(() => scheduler.stop()).not.toThrow();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('should use default interval from config', () => {
    const scanner = { runStaleScan: vi.fn().mockResolvedValue(null) };
    const scheduler = createTaskAgentScheduler(scanner, { enabled: true });

    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    vi.advanceTimersByTime(AGENT_CONFIG.scanIntervalMs - 1);
    expect(scanner.runStaleScan).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(scanner.runStaleScan).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });
});
