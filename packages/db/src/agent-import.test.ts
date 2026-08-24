import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dbPaths: string[] = [];

async function loadRepository() {
  const dbPath = path.join(os.tmpdir(), `entity-agent-import-${process.pid}-${randomUUID()}.sqlite`);
  dbPaths.push(dbPath);
  vi.resetModules();
  vi.stubEnv('ENTITY_TASK_DB_PATH', dbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', `${dbPath}.missing`);
  const module = await import('./agent-import');
  return module.createAgentImportRepository();
}

afterEach(async () => {
  try {
    const { getEntityDatabase } = await import('./entity-db');
    getEntityDatabase().close();
  } catch {
    // Missing implementation is expected during the red phase.
  }
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const dbPath of dbPaths.splice(0)) {
    for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      fs.rmSync(candidate, { force: true });
    }
  }
});

describe('agent import repository', () => {
  it('stores organization-scoped identity, team, capability, channel, and review mappings', async () => {
    const repo = await loadRepository();
    const mapping = repo.upsertMapping({
      org_id: 'org-a',
      source: 'runtime-fleet',
      external_id: 'agent-42',
      agent_id: 'entity-agent-42',
      source_agent_id: 'runtime-agent-42',
      team_ids: ['team-b', 'team-a', 'team-a'],
      module_ids: ['mission-control', 'docs'],
      channel_ids: ['operations'],
      review_policy: { required: true, human_gate_required: true },
      imported_by_user_id: 'owner-1',
    });

    expect(mapping).toMatchObject({
      org_id: 'org-a',
      source: 'runtime-fleet',
      external_id: 'agent-42',
      agent_id: 'entity-agent-42',
      source_agent_id: 'runtime-agent-42',
      team_ids: ['team-a', 'team-b'],
      module_ids: ['docs', 'mission-control'],
      channel_ids: ['operations'],
      review_policy: { required: true, human_gate_required: true },
    });
    expect(repo.listMappings('org-b')).toEqual([]);
    expect(repo.getMapping('org-a', 'runtime-fleet', 'agent-42')).toEqual(mapping);
    expect(repo.getMappingByAgent('entity-agent-42')).toEqual(mapping);
    expect(() => repo.upsertMapping({
      org_id: 'org-b',
      source: 'another-fleet',
      external_id: 'same-agent',
      agent_id: 'entity-agent-42',
      source_agent_id: 'runtime-agent-42',
      team_ids: [],
      module_ids: [],
      channel_ids: [],
      review_policy: { required: false, human_gate_required: false },
      imported_by_user_id: 'owner-2',
    })).toThrow(/unique/i);
  });

  it('updates one stable external identity without creating duplicates', async () => {
    const repo = await loadRepository();
    const original = repo.upsertMapping({
      org_id: 'org-a',
      source: 'runtime-fleet',
      external_id: 'agent-42',
      agent_id: 'entity-agent-42',
      source_agent_id: 'runtime-agent-42',
      team_ids: ['team-a'],
      module_ids: [],
      channel_ids: [],
      review_policy: { required: false, human_gate_required: false },
      imported_by_user_id: 'owner-1',
    });
    const updated = repo.upsertMapping({
      org_id: 'org-a',
      source: 'runtime-fleet',
      external_id: 'agent-42',
      agent_id: 'entity-agent-42',
      source_agent_id: 'runtime-agent-42',
      team_ids: ['team-b'],
      module_ids: ['docs'],
      channel_ids: ['operations'],
      review_policy: { required: true, human_gate_required: false },
      imported_by_user_id: 'owner-1',
    });

    expect(updated.id).toBe(original.id);
    expect(repo.listMappings('org-a')).toHaveLength(1);
    expect(updated.team_ids).toEqual(['team-b']);
    expect(updated.source_agent_id).toBe('runtime-agent-42');
  });

  it('records immutable replay-safe receipts and rolls back mappings with failed work', async () => {
    const repo = await loadRepository();
    let calls = 0;
    const first = repo.importBatch({
      org_id: 'org-a',
      idempotency_key: 'import-1',
      input_hash: 'hash-a',
      actor_user_id: 'owner-1',
    }, () => {
      calls += 1;
      repo.upsertMapping({
        org_id: 'org-a',
        source: 'runtime-fleet',
        external_id: 'agent-42',
        agent_id: 'entity-agent-42',
        team_ids: ['team-a'],
        module_ids: [],
        channel_ids: [],
        review_policy: { required: false, human_gate_required: false },
        imported_by_user_id: 'owner-1',
      });
      return { receipt: { imported: ['entity-agent-42'] } };
    });
    const replay = repo.importBatch({
      org_id: 'org-a',
      idempotency_key: 'import-1',
      input_hash: 'hash-a',
      actor_user_id: 'owner-1',
    }, () => {
      calls += 1;
      return { receipt: { imported: ['should-not-run'] } };
    });

    expect(replay).toEqual(first);
    expect(repo.getLatestReceipt('org-a')).toEqual(first);
    expect(calls).toBe(1);
    expect(() => repo.importBatch({
      org_id: 'org-a',
      idempotency_key: 'import-1',
      input_hash: 'different-hash',
      actor_user_id: 'owner-1',
    }, () => ({ receipt: {} }))).toThrow(/idempotency/i);

    expect(() => repo.importBatch({
      org_id: 'org-a',
      idempotency_key: 'import-failure',
      input_hash: 'hash-failure',
      actor_user_id: 'owner-1',
    }, () => {
      repo.upsertMapping({
        org_id: 'org-a',
        source: 'runtime-fleet',
        external_id: 'rolled-back',
        agent_id: 'rolled-back',
        team_ids: [],
        module_ids: [],
        channel_ids: [],
        review_policy: { required: false, human_gate_required: false },
        imported_by_user_id: 'owner-1',
      });
      throw new Error('import exploded');
    })).toThrow('import exploded');
    expect(repo.getMapping('org-a', 'runtime-fleet', 'rolled-back')).toBeUndefined();
    expect(repo.getReceiptByIdempotencyKey('org-a', 'import-failure')).toBeUndefined();
  });
});
