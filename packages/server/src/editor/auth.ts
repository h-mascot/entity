import { createHash } from 'crypto';
import type { Request, RequestHandler, Response } from 'express';
import {
  createAgentTokenRepository,
  normalizeRequiredScopes,
  tokenMissingScopes,
  type AgentTokenRecord,
  type AgentTokenRepository,
} from '../../../db/src/agent-tokens';

export interface EditorActorIdentity {
  actorId: string;
  tokenType: 'agent' | 'service';
  scopes: string[];
}

export interface EditorRouteAuth {
  requireScopes: (scopes: readonly string[]) => RequestHandler;
  getActorIdentity: (req: Request) => EditorActorIdentity | null;
  knownActorIds: readonly string[];
}

export interface CreateEditorRouteAuthOptions {
  tokenRepository?: AgentTokenRepository;
  knownActorIds?: readonly string[];
}

const AUTHORIZATION_BEARER_PATTERN = /^Bearer\s+(.+)$/i;
const SERVICE_ACTOR_HEADER = 'x-entity-actor';
const DEFAULT_KNOWN_ACTOR_IDS = ['assistant'] as const;
const KNOWN_ACTORS_ENV_KEY = 'ENTITY_AGENT_NATIVE_EDITOR_KNOWN_ACTORS';
const OPTIONAL_KNOWN_ACTOR_ENV: Record<string, string> = {
  henry: 'ENTITY_AGENT_NATIVE_EDITOR_ENABLE_HENRY_ACTOR',
  'system-reviewer': 'ENTITY_AGENT_NATIVE_EDITOR_ENABLE_SYSTEM_REVIEWER_ACTOR',
};
const EDITOR_ACTOR_IDENTITY = Symbol('editorActorIdentity');

interface EditorActorRequest extends Request {
  [EDITOR_ACTOR_IDENTITY]?: EditorActorIdentity;
}

interface AuthErrorBody {
  code: string;
  error: string;
  missingScopes?: string[];
}

function normalizeBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (typeof value === 'undefined') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return fallback;
}

function normalizeActorId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized ? normalized : null;
}

function parseKnownActors(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  const normalized = value
    .split(',')
    .map((entry) => normalizeActorId(entry))
    .filter((entry): entry is string => Boolean(entry));

  return Array.from(new Set(normalized));
}

function resolveKnownActorIds(configuredActorIds: readonly string[] | undefined): string[] {
  if (configuredActorIds && configuredActorIds.length > 0) {
    const normalized = configuredActorIds
      .map((entry) => normalizeActorId(entry))
      .filter((entry): entry is string => Boolean(entry));
    return Array.from(new Set(normalized));
  }

  const known = new Set<string>(DEFAULT_KNOWN_ACTOR_IDS);
  for (const [actorId, envKey] of Object.entries(OPTIONAL_KNOWN_ACTOR_ENV)) {
    if (normalizeBooleanFlag(process.env[envKey], false)) {
      known.add(actorId);
    }
  }

  for (const actorId of parseKnownActors(process.env[KNOWN_ACTORS_ENV_KEY])) {
    known.add(actorId);
  }

  return Array.from(known.values());
}

function parseBearerToken(req: Request): string | null {
  const headerValue = req.header('authorization');
  if (typeof headerValue !== 'string') {
    return null;
  }

  const match = AUTHORIZATION_BEARER_PATTERN.exec(headerValue.trim());
  if (!match) {
    return null;
  }

  const token = match[1].trim();
  return token ? token : null;
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

function sendAuthError(res: Response, status: number, body: AuthErrorBody): void {
  res.status(status).json(body);
}

function resolveActorIdentity(
  req: Request,
  res: Response,
  token: AgentTokenRecord,
  knownActors: ReadonlySet<string>
): EditorActorIdentity | null {
  if (token.token_type === 'agent') {
    const actorId = normalizeActorId(token.actor);
    if (!actorId) {
      sendAuthError(res, 401, {
        code: 'INVALID_TOKEN_ACTOR',
        error: 'Agent token actor is invalid.',
      });
      return null;
    }

    return {
      actorId,
      tokenType: 'agent',
      scopes: [...token.scopes],
    };
  }

  const headerActor = normalizeActorId(req.header(SERVICE_ACTOR_HEADER));
  if (!headerActor) {
    sendAuthError(res, 401, {
      code: 'SERVICE_ACTOR_REQUIRED',
      error: 'Service tokens require X-Entity-Actor.',
    });
    return null;
  }

  if (!knownActors.has(headerActor)) {
    sendAuthError(res, 403, {
      code: 'UNKNOWN_SERVICE_ACTOR',
      error: 'X-Entity-Actor must map to a known actor ID.',
    });
    return null;
  }

  return {
    actorId: headerActor,
    tokenType: 'service',
    scopes: [...token.scopes],
  };
}

export function createEditorRouteAuth(options: CreateEditorRouteAuthOptions = {}): EditorRouteAuth {
  const tokenRepository = options.tokenRepository ?? createAgentTokenRepository();
  const knownActorIds = resolveKnownActorIds(options.knownActorIds);
  const knownActorSet = new Set(knownActorIds);

  const getActorIdentity = (req: Request): EditorActorIdentity | null => {
    return (req as EditorActorRequest)[EDITOR_ACTOR_IDENTITY] ?? null;
  };

  return {
    requireScopes: (scopes: readonly string[]) => {
      const requiredScopes = normalizeRequiredScopes(scopes);

      return (req, res, next) => {
        const rawToken = parseBearerToken(req);
        if (!rawToken) {
          sendAuthError(res, 401, {
            code: 'AUTH_TOKEN_REQUIRED',
            error: 'Authorization bearer token is required.',
          });
          return;
        }

        const tokenHash = hashToken(rawToken);
        const token = tokenRepository.getTokenByHash(tokenHash);
        if (!token) {
          sendAuthError(res, 401, {
            code: 'AUTH_TOKEN_INVALID',
            error: 'Authorization token is invalid or disabled.',
          });
          return;
        }

        const identity = resolveActorIdentity(req, res, token, knownActorSet);
        if (!identity) {
          return;
        }

        const missingScopes = tokenMissingScopes(token, requiredScopes);
        if (missingScopes.length > 0) {
          sendAuthError(res, 403, {
            code: 'AUTH_SCOPE_DENIED',
            error: 'Token is missing required scopes.',
            missingScopes,
          });
          return;
        }

        (req as EditorActorRequest)[EDITOR_ACTOR_IDENTITY] = identity;
        next();
      };
    },
    getActorIdentity,
    knownActorIds,
  };
}
