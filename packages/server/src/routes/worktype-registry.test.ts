import express from 'express';
import http from 'http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorktypeRegistryRouter } from './worktype-registry';
import { resolvePhase2Flags } from '../phase2-flags';

let server: http.Server | null = null;
let baseUrl = '';

async function readJson(response: Response): Promise<any> {
  return response.json();
}

async function startServer(flags = resolvePhase2Flags({})) {
  const app = express();
  app.use('/api/worktype-registry', createWorktypeRegistryRouter({ flags }));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('test server failed to bind');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}

describe('worktype registry route', () => {
  beforeEach(async () => {
    await startServer();
  });

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => error ? reject(error) : resolve());
    });
    server = null;
  });

  it('returns versioned worktype metadata and declared indexable overlay fields', async () => {
    const response = await fetch(`${baseUrl}/api/worktype-registry`);
    expect(response.status).toBe(200);

    const body = await readJson(response);
    const people = body.worktypes.find((entry: { worktype: string }) => entry.worktype === 'people');
    expect(people).toMatchObject({
      schema_name: 'entity.worktype.people',
      schema_version: 1,
      sensitivity: 'workspace_restricted',
    });
    expect(people.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'candidate_ref', indexable: true, plan_label: 'Candidate reference' }),
        expect.objectContaining({ name: 'workflow_stage', indexable: true, allowed_values: expect.arrayContaining(['onboarding']) }),
        expect.objectContaining({ name: 'approval_required', indexable: false }),
      ]),
    );
  });

  it('can disable the worktype registry surface without mutating registry data', async () => {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => error ? reject(error) : resolve());
    });
    server = null;
    await startServer(resolvePhase2Flags({ ENTITY_PHASE2_WORKTYPE_REGISTRY_SURFACE: 'off' }));

    const response = await fetch(`${baseUrl}/api/worktype-registry`);
    expect(response.status).toBe(503);
    expect(await readJson(response)).toMatchObject({
      error: 'worktype registry disabled',
      flag: {
        key: 'worktype_registry_surface',
        enabled: false,
        source: 'env',
      },
    });
  });
});
