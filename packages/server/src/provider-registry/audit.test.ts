import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AUDIT_ADAPTER_FALLBACK_RECEIPT,
  createInferenceProviderAuditAdapter,
  sanitizeAuditDetails,
} from './audit';
import { runInferenceProviderMigrations } from './migrations';
import { createProfileRepository } from './repositories';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

describe('provider audit adapter (PR-B-08)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runInferenceProviderMigrations({ db, logger: silentLogger });
  });

  afterEach(() => {
    db.close();
  });

  it('records allowlisted audit details and strips secrets', () => {
    const profiles = createProfileRepository(db);
    const profile = profiles.create({
      name: 'audited',
      displayLabel: 'Audited',
      providerKind: 'google',
      authMode: 'env_ref',
      secretRef: 'GOOGLE_GENERATIVE_AI_API_KEY',
    });

    const audit = createInferenceProviderAuditAdapter(db);
    const event = audit.record({
      actorRef: 'admin',
      action: 'inference_provider_profile_created',
      targetType: 'inference_provider_profile',
      targetId: profile.id,
      requestId: 'req_audit_1',
      details: {
        providerKind: profile.providerKind,
        apiKey: 'sk-should-not-appear',
        secretRef: profile.secretRef,
        authorization: 'Bearer tok',
        name: profile.name,
      },
    });

    expect(event.details).toEqual({
      providerKind: 'google',
      name: 'audited',
    });
    expect(JSON.stringify(event)).not.toContain('sk-should');
    expect(JSON.stringify(event)).not.toContain('GOOGLE_GENERATIVE_AI_API_KEY');

    const listed = audit.listForTarget('inference_provider_profile', profile.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.action).toBe('inference_provider_profile_created');
  });

  it('documents approved fallback decision', () => {
    expect(AUDIT_ADAPTER_FALLBACK_RECEIPT.decision).toBe('additive_fallback_table');
    expect(AUDIT_ADAPTER_FALLBACK_RECEIPT.table).toBe('inference_provider_audit_events');
  });

  it('sanitizes nested secret-like values', () => {
    const cleaned = sanitizeAuditDetails({
      nested: { token: 'abc', ok: true },
      prompt: 'user said hi',
      latencyMs: 12,
    });
    expect(cleaned).toEqual({ nested: { ok: true }, latencyMs: 12 });
  });
});
