import { randomBytes } from 'crypto';
import { createAgentTokenRepository, type AgentTokenRepository } from '../../../db/src/agent-tokens';
import { isLoopbackBindHost, isTruthyEnv } from '../middleware/bind-guard';
import { hashToken } from './auth';

const LEGACY_DEV_DOCUMENTS_TOKEN = 'entity-dev-documents-token';
const LEGACY_DEV_DOCUMENTS_TOKEN_ID = 'dev-documents-assistant-token';
const DEV_DOCUMENTS_TOKEN_ID = 'dev-documents-token';
const DEV_DOCUMENTS_TOKEN_BYTES = 32;

export const DEV_DOCUMENTS_TOKEN_ACTOR = '__dev_documents__';
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

interface RevokeDevDocumentsTokenOptions {
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

export function revokeDevDocumentsToken(options: RevokeDevDocumentsTokenOptions = {}): boolean {
  const tokenRepository = options.tokenRepository ?? createAgentTokenRepository();
  const idsToDelete = new Set<string>();

  const currentDevToken = tokenRepository.getTokenByTypeAndActor('agent', DEV_DOCUMENTS_TOKEN_ACTOR);
  if (currentDevToken) {
    idsToDelete.add(currentDevToken.id);
  }

  const legacyTokenById = tokenRepository.getTokenById(LEGACY_DEV_DOCUMENTS_TOKEN_ID);
  if (legacyTokenById) {
    idsToDelete.add(legacyTokenById.id);
  }

  const legacyTokenByHash = tokenRepository.getAgentTokenByHash(hashToken(LEGACY_DEV_DOCUMENTS_TOKEN), true);
  if (legacyTokenByHash) {
    idsToDelete.add(legacyTokenByHash.id);
  }

  let revoked = false;
  for (const id of idsToDelete) {
    revoked = tokenRepository.deleteToken(id) || revoked;
  }

  if (revoked) {
    options.logger?.log('[Documents] Revoked local-dev Documents API bearer token.');
  }

  return revoked;
}

export function ensureDevDocumentsToken(options: EnsureDevDocumentsTokenOptions = {}): string | null {
  if (!shouldProvisionDevDocumentsToken()) {
    revokeDevDocumentsToken(options);
    return null;
  }

  const tokenRepository = options.tokenRepository ?? createAgentTokenRepository();
  revokeDevDocumentsToken({ tokenRepository });
  const token = randomBytes(DEV_DOCUMENTS_TOKEN_BYTES).toString('hex');
  tokenRepository.upsertToken({
    id: DEV_DOCUMENTS_TOKEN_ID,
    token_hash: hashToken(token),
    token_type: 'agent',
    actor: DEV_DOCUMENTS_TOKEN_ACTOR,
    scopes: DEV_DOCUMENTS_TOKEN_SCOPES,
    enabled: true,
  });

  options.logger?.log('[Documents] Provisioned local-dev Documents API bearer token.');
  return token;
}
