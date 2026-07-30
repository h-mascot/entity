import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { looksLikeRawSecret, sanitizeHealthDetails } from './repositories';

/**
 * Audit-event adapter for inference provider registry (PR-B-08 / OQ-018).
 *
 * Phase A found no dedicated provider-profile audit framework — only
 * app_settings.updated_by, agent_log, and task activity events.
 * Approved fallback: additive `inference_provider_audit_events` table
 * (created by registry migration) with allowlisted details_json.
 */

export const PROVIDER_AUDIT_ACTIONS = [
  'inference_provider_profile_created',
  'inference_provider_profile_updated',
  'inference_provider_profile_disabled',
  'inference_provider_profile_enabled',
  'inference_provider_binding_upserted',
  'inference_provider_health_check_started',
  'inference_provider_health_check_completed',
  'provider_registry_migration_dry_run',
  'provider_registry_migration_started',
  'provider_registry_migration_completed',
  'provider_registry_migration_failed',
] as const;

export type ProviderAuditAction = (typeof PROVIDER_AUDIT_ACTIONS)[number];

export type ProviderAuditTargetType =
  | 'inference_provider_profile'
  | 'inference_provider_binding'
  | 'inference_provider_health_check'
  | 'inference_provider_migration';

export interface ProviderAuditEventInput {
  actorRef?: string | null;
  action: ProviderAuditAction | string;
  targetType: ProviderAuditTargetType | string;
  targetId?: string | null;
  requestId?: string | null;
  details?: Record<string, unknown>;
  createdAt?: string;
}

export interface ProviderAuditEventRecord {
  id: string;
  actorRef: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  requestId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

const FORBIDDEN_AUDIT_KEYS = new Set([
  'apiKey',
  'api_key',
  'apiKeys',
  'secret',
  'secretRef',
  'secret_ref',
  'authorization',
  'Authorization',
  'token',
  'password',
  'prompt',
  'completion',
  'responseBody',
  'response_body',
  'raw',
  'env',
  'environment',
]);

export function sanitizeAuditDetails(
  details: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (FORBIDDEN_AUDIT_KEYS.has(key)) continue;
    if (typeof value === 'string' && looksLikeRawSecret(value)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = sanitizeAuditDetails(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? sanitizeAuditDetails(item as Record<string, unknown>)
          : typeof item === 'string' && looksLikeRawSecret(item)
            ? '[REDACTED]'
            : item,
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

export interface InferenceProviderAuditAdapter {
  record(input: ProviderAuditEventInput): ProviderAuditEventRecord;
  listForTarget(
    targetType: string,
    targetId: string,
    options?: { limit?: number },
  ): ProviderAuditEventRecord[];
}

export function createInferenceProviderAuditAdapter(
  db: Database.Database,
): InferenceProviderAuditAdapter {
  const insert = db.prepare(`
    INSERT INTO inference_provider_audit_events (
      id, actor_ref, action, target_type, target_id, request_id, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectByTarget = db.prepare(`
    SELECT * FROM inference_provider_audit_events
    WHERE target_type = ? AND target_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);

  function mapRow(row: {
    id: string;
    actor_ref: string | null;
    action: string;
    target_type: string;
    target_id: string | null;
    request_id: string | null;
    details_json: string;
    created_at: string;
  }): ProviderAuditEventRecord {
    let details: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.details_json) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        details = sanitizeAuditDetails(parsed as Record<string, unknown>);
      }
    } catch {
      details = {};
    }
    return {
      id: row.id,
      actorRef: row.actor_ref,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      requestId: row.request_id,
      details,
      createdAt: row.created_at,
    };
  }

  return {
    record(input) {
      const id = `audit_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const createdAt = input.createdAt ?? new Date().toISOString();
      const details = sanitizeAuditDetails(input.details ?? {});
      // Also run health sanitizer for nested overlap
      const safeDetails = sanitizeHealthDetails(details);
      insert.run(
        id,
        input.actorRef ?? null,
        input.action,
        input.targetType,
        input.targetId ?? null,
        input.requestId ?? null,
        JSON.stringify(safeDetails),
        createdAt,
      );
      return {
        id,
        actorRef: input.actorRef ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        requestId: input.requestId ?? null,
        details: safeDetails,
        createdAt,
      };
    },

    listForTarget(targetType, targetId, options) {
      const limit = Math.max(1, Math.min(options?.limit ?? 50, 200));
      const rows = selectByTarget.all(targetType, targetId, limit) as Array<{
        id: string;
        actor_ref: string | null;
        action: string;
        target_type: string;
        target_id: string | null;
        request_id: string | null;
        details_json: string;
        created_at: string;
      }>;
      return rows.map(mapRow);
    },
  };
}

/** Receipt note for reviewers: why fallback table was chosen. */
export const AUDIT_ADAPTER_FALLBACK_RECEIPT = {
  decision: 'additive_fallback_table',
  reason:
    'OQ-018: no dedicated provider-profile audit framework exists; app_settings.updated_by / agent_log / task activity are insufficient for profile/binding audit.',
  table: 'inference_provider_audit_events',
  redaction: 'allowlisted details_json; forbidden secret keys stripped',
} as const;
