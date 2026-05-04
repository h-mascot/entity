import {
  createAgentLogRepository,
  type AgentLogRecord,
  type AgentLogStatus,
  type CreateAgentLogInput,
} from '../../../db/src';
import { AGENT_CONFIG } from './config';

const agentLogRepository = createAgentLogRepository();

export interface AgentStatus extends AgentLogStatus {
  model: string;
  enabled: boolean;
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
  return {
    ...status,
    model: AGENT_CONFIG.model,
    enabled: AGENT_CONFIG.enabled,
  };
}

