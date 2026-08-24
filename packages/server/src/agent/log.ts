import {
  createAgentLogRepository,
  type AgentLogRecord,
  type AgentLogStatus,
  type CreateAgentLogInput,
} from '../../../db/src';
import {
  buildProviderTelemetryEvent,
  classifyProviderFault,
  type ProviderFaultClassification,
  type ProviderTelemetryEvent,
  type ProviderTelemetryInput,
} from '../phase2-observability';
import { AGENT_CONFIG } from './config';
import { getTaskAgentSettings } from './settings';

const agentLogRepository = createAgentLogRepository();

export interface AgentStatus extends AgentLogStatus {
  provider: string;
  model: string;
  enabled: boolean;
  apiKeyConfigured: boolean;
  apiKeySource: 'database' | 'env' | 'none';
}

export function writeAgentLog(input: CreateAgentLogInput): AgentLogRecord | null {
  try {
    return agentLogRepository.createLog(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[TaskAgent] Failed to write agent log:', message);
    return null;
  }
}

export function listAgentLogs(limit = 100): AgentLogRecord[] {
  try {
    return agentLogRepository.listLogs(limit);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[TaskAgent] Failed to list agent logs:', message);
    return [];
  }
}

export function getAgentStatus(): AgentStatus {
  const status = agentLogRepository.getStatus();
  const settings = getTaskAgentSettings();
  return {
    ...status,
    provider: settings.provider,
    model: settings.model,
    enabled: AGENT_CONFIG.enabled,
    apiKeyConfigured: settings.apiKeyConfigured,
    apiKeySource: settings.apiKeySource,
  };
}

/**
 * T-035 / R-038 — sanitized provider telemetry for the agent logging seam.
 *
 * Composes the shared provider-neutral observability/classification seam
 * (phase2-observability) so raw credentials, tokens, document content, and
 * operator-specific absolute paths can never reach the console/log surface. The
 * event is emitted as structured telemetry only; no raw provider text is echoed.
 */
export function writeBridgeReadinessTelemetry(
  input: ProviderTelemetryInput,
): ProviderTelemetryEvent {
  const event = buildProviderTelemetryEvent(input);
  console.info('[document-integrations:obs]', JSON.stringify(event));
  return event;
}

/**
 * T-035 / R-033 — sanitized retry-classification trace for the agent logging seam.
 * Uses the shared classifier (stale revision / auth / unsupported / invalid never
 * retry as transient) and emits only the non-sensitive classification fields.
 */
export function traceClassifiedProviderFault(
  signal: Parameters<typeof classifyProviderFault>[0],
): ProviderFaultClassification {
  const classification = classifyProviderFault(signal);
  console.info('[document-integrations:classify]', JSON.stringify(classification));
  return classification;
}
