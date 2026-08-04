/**
 * EEPC-A-03 — callback mapping tests (plan/progress/proof/status/blocker → ActivityEvents).
 * EEPC-A-07 — success paths supply authRequired credentials.
 */
import express from 'express';
import http from 'http';
import { describe, expect, it } from 'vitest';
import { ACTIVITY_EVENT_PAYLOAD_VERSION } from '../../../../db/src';
import {
  createExecutionCallbackIntakeRouter,
  createExecutionCallbackIntakeService,
  getValidatedManifestByProvider,
  mapValidatedCallbackToActivityRecord,
  parseCallbackPayloadShape,
  validateExecutionCallback,
  type CallbackIntakeDependencies,
  type ExecutionCallbackJobRef,
} from './index';
import { TEST_AUTH, TEST_CALLBACK_SECRET } from './test-helpers';

const SYMPHONY_JOB: ExecutionCallbackJobRef = {
  id: 'job-symphony-1',
  provider: 'symphony',
  task_id: 42,
  status: 'running',
};

const UNLINKED_JOB: ExecutionCallbackJobRef = {
  id: 'job-unlinked-1',
  provider: 'symphony',
  task_id: null,
  status: 'running',
};

function deps(overrides: Partial<CallbackIntakeDependencies> = {}): CallbackIntakeDependencies {
  const jobs = new Map<string, ExecutionCallbackJobRef>([
    [SYMPHONY_JOB.id, SYMPHONY_JOB],
    [UNLINKED_JOB.id, UNLINKED_JOB],
  ]);
  return {
    getManifest: getValidatedManifestByProvider,
    getJob: (jobId) => jobs.get(jobId),
    getCallbackAuthSecret: () => TEST_CALLBACK_SECRET,
    ...overrides,
  };
}

async function listen(app: express.Express): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

describe('EEPC-A-03 callback intake mapping', () => {
  it('maps plan/progress/proof/status/blocker to durable ActivityEvent records', async () => {
    const service = createExecutionCallbackIntakeService(deps());
    const cases = [
      {
        event: 'plan' as const,
        body: { summary: 'Ship intake', steps: ['validate', 'map', 'persist'] },
        eventType: 'task_updated',
      },
      {
        event: 'progress' as const,
        body: { summary: 'Halfway', percent: 50 },
        eventType: 'task_updated',
      },
      {
        event: 'proof' as const,
        body: { summary: 'Tests green', commit_sha: 'abc1234', test_result: 'pass' },
        eventType: 'artifact_linked',
      },
      {
        event: 'status' as const,
        body: { summary: 'Moved to proof', status: 'proof' },
        eventType: 'status_changed',
      },
      {
        event: 'blocker' as const,
        body: { summary: 'Waiting on secrets', reason: 'Missing API key vault grant', code: 'vault' },
        eventType: 'task_blocked',
      },
    ];

    for (const entry of cases) {
      const result = await service.intake(
        {
          event: entry.event,
          provider: 'symphony',
          jobId: SYMPHONY_JOB.id,
          [entry.event]: entry.body,
        },
        TEST_AUTH,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.record.kind).toBe(entry.event);
      expect(result.record.eventType).toBe(entry.eventType);
      expect(result.record.taskId).toBe(42);
      expect(result.record.provider).toBe('symphony');
      expect(result.record.payload.version).toBe(ACTIVITY_EVENT_PAYLOAD_VERSION);
      expect((result.record.payload.data as { execution_callback_kind: string }).execution_callback_kind).toBe(
        entry.event,
      );
      expect(JSON.stringify(result.record.payload)).not.toMatch(/api[_-]?key|Bearer\s+|sk-/i);
      expect(result.record.persisted).toBe(false);
      expect(result.status).toBe(202);
    }
  });

  it('persists ActivityEvent when appendTaskEvent is provided', async () => {
    const appended: unknown[] = [];
    const service = createExecutionCallbackIntakeService(
      deps({
        appendTaskEvent: async (taskId, input) => {
          appended.push({ taskId, input });
          return { ok: true, value: { id: 1 } };
        },
      }),
    );

    const result = await service.intake(
      {
        event: 'progress',
        provider: 'symphony',
        jobId: SYMPHONY_JOB.id,
        summary: 'Working',
        percent: 10,
      },
      TEST_AUTH,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.persisted).toBe(true);
    expect(result.status).toBe(201);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      taskId: 42,
      input: { action: 'execution-engine:progress', eventType: 'task_updated' },
    });
  });

  it('marks unlinked jobs as degraded without failing mapping', async () => {
    const validated = validateExecutionCallback(
      {
        event: 'plan',
        provider: 'symphony',
        jobId: UNLINKED_JOB.id,
        summary: 'Plan without task',
      },
      deps(),
      TEST_AUTH,
    );
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const record = mapValidatedCallbackToActivityRecord(validated);
    expect(record.taskId).toBeNull();
    expect(record.degraded).toBe(true);
    expect(record.warnings.some((w) => w.code === 'missing_task_link')).toBe(true);
  });

  it('rejects malformed callback shape', () => {
    const result = parseCallbackPayloadShape(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe('malformed_payload');

    const missing = parseCallbackPayloadShape({ event: 'plan' });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['missing_provider', 'missing_job_id']),
    );
  });

  it('rejects unknown provider and unknown job', () => {
    const unknownProvider = validateExecutionCallback(
      {
        event: 'status',
        provider: 'not-a-real-engine',
        jobId: SYMPHONY_JOB.id,
        summary: 'noop',
      },
      deps(),
      TEST_AUTH,
    );
    expect(unknownProvider.ok).toBe(false);
    if (unknownProvider.ok) return;
    expect(unknownProvider.code).toBe('unknown_provider');
    expect(unknownProvider.status).toBe(404);

    const unknownJob = validateExecutionCallback(
      {
        event: 'status',
        provider: 'symphony',
        jobId: 'missing-job',
        summary: 'noop',
      },
      deps(),
      TEST_AUTH,
    );
    expect(unknownJob.ok).toBe(false);
    if (unknownJob.ok) return;
    expect(unknownJob.code).toBe('unknown_job');
    expect(unknownJob.status).toBe(404);
  });

  it('rejects invalid status values against swarm job status contract', () => {
    const result = validateExecutionCallback(
      {
        event: 'status',
        provider: 'symphony',
        jobId: SYMPHONY_JOB.id,
        summary: 'bad status',
        status: 'ready',
      },
      deps(),
      TEST_AUTH,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.code === 'invalid_status')).toBe(true);
  });

  it('rejects secret-bearing / public-unsafe callback payloads', () => {
    const secretKey = parseCallbackPayloadShape({
      event: 'progress',
      provider: 'symphony',
      jobId: SYMPHONY_JOB.id,
      summary: 'leaky',
      api_key: 'super-secret-value-that-must-not-pass',
    });
    expect(secretKey.ok).toBe(false);
    if (secretKey.ok) return;
    expect(secretKey.issues.some((i) => i.code === 'secret_key_forbidden')).toBe(true);

    const secretValue = parseCallbackPayloadShape({
      event: 'proof',
      provider: 'symphony',
      jobId: SYMPHONY_JOB.id,
      summary: 'leaky token',
      data: { note: 'Bearer abcdefghijklmnopqrstuvwxyz0123456789' },
    });
    expect(secretValue.ok).toBe(false);
    if (secretValue.ok) return;
    expect(secretValue.issues.some((i) => i.code === 'secret_value_leak')).toBe(true);
  });

  it('rejects job/provider mismatch', () => {
    const result = validateExecutionCallback(
      {
        event: 'status',
        provider: 'acp',
        jobId: SYMPHONY_JOB.id,
        summary: 'wrong provider',
        status: 'running',
      },
      deps(),
      TEST_AUTH,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('job_provider_mismatch');
    expect(result.status).toBe(409);
  });

  it('rejects events not declared on the provider manifest', () => {
    const result = validateExecutionCallback(
      {
        event: 'plan',
        provider: 'flywheel',
        jobId: 'job-flywheel-1',
        summary: 'not allowed',
      },
      deps({
        getJob: (jobId) =>
          jobId === 'job-flywheel-1'
            ? { id: jobId, provider: 'flywheel', task_id: 1, status: 'queued' }
            : undefined,
      }),
      TEST_AUTH,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('event_not_allowed');
  });

  it('HTTP scaffolding accepts plan and rejects secret-bearing progress', async () => {
    const app = express();
    app.use(express.json());
    app.use(
      createExecutionCallbackIntakeRouter(createExecutionCallbackIntakeService(deps())),
    );
    const { baseUrl, close } = await listen(app);
    try {
      const okRes = await fetch(`${baseUrl}/jobs/${SYMPHONY_JOB.id}/callbacks/plan`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_CALLBACK_SECRET}`,
        },
        body: JSON.stringify({
          provider: 'symphony',
          summary: 'HTTP plan intake',
          steps: ['a', 'b'],
        }),
      });
      expect(okRes.status).toBe(202);
      const okBody = (await okRes.json()) as { ok: boolean; record: { kind: string } };
      expect(okBody.ok).toBe(true);
      expect(okBody.record.kind).toBe('plan');

      const badRes = await fetch(`${baseUrl}/jobs/${SYMPHONY_JOB.id}/progress`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_CALLBACK_SECRET}`,
        },
        body: JSON.stringify({
          provider: 'symphony',
          summary: 'nope',
          authorization: 'Bearer should-be-rejected-immediately-now',
        }),
      });
      expect(badRes.status).toBe(400);
      const badBody = (await badRes.json()) as { error: string };
      expect(badBody.error).toBe('secret_key_forbidden');
    } finally {
      await close();
    }
  });
});
