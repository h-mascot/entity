/**
 * CH-A-04 / THE-920 — Architecture tests: channel adapters never become
 * alternate task truth stores.
 *
 * Success: proposals apply only through host writers; adapter sources clean.
 * Negative/degraded: missing writers fail closed; forbidden methods rejected;
 * poisoned adapter source is detected by the scanner.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createNullChannelAdapter,
  isChannelAdapter,
  normalizeChannelIntakeRaw,
} from './adapter';
import { createSlackReferenceAdapter } from './slack-reference-adapter';
import { createOfflineSlackTransport } from './slack-transport';
import {
  applyChannelIntakeProposals,
  assertChannelAdapterNotTaskTruthStore,
  CHANNEL_ADAPTER_ALLOWED_ROLES,
  CHANNEL_ADAPTER_ALLOWED_SURFACE_KEYS,
  CHANNEL_ADAPTER_FORBIDDEN_TRUTH_METHODS,
  CHANNEL_ADAPTER_PRODUCTION_SOURCE_FILES,
  CHANNEL_HOST_TRUTH_BOUNDARY_FILE,
  CHANNEL_TASK_TRUTH_OWNER,
  collectChannelAdapterTruthStoreMethodViolations,
  scanChannelAdapterSourceForTruthStoreViolations,
} from './task-truth-boundary';

const CHANNELS_DIR = path.resolve(__dirname);

function readChannelSource(fileName: string): string {
  return readFileSync(path.join(CHANNELS_DIR, fileName), 'utf8');
}

describe('CH-A-04 channel adapter task-truth architecture', () => {
  it('declares host_task_service as the sole task truth owner', () => {
    expect(CHANNEL_TASK_TRUTH_OWNER).toBe('host_task_service');
    expect(CHANNEL_ADAPTER_ALLOWED_ROLES).toEqual([
      'intake_proposal',
      'status_notification',
    ]);
    expect(CHANNEL_ADAPTER_ALLOWED_SURFACE_KEYS).toEqual([
      'id',
      'kind',
      'displayName',
      'enabled',
      'getAvailability',
      'parseIntake',
      'notifyStatus',
    ]);
    expect(CHANNEL_ADAPTER_FORBIDDEN_TRUTH_METHODS).toContain('createTask');
    expect(CHANNEL_ADAPTER_FORBIDDEN_TRUTH_METHODS).toContain('persistTask');
  });

  it('lists every production channel .ts file for the architecture scan', () => {
    const productionTs = readdirSync(CHANNELS_DIR)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .sort();
    const expected = [
      ...CHANNEL_ADAPTER_PRODUCTION_SOURCE_FILES,
      CHANNEL_HOST_TRUTH_BOUNDARY_FILE,
    ].sort();
    expect(productionTs).toEqual(expected);
  });

  it('scans adapter production sources with zero truth-store violations (success)', () => {
    const allViolations = [];
    for (const fileName of CHANNEL_ADAPTER_PRODUCTION_SOURCE_FILES) {
      const source = readChannelSource(fileName);
      allViolations.push(
        ...scanChannelAdapterSourceForTruthStoreViolations(source, fileName, 'adapter'),
      );
    }
    expect(allViolations).toEqual([]);
  });

  it('validates the host boundary module declares owner + apply path', () => {
    const source = readChannelSource(CHANNEL_HOST_TRUTH_BOUNDARY_FILE);
    const violations = scanChannelAdapterSourceForTruthStoreViolations(
      source,
      CHANNEL_HOST_TRUTH_BOUNDARY_FILE,
      'host_boundary',
    );
    expect(violations).toEqual([]);
    expect(source).toContain('CHANNEL_TASK_TRUTH_OWNER');
    expect(source).toContain('applyChannelIntakeProposals');
  });

  it('detects poisoned adapter source that writes tasks (negative)', () => {
    const poisoned = `
      import { createTaskRepository } from '../../../db/src';
      import Database from 'better-sqlite3';
      export function evil(raw: unknown) {
        const tasks = createTaskRepository();
        return tasks.createTask({ name: 'from channel' });
      }
    `;
    const violations = scanChannelAdapterSourceForTruthStoreViolations(
      poisoned,
      'evil-adapter.ts',
      'adapter',
    );
    const codes = violations.map((v) => v.code);
    expect(codes).toContain('forbidden_task_repository');
    expect(codes).toContain('forbidden_createTask_call');
    expect(codes).toContain('forbidden_better_sqlite3');
    expect(codes).toContain('forbidden_db_value_import');
  });

  it('allows import type from db but rejects value db imports', () => {
    const typeOnly = `import type { NotificationDeliveryChannel } from '../../../db/src';\n`;
    expect(
      scanChannelAdapterSourceForTruthStoreViolations(typeOnly, 'types.ts', 'adapter'),
    ).toEqual([]);

    const valueImport = `import { createTaskRepository } from '../../../db/src';\n`;
    const violations = scanChannelAdapterSourceForTruthStoreViolations(
      valueImport,
      'bad.ts',
      'adapter',
    );
    expect(violations.some((v) => v.code === 'forbidden_db_value_import')).toBe(true);
  });

  it('rejects adapters that expose forbidden truth-store methods (negative)', () => {
    const base = createNullChannelAdapter({
      id: 'truth-store-smell',
      kind: 'slack',
      enabled: true,
      availability: 'available',
    });
    const poisoned = {
      ...base,
      persistTask: () => ({ id: 1 }),
      createTask: () => ({ id: 1 }),
    };
    const violations = collectChannelAdapterTruthStoreMethodViolations(poisoned);
    expect(violations.map((v) => v.code)).toContain('forbidden_adapter_truth_method');
    expect(() => assertChannelAdapterNotTaskTruthStore(poisoned)).toThrow(
      /channel_adapter_truth_store_forbidden/,
    );
  });

  it('null + Slack reference adapters pass the runtime truth-store guard', () => {
    const nullAdapter = createNullChannelAdapter({
      id: 'ok-null',
      kind: 'webhook',
      enabled: true,
      availability: 'available',
    });
    const slack = createSlackReferenceAdapter({
      featureEnabled: true,
      transport: createOfflineSlackTransport(),
    });
    expect(isChannelAdapter(nullAdapter)).toBe(true);
    expect(isChannelAdapter(slack)).toBe(true);
    expect(() => assertChannelAdapterNotTaskTruthStore(nullAdapter)).not.toThrow();
    expect(() => assertChannelAdapterNotTaskTruthStore(slack)).not.toThrow();
    expect(collectChannelAdapterTruthStoreMethodViolations(nullAdapter)).toEqual([]);
    expect(collectChannelAdapterTruthStoreMethodViolations(slack)).toEqual([]);
  });
});

describe('CH-A-04 host apply path (sole task truth writer)', () => {
  it('applies create_task intake only through injected host writers (success)', async () => {
    const parseResult = normalizeChannelIntakeRaw(
      {
        externalId: 'msg-truth-1',
        title: 'Channel intake must stay host-owned',
        body: 'Proposal only until host applies',
      },
      { adapterId: 'test-slack', kind: 'slack' },
    );
    expect(parseResult.ok).toBe(true);
    if (!parseResult.ok) return;

    const created: Array<{ name: string; origin_channel: string }> = [];
    const activities: Array<{ taskId: number; action: string }> = [];

    const applied = await applyChannelIntakeProposals(parseResult, {
      createTask: (proposal) => {
        created.push({
          name: proposal.name,
          origin_channel: proposal.origin_channel,
        });
        return { id: 501 };
      },
      appendActivity: (taskId, event) => {
        activities.push({ taskId, action: event.action });
      },
    });

    expect(applied).toMatchObject({
      ok: true,
      taskId: 501,
      createdTask: true,
      activityAppended: true,
      truthOwner: 'host_task_service',
    });
    expect(created).toEqual([
      {
        name: 'Channel intake must stay host-owned',
        origin_channel: 'slack:test-slack',
      },
    ]);
    expect(activities).toEqual([{ taskId: 501, action: 'channel_intake' }]);
  });

  it('fails closed when host writers are missing (degraded/negative)', async () => {
    const parseResult = normalizeChannelIntakeRaw(
      {
        externalId: 'msg-no-host',
        title: 'No host',
        body: 'Must not invent persistence',
      },
      { adapterId: 'test', kind: 'webhook' },
    );
    const applied = await applyChannelIntakeProposals(parseResult, null);
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.code).toBe('host_writers_required');
    expect(applied.degraded).toBe(true);
    expect(applied.truthOwner).toBe('host_task_service');
  });

  it('propagates intake parse failures without writing (negative)', async () => {
    const parseResult = normalizeChannelIntakeRaw(
      { title: 'missing external id' },
      { adapterId: 'test', kind: 'slack' },
    );
    let createCalls = 0;
    const applied = await applyChannelIntakeProposals(parseResult, {
      createTask: () => {
        createCalls += 1;
        return { id: 1 };
      },
      appendActivity: () => undefined,
    });
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.code).toBe('missing_external_id');
    expect(createCalls).toBe(0);
  });

  it('Slack reference adapter only proposes; host writers alone create truth', async () => {
    const adapter = createSlackReferenceAdapter({
      featureEnabled: true,
      transport: createOfflineSlackTransport(),
    });
    assertChannelAdapterNotTaskTruthStore(adapter);

    const parseResult = await adapter.parseIntake({
      event: {
        type: 'message',
        ts: '1722441600.000200',
        channel: 'C-truth',
        text: 'Open a host-applied follow-up',
      },
    });
    expect(parseResult.ok).toBe(true);
    if (!parseResult.ok) return;
    expect(parseResult.taskProposal).toBeTruthy();
    expect(parseResult.taskProposal?.origin_channel).toBe('slack:slack-reference');

    // Adapter itself has no persistence side effect — only host apply writes.
    const withoutHost = await applyChannelIntakeProposals(parseResult, undefined);
    expect(withoutHost.ok).toBe(false);
    if (withoutHost.ok) return;
    expect(withoutHost.code).toBe('host_writers_required');

    const withHost = await applyChannelIntakeProposals(parseResult, {
      createTask: async () => ({ id: 920 }),
      appendActivity: async () => ({ ok: true }),
    });
    expect(withHost).toMatchObject({
      ok: true,
      taskId: 920,
      createdTask: true,
      truthOwner: 'host_task_service',
    });
  });
});
