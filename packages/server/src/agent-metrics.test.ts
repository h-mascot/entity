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
});
