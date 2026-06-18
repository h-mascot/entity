import { existsSync } from 'fs';
import * as os from 'os';
import path from 'path';
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'child_process';

export interface AgentMetricsPayload {
  system: {
    cpuPercent: number;
    memUsedMb: number;
    memTotalMb: number;
    memPercent: number;
    uptimeSeconds: number;
    loadAvg: number;
  };
  gateway: {
    pid: number;
    cpuPercent: number;
    memPercent: number;
  };
  agents: Record<string, unknown>;
}

type ExecFile = (
  file: string,
  args: string[],
  options: ExecFileSyncOptionsWithStringEncoding
) => string;

const MB = 1024 * 1024;

function safeUptimeSeconds(): number {
  try {
    return Math.round(os.uptime());
  } catch {
    return Math.round(process.uptime());
  }
}

export function buildFallbackAgentMetrics(): AgentMetricsPayload {
  const memTotalMb = Math.round(os.totalmem() / MB);
  const memUsedMb = Math.round((os.totalmem() - os.freemem()) / MB);
  const cpuCount = Math.max(os.cpus().length, 1);
  const cpuPercent = Math.min(100, Math.round((os.loadavg()[0] / cpuCount) * 1000) / 10);
  const memPercent = memTotalMb > 0 ? Math.round((memUsedMb / memTotalMb) * 1000) / 10 : 0;

  return {
    system: {
      cpuPercent,
      memUsedMb,
      memTotalMb,
      memPercent,
      uptimeSeconds: safeUptimeSeconds(),
      loadAvg: os.loadavg()[0] ?? 0,
    },
    gateway: {
      pid: process.pid,
      cpuPercent: 0,
      memPercent: 0,
    },
    agents: {},
  };
}

export function collectAgentMetrics(options?: {
  scriptPath?: string;
  execFile?: ExecFile;
}): AgentMetricsPayload {
  const scriptPath =
    options?.scriptPath ?? path.join(__dirname, '..', '..', '..', 'agent-metrics.sh');
  const execFile = options?.execFile ?? execFileSync;

  if (!existsSync(scriptPath)) {
    return buildFallbackAgentMetrics();
  }

  // The script may exist but fail (missing runtime paths, non-JSON output,
  // timeout). Degrade to fallback metrics instead of surfacing a 500.
  try {
    const output = execFile('bash', [scriptPath], {
      timeout: 10000,
      encoding: 'utf8',
    });
    return JSON.parse(output) as AgentMetricsPayload;
  } catch {
    return buildFallbackAgentMetrics();
  }
}
