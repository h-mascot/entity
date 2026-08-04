/**
 * Admin agent invite settings + revoke audit (THE-887 / WP2-B-06).
 *
 * GET   /api/agents/admin-settings
 * PATCH /api/agents/admin-settings
 * GET   /api/agents/admin-settings/audit
 */

import type { Express, Request, Response } from 'express';
import {
  getAgentInviteAdminSettings,
  updateAgentInviteAdminSettings,
  type UpdateAgentInviteAdminSettingsInput,
} from '../agent/invite-kit/admin-settings';
import {
  getInviteAuditStore,
  type InviteAuditStore,
} from '../agent/invite-kit/audit-store';

export interface RegisterAgentAdminSettingsRoutesDeps {
  auditStore?: InviteAuditStore;
  getSettings?: typeof getAgentInviteAdminSettings;
  updateSettings?: typeof updateAgentInviteAdminSettings;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function readPositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.floor(value);
}

function parsePatchBody(body: unknown): UpdateAgentInviteAdminSettingsInput {
  const input = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  return {
    defaultTtlMs: readPositiveInt(input.defaultTtlMs) ?? readPositiveInt(input.default_ttl_ms),
    minTtlMs: readPositiveInt(input.minTtlMs) ?? readPositiveInt(input.min_ttl_ms),
    maxTtlMs: readPositiveInt(input.maxTtlMs) ?? readPositiveInt(input.max_ttl_ms),
    allowedModules: readStringArray(input.allowedModules) ?? readStringArray(input.allowed_modules),
    defaultModules: readStringArray(input.defaultModules) ?? readStringArray(input.default_modules),
    updatedBy: readString(input.updatedBy) ?? readString(input.updated_by) ?? 'admin-ui',
  };
}

/** Fail closed if response JSON accidentally includes secret-bearing keys. */
function assertNoSecrets(payload: unknown): void {
  const raw = JSON.stringify(payload);
  if (/"token"\s*:|"apiKey"\s*:|"api_key"\s*:|"password"\s*:|"secret"\s*:|"authorization"\s*:|"previousTokenHash"\s*:|"tokenHash"\s*:/i.test(raw)) {
    throw new Error('Admin settings response must not include secrets');
  }
}

export function registerAgentAdminSettingsRoutes(
  app: Express,
  deps: RegisterAgentAdminSettingsRoutesDeps = {},
): void {
  const auditStore = deps.auditStore ?? getInviteAuditStore();
  const getSettings = deps.getSettings ?? getAgentInviteAdminSettings;
  const updateSettings = deps.updateSettings ?? updateAgentInviteAdminSettings;
  auditStore.ensureSchema();

  app.get('/api/agents/admin-settings', (_req: Request, res: Response) => {
    try {
      const settings = getSettings();
      assertNoSecrets(settings);
      res.json(settings);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
        code: 'settings_read_failed',
      });
    }
  });

  app.patch('/api/agents/admin-settings', (req: Request, res: Response) => {
    try {
      const patch = parsePatchBody(req.body);
      const settings = updateSettings(patch);
      auditStore.append({
        inviteId: null,
        eventType: 'settings_updated',
        actorId: patch.updatedBy ?? 'admin-ui',
        detail: [
          `defaultTtlMs=${settings.defaultTtlMs}`,
          `minTtlMs=${settings.minTtlMs}`,
          `maxTtlMs=${settings.maxTtlMs}`,
          `allowed=${settings.allowedModules.join(',')}`,
          `defaults=${settings.defaultModules.join(',')}`,
        ].join('; '),
      });
      assertNoSecrets(settings);
      res.json(settings);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error),
        code: 'invalid_settings',
      });
    }
  });

  app.get('/api/agents/admin-settings/audit', (req: Request, res: Response) => {
    try {
      const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      const inviteId = typeof req.query.inviteId === 'string' ? req.query.inviteId.trim() : undefined;
      const events = auditStore.list({
        limit: typeof limitRaw === 'number' && Number.isFinite(limitRaw) ? limitRaw : 50,
        inviteId: inviteId || undefined,
      });
      assertNoSecrets(events);
      res.json({ events, count: events.length });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
        code: 'audit_read_failed',
      });
    }
  });
}
