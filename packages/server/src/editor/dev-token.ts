import { createAgentTokenRepository, type AgentTokenRepository } from '../../../db/src/agent-tokens';
import { isLoopbackBindHost, isTruthyEnv } from '../middleware/bind-guard';
import { hashToken } from './auth';

export const DEV_DOCUMENTS_TOKEN = 'entity-dev-documents-token';
export const DEV_DOCUMENTS_TOKEN_ACTOR = 'assistant';
export const DEV_DOCUMENTS_TOKEN_SCOPES = [
  'documents:read',
  'documents:comment:write',
  'documents:cursor:write',
  'documents:suggest:write',
] as const;

interface EnsureDevDocumentsTokenOptions {
  tokenRepository?: AgentTokenRepository;
  logger?: Pick<Console, 'log'>;
}

function resolveDevBindHost(): string {
  return process.env.HOST?.trim() || '0.0.0.0';
}

export function shouldProvisionDevDocumentsToken(): boolean {
  if (isTruthyEnv(process.env.ENTITY_DISABLE_DEV_DOCUMENTS_TOKEN)) {
    return false;
  }

  if (process.env.ENTITY_API_TOKEN?.trim()) {
    return false;
  }

  return isLoopbackBindHost(resolveDevBindHost());
}

export function ensureDevDocumentsToken(options: EnsureDevDocumentsTokenOptions = {}): string | null {
  if (!shouldProvisionDevDocumentsToken()) {
    return null;
  }

  const tokenRepository = options.tokenRepository ?? createAgentTokenRepository();
  tokenRepository.upsertToken({
    id: 'dev-documents-assistant-token',
    token_hash: hashToken(DEV_DOCUMENTS_TOKEN),
    token_type: 'agent',
    actor: DEV_DOCUMENTS_TOKEN_ACTOR,
    scopes: DEV_DOCUMENTS_TOKEN_SCOPES,
    enabled: true,
  });

  options.logger?.log('[Documents] Provisioned local-dev Documents API bearer token.');
  return DEV_DOCUMENTS_TOKEN;
}
