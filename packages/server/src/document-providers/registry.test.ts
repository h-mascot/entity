import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  type DocumentObjectRecord,
  type DocumentProvider,
} from '../../../db/src/document-integrations';
import type { DocumentRegistry, RegistryWriteInput } from './registry';

/**
 * T-004 — Implement Document Registry.
 *
 * Centralizes canonical document identity (R-001 registry surface) at the
 * packages/server/src/document-providers/registry.ts boundary, composing the T-003
 * persistence primitives from packages/db/src/document-integrations.ts.
 *
 * Scope: create / register / get / update / rediscover.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md
 *   - R-001 "Canonical document object" (acceptance criteria + validation)
 *   - T-004 "Implement Document Registry":
 *       Acceptance: Rediscovery does not duplicate.
 *       Security: workspace isolation.
 *       Not done until: concurrent registration test passes.
 *
 * Security note: every read is scoped by workspace. The T-003 db identity lookup is
 * workspace-blind by design (PRD 11.1 defines (provider_connection_id, external_id)
 * uniqueness globally, not per-workspace), so THIS registry layer is where isolation
 * is enforced: a read/register/update for workspace A must never return or mutate a
 * document owned by workspace B.
 *
 * Concurrency note (honest naming): better-sqlite3 is synchronous and single-connection,
 * so this suite exercises SERIALIZED duplicate/concurrent-style registration convergence —
 * two or more registration attempts for the same provider identity executed back-to-back
 * must converge to a single canonical record. It is NOT true OS-thread interleaving
 * coverage (which the synchronous driver cannot provide). See the "duplicate-registration
 * convergence" describe block.
 */

/** A canonical input shape reused across the suite. Reuses the T-003 db input vocabulary. */
function baseInput(overrides: Partial<RegistryWriteInput> = {}): RegistryWriteInput {
  return {
    provider: 'google_workspace',
    artifact_type: 'document',
    title: 'Sample Doc',
    external_id: 'goog-doc-sample-1',
    provider_url: 'https://example.test/d/sample-1',
    owner_summary: 'owner:acct',
    tenant_external_id: 'tenant-1',
    permissions_summary_json: '{"canEdit":true}',
    sensitivity_label: 'internal',
    auth_state: 'authorized',
    readiness_state: 'ready',
    current_revision: 'rev-1',
    indexed_at: '2026-08-18T00:00:00.000Z',
    conflict_state: 'none',
    preview_state: 'ready',
    ...overrides,
  };
}

const openDatabases: Database.Database[] = [];

function openFreshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  openDatabases.push(db);
  return db;
}

afterEach(() => {
  for (const db of openDatabases.splice(0)) {
    db.close();
  }
});

async function openRegistry(): Promise<{
  db: Database.Database;
  registry: import('./registry').DocumentRegistry;
  repo: import('../../../db/src/document-integrations').DocumentIntegrationsRepository;
}> {
  const db = openFreshDb();
  const { createDocumentRegistry } = await import('./registry');
  const { createDocumentIntegrationsRepository } = await import(
    '../../../db/src/document-integrations'
  );
  const repo = createDocumentIntegrationsRepository(db);
  repo.ensureSchema();
  const registry = createDocumentRegistry(db);
  return { db, registry, repo };
}

function countRows(
  db: Database.Database,
  predicate: (r: DocumentObjectRecord) => boolean,
): number {
  const rows = db.prepare('SELECT * FROM document_objects').all() as DocumentObjectRecord[];
  return rows.filter(predicate).length;
}

describe('T-004 document registry — register / rediscovery', () => {
  it('register creates a canonical record in the caller workspace (R-001 create path)', async () => {
    const { registry, db } = await openRegistry();
    const result = registry.register(baseInput(), 'workspace-a');
    expect(result.created).toBe(true);
    expect(result.record.id).toMatch(/^doc_/);
    expect(result.record.workspace_id).toBe('workspace-a');
    expect(result.record.title).toBe('Sample Doc');

    const rows = db.prepare('SELECT * FROM document_objects').all();
    expect(rows).toHaveLength(1);
  });

  it('rediscovery converges to the SAME canonical record, never a duplicate (R-001 acceptance)', async () => {
    const { registry, db } = await openRegistry();

    const first = registry.rediscover(baseInput(), 'workspace-a');
    expect(first.created).toBe(true);

    // Rediscover with a title/state change — the external provider identity is unchanged.
    const second = registry.rediscover(
      baseInput({ title: 'Renamed', current_revision: 'rev-2', readiness_state: 'degraded' }),
      'workspace-a',
    );

    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.title).toBe('Renamed');
    expect(second.record.current_revision).toBe('rev-2');
    // Exactly one canonical document row exists for this identity — no duplicate.
    expect(countRows(db, (r) => r.external_id === 'goog-doc-sample-1')).toBe(1);
  });

  it('register is idempotent and converges to a single canonical id (R-001)', async () => {
    const { registry, db } = await openRegistry();
    const a = registry.register(baseInput(), 'workspace-a');
    const b = registry.register(baseInput(), 'workspace-a');
    expect(b.created).toBe(false);
    expect(b.record.id).toBe(a.record.id);
    expect(countRows(db, () => true)).toBe(1);
  });

  it('the canonical id is stable and deterministic across first create and rediscovery', async () => {
    const { registry } = await openRegistry();
    const a = registry.register(baseInput(), 'workspace-a');
    const b = registry.register(baseInput(), 'workspace-a');
    const c = registry.rediscover(baseInput(), 'workspace-a');
    expect(new Set([a.record.id, b.record.id, c.record.id]).size).toBe(1);
  });

  it('NULL-connection provider identity converges to a single canonical record (R-001 / T-003 F1)', async () => {
    const { registry, db } = await openRegistry();
    const input = baseInput({ provider_connection_id: null, provider: 'local_office' as DocumentProvider });
    const a = registry.register(input, 'workspace-a');
    const b = registry.register(input, 'workspace-a');
    expect(b.created).toBe(false);
    expect(b.record.id).toBe(a.record.id);
    expect(countRows(db, (r) => r.external_id === 'goog-doc-sample-1')).toBe(1);
  });
});

describe('T-004 document registry — workspace isolation (security)', () => {
  it('get scoped by workspace never returns another workspace\'s document (negative)', async () => {
    const { registry } = await openRegistry();
    const created = registry.register(baseInput(), 'workspace-a');
    // Same id, different workspace → must not be visible.
    expect(registry.get(created.record.id, 'workspace-a')).toBeTruthy();
    expect(registry.get(created.record.id, 'workspace-b')).toBeUndefined();
    // Unknown id in any workspace → undefined.
    expect(registry.get('doc_does_not_exist', 'workspace-a')).toBeUndefined();
  });

  it('findByProviderIdentity is workspace-scoped and never leaks a cross-workspace record (negative)', async () => {
    const { registry } = await openRegistry();
    registry.register(baseInput(), 'workspace-a');
    expect(registry.findByProviderIdentity(null, 'goog-doc-sample-1', 'workspace-a')).toBeTruthy();
    expect(registry.findByProviderIdentity(null, 'goog-doc-sample-1', 'workspace-b')).toBeUndefined();
  });

  it('register for an identity owned by another workspace FAILS CLOSED (negative)', async () => {
    const { registry } = await openRegistry();
    const owned = registry.register(baseInput(), 'workspace-a');
    const originalTitle = owned.record.title;

    let threw = false;
    try {
      registry.register(baseInput({ title: 'Hijack attempt' }), 'workspace-b');
    } catch (err) {
      threw = true;
      expect((err as Error).name).toBe('DocumentRegistryIsolationError');
    }
    expect(threw).toBe(true);
    // The owner's record is untouched — never mutated by a cross-workspace caller.
    const after = registry.get(owned.record.id, 'workspace-a');
    expect(after?.title).toBe(originalTitle);
  });

  it('rediscover for an identity owned by another workspace FAILS CLOSED (negative)', async () => {
    const { registry } = await openRegistry();
    const owned = registry.register(baseInput(), 'workspace-a');
    expect(() => registry.rediscover(baseInput({ title: 'x' }), 'workspace-b')).toThrowError(
      /DocumentRegistryIsolationError|different workspace/i,
    );
    expect(registry.get(owned.record.id, 'workspace-a')?.title).toBe('Sample Doc');
  });

  it('strict create throws on any existing identity, including a cross-workspace owner (negative)', async () => {
    const { registry } = await openRegistry();
    registry.register(baseInput(), 'workspace-a');
    // Strict create of the same identity anywhere → throws (identity is globally owned).
    expect(() => registry.create(baseInput(), 'workspace-a')).toThrowError(/already exists/i);
    expect(() => registry.create(baseInput(), 'workspace-b')).toThrowError(/already exists/i);
  });
});

describe('T-004 document registry — update', () => {
  it('update by id is workspace-scoped and never mutates another workspace\'s record (negative)', async () => {
    const { registry } = await openRegistry();
    const created = registry.register(baseInput(), 'workspace-a');

    const sameWs = registry.update(created.record.id, 'workspace-a', { title: 'Updated Title' });
    expect(sameWs?.title).toBe('Updated Title');
    expect(registry.get(created.record.id, 'workspace-a')?.title).toBe('Updated Title');

    // Cross-workspace update → no-op (undefined), owner untouched.
    const crossWs = registry.update(created.record.id, 'workspace-b', { title: 'Hijack' });
    expect(crossWs).toBeUndefined();
    expect(registry.get(created.record.id, 'workspace-a')?.title).toBe('Updated Title');

    // Unknown id → undefined.
    expect(registry.update('doc_missing', 'workspace-a', { title: 'x' })).toBeUndefined();
  });

  it('update preserves state for omitted fields (COALESCE semantics, R-001 no-clobber)', async () => {
    const { registry } = await openRegistry();
    const created = registry.register(
      baseInput({ preview_state: 'ready', conflict_state: 'detected' }),
      'workspace-a',
    );
    // Field-omitting update must not reset preview/conflict state (mirrors T-003 F2).
    const updated = registry.update(created.record.id, 'workspace-a', { title: 'New' });
    expect(updated?.preview_state).toBe('ready');
    expect(updated?.conflict_state).toBe('detected');
    expect(updated?.title).toBe('New');
  });

  it('update refreshes updated_at and leaves created_at / workspace / id immutable', async () => {
    const { registry } = await openRegistry();
    const created = registry.register(baseInput(), 'workspace-a');
    await new Promise((r) => setTimeout(r, 5));
    const updated = registry.update(created.record.id, 'workspace-a', { title: 'Later' });
    expect(updated?.id).toBe(created.record.id);
    expect(updated?.workspace_id).toBe('workspace-a');
    expect(updated?.created_at).toBe(created.record.created_at);
    expect(updated?.updated_at).not.toBe(created.record.updated_at);
  });
});

describe('T-004 document registry — duplicate/concurrent-style registration convergence (SERIALIZED)', () => {
  it('many back-to-back duplicate registrations converge to exactly one canonical record', async () => {
    const { registry, db } = await openRegistry();
    const ids = new Set<string>();
    for (let i = 0; i < 25; i += 1) {
      const attempt = registry.register(baseInput(), 'workspace-a');
      ids.add(attempt.record.id);
      expect(attempt.created ? i === 0 : i > 0).toBe(true);
    }
    expect(ids.size).toBe(1);
    expect(countRows(db, (r) => r.external_id === 'goog-doc-sample-1')).toBe(1);
  });

  it('alternating register/rediscover attempts converge to one canonical record', async () => {
    const { registry, db } = await openRegistry();
    const first = registry.register(baseInput({ title: 'T0' }), 'workspace-a');
    let last: import('./registry').RegistryRegistration | undefined;
    for (let i = 0; i < 20; i += 1) {
      last =
        i % 2 === 0
          ? registry.register(baseInput({ title: `T${i}` }), 'workspace-a')
          : registry.rediscover(baseInput({ title: `T${i}` }), 'workspace-a');
    }
    expect(countRows(db, () => true)).toBe(1);
    // Every attempt must resolve to the SAME canonical id as the first registration
    // (the single canonical record) — not a tautology on `last` itself (F6).
    expect(last?.record.id).toBe(first.record.id);
    // The final title reflects the last write, still on the single canonical id.
    expect(registry.get(last!.record.id, 'workspace-a')?.title).toMatch(/^T19$/);
  });
});

describe('T-004 document registry — security / privacy surface', () => {
  it('registry returns only R-001 canonical fields and never a credential column', async () => {
    const { registry, db } = await openRegistry();
    const created = registry.register(baseInput(), 'workspace-a');
    const record = registry.get(created.record.id, 'workspace-a');
    expect(record).toBeTruthy();

    // No column in document_objects can hold a credential/token/secret.
    const cols = db.prepare("PRAGMA table_info('document_objects')").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name.toLowerCase());
    for (const forbidden of ['access_token', 'refresh_token', 'client_secret', 'password', 'api_key', 'secret', 'auth_code', 'token']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('credentials passed nowhere — RegistryWriteInput exposes no credential field (static shape, compile-time)', () => {
    // The privacy guard must introspect the REAL exported write-input type, not a local
    // fixture (F6). If a credential field were ever added to RegistryWriteInput, this
    // assignment would become legal and the @ts-expect-error below would be flagged unused
    // by the strict tsc build gate — a genuine regression that can actually fail.
    // @ts-expect-error RegistryWriteInput must not expose a credential/secret field.
    const withSecret: RegistryWriteInput = { ...baseInput(), clientSecret: 'x' };
    expect(withSecret).toBeDefined();
  });
});

describe('T-004 document registry — review round 1 fixes (F1–F4)', () => {
  it('F1: update can never rewire the provider identity; rediscovery of the original identity still converges', async () => {
    const { registry } = await openRegistry();
    const created = registry.register(baseInput(), 'workspace-a');
    const id = created.record.id;

    // A deliberately-unsafe cast (identity fields are excluded from the update patch type;
    // this exercises the registry/db runtime guard that well-typed callers cannot reach).
    const rewire = { external_id: 'googdoc-REWIRE' } as unknown as Parameters<DocumentRegistry['update']>[2];
    expect(() => registry.update(id, 'workspace-a', rewire)).toThrow(/identity|immutable/i);

    // After the rejected rewire, rediscovery of the original identity must return the SAME
    // canonical record (no divergence, no duplicate) — R-001 / F1 regression.
    const redescovered = registry.rediscover(baseInput({ title: 'Renamed' }), 'workspace-a');
    expect(redescovered.created).toBe(false);
    expect(redescovered.record.id).toBe(id);
  });

  it('F2: explicit null clears a nullable field through the registry update surface; undefined preserves', async () => {
    const { registry } = await openRegistry();
    const created = registry.register(
      baseInput({ readiness_state: 'degraded', degraded_reason_code: 'quota_exceeded' }),
      'workspace-a',
    );
    expect(created.record.degraded_reason_code).toBe('quota_exceeded');

    // A ready document shedding its stale degraded reason must actually clear it.
    const updated = registry.update(created.record.id, 'workspace-a', {
      readiness_state: 'ready',
      degraded_reason_code: null,
    });
    expect(updated?.readiness_state).toBe('ready');
    expect(updated?.degraded_reason_code).toBeNull();

    // Undefined (omitted) preserves the cleared result — never resurrects it.
    const preserved = registry.update(created.record.id, 'workspace-a', { title: 'x' });
    expect(preserved?.degraded_reason_code).toBeNull();
  });

  it('F3: a title-only registry update leaves indexed_at unchanged; explicit indexed_at still applies', async () => {
    const { registry } = await openRegistry();
    const created = registry.register(
      baseInput({ indexed_at: '2026-01-01T00:00:00.000Z' }),
      'workspace-a',
    );
    expect(created.record.indexed_at).toBe('2026-01-01T00:00:00.000Z');

    // Title-only patch must NOT silently stamp "now" on indexed_at (R-029).
    const patched = registry.update(created.record.id, 'workspace-a', { title: 'Renamed' });
    expect(patched?.indexed_at).toBe('2026-01-01T00:00:00.000Z');

    // Explicit indexed_at still applies.
    const explicit = registry.update(created.record.id, 'workspace-a', {
      indexed_at: '2026-03-01T00:00:00.000Z',
    });
    expect(explicit?.indexed_at).toBe('2026-03-01T00:00:00.000Z');
  });

  it('F4: register with a null/empty external_id FAILS CLOSED instead of silently minting duplicates', async () => {
    const { registry, db } = await openRegistry();
    const identityless = baseInput({ external_id: null });

    for (const method of ['register', 'rediscover'] as const) {
      expect(() => registry[method](identityless, 'workspace-a')).toThrow(/external_id.*required|identity.*external_id|validation/i);
    }
    // Nothing was minted — fail-closed means zero rows, not two divergent canonical records.
    expect(countRows(db, () => true)).toBe(0);
  });

  it('F4: register with an empty-string external_id also fails closed', async () => {
    const { registry } = await openRegistry();
    const identityless = baseInput({ external_id: '' });
    expect(() => registry.register(identityless, 'workspace-a')).toThrow(/external_id.*required|identity.*external_id|validation/i);
    expect(() => registry.rediscover(identityless, 'workspace-a')).toThrow(/external_id.*required|identity.*external_id|validation/i);
  });
});
