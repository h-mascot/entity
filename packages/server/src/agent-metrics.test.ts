import { describe, expect, it } from 'vitest';
import { buildFallbackAgentMetrics, collectAgentMetrics } from './agent-metrics';

describe('agent metrics', () => {
  it('builds a cross-platform fallback without shelling out', () => {
    const metrics = buildFallbackAgentMetrics();

    expect(metrics.system.memTotalMb).toBeGreaterThan(0);
    expect(metrics.system.memUsedMb).toBeGreaterThanOrEqual(0);
    expect(metrics.system.memPercent).toBeGreaterThanOrEqual(0);
    expect(metrics.system.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(metrics.gateway.pid).toBe(process.pid);
    expect(metrics.agents).toEqual({});
  });

  it('uses the fallback when the metrics script is missing', () => {
    const metrics = collectAgentMetrics({
      scriptPath: '/tmp/entity-missing-agent-metrics-script.sh',
      execFile: () => {
        throw new Error('should not execute a missing script');
      },
    });

    expect(metrics.system.memTotalMb).toBeGreaterThan(0);
    expect(metrics.gateway.pid).toBe(process.pid);
  });

  it('falls back when an existing script fails to execute (no 500)', () => {
    // #given a script that exists but throws on execution
    const metrics = collectAgentMetrics({
      scriptPath: __filename,
      execFile: () => {
        throw new Error('exec failed: missing runtime path');
      },
    });

    // #then it degrades to fallback metrics instead of throwing
    expect(metrics.gateway.pid).toBe(process.pid);
  });

  it('falls back when the script returns non-JSON output', () => {
    // #given a script that exists but emits unparseable output
    const metrics = collectAgentMetrics({
      scriptPath: __filename,
      execFile: () => 'not-json' as unknown as string,
    });

    // #then parsing failure is absorbed into the fallback
    expect(metrics.agents).toEqual({});
  });
});
