import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, it, vi } from 'vitest';

const dbPaths: string[] = [];

afterEach(async () => {
  try {
    const { getEntityDatabase } = await import('./entity-db');
    getEntityDatabase().close();
  } catch {
    // The database may not have opened when setup failed.
  }
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const dbPath of dbPaths.splice(0)) {
    for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      fs.rmSync(candidate, { force: true });
    }
  }
});

it('never reuses a retired registry agent identity', async () => {
  const dbPath = path.join(os.tmpdir(), `entity-agent-identity-${process.pid}-${randomUUID()}.sqlite`);
  dbPaths.push(dbPath);
  vi.stubEnv('ENTITY_TASK_DB_PATH', dbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', `${dbPath}.missing`);
  const { createAgentRegistryRepository } = await import('./index');
  const agents = createAgentRegistryRepository();

  agents.createAgent({ id: 'mapped-agent', slug: 'mapped-agent', name: 'Mapped Agent', emoji: '🤖' });
  expect(agents.deleteAgent('mapped-agent')).toBe(true);
  expect(() => agents.createAgent({
    id: 'mapped-agent',
    slug: 'replacement-agent',
    name: 'Replacement Agent',
    emoji: '⚠️',
    provider_type: 'remote_http',
    runtime_binding_id: 'attacker-runtime',
    binding_state: 'bound',
  })).toThrow(/retired.*cannot be reused/i);
  expect(agents.getAgent('mapped-agent')).toBeUndefined();
});

it('tombstones retained mappings whose registry agent was deleted before migration', async () => {
  const dbPath = path.join(os.tmpdir(), `entity-agent-stale-mapping-${process.pid}-${randomUUID()}.sqlite`);
  dbPaths.push(dbPath);
  vi.stubEnv('ENTITY_TASK_DB_PATH', dbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', `${dbPath}.missing`);
  const dbModule = await import('./index');
  const { getEntityDatabase } = await import('./entity-db');
  const agents = dbModule.createAgentRegistryRepository();
  const imports = dbModule.createAgentImportRepository();
  agents.createAgent({ id: 'legacy-agent', slug: 'legacy-agent', name: 'Legacy Agent', emoji: '🤖' });
  imports.upsertMapping({
    org_id: 'org-a',
    source: 'legacy-runtime',
    external_id: 'legacy-agent',
    agent_id: 'legacy-agent',
    team_ids: ['team-a'],
    module_ids: [],
    channel_ids: [],
    review_policy: { required: true, human_gate_required: true },
    imported_by_user_id: 'owner-a',
  });
  const database = getEntityDatabase();
  database.prepare('DELETE FROM entity_agents WHERE id = ?').run('legacy-agent');
  database.prepare('DELETE FROM entity_agent_id_tombstones WHERE agent_id = ?').run('legacy-agent');
  database.close();

  vi.resetModules();
  const migrated = await import('./index');
  migrated.createAgentImportRepository();
  const migratedAgents = migrated.createAgentRegistryRepository();
  expect(() => migratedAgents.createAgent({
    id: 'legacy-agent',
    slug: 'replacement-legacy-agent',
    name: 'Replacement Legacy Agent',
    emoji: '⚠️',
  })).toThrow(/retired.*cannot be reused/i);
});

it('does not recreate a retired default agent during startup seeding', async () => {
  const dbPath = path.join(os.tmpdir(), `entity-agent-default-identity-${process.pid}-${randomUUID()}.sqlite`);
  dbPaths.push(dbPath);
  vi.stubEnv('ENTITY_TASK_DB_PATH', dbPath);
  vi.stubEnv('MISSION_CONTROL_DB_PATH', `${dbPath}.missing`);
  const dbModule = await import('./index');
  const { getEntityDatabase } = await import('./entity-db');
  const agents = dbModule.createAgentRegistryRepository();
  const imports = dbModule.createAgentImportRepository();
  expect(agents.getAgent('assistant')).toBeDefined();
  imports.upsertMapping({
    org_id: 'org-a',
    source: 'default-runtime',
    external_id: 'assistant',
    agent_id: 'assistant',
    team_ids: ['team-a'],
    module_ids: [],
    channel_ids: [],
    review_policy: { required: true, human_gate_required: true },
    imported_by_user_id: 'owner-a',
  });
  const database = getEntityDatabase();
  database.prepare('DELETE FROM entity_agents WHERE id = ?').run('assistant');
  database.prepare('DELETE FROM entity_agent_id_tombstones WHERE agent_id = ?').run('assistant');
  database.close();

  vi.resetModules();
  const restarted = await import('./index');
  expect(restarted.createAgentRegistryRepository().getAgent('assistant')).toBeUndefined();
  expect(restarted.createAgentImportRepository().getMapping('org-a', 'default-runtime', 'assistant'))
    .toMatchObject({ agent_id: 'assistant' });
});
