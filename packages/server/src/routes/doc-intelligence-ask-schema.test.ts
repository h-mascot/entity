import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Express } from 'express';

const tmpDbPath = path.join(os.tmpdir(), `entity-docint-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const originalDbPath = process.env.ENTITY_TASK_DB_PATH;
process.env.ENTITY_TASK_DB_PATH = tmpDbPath;

interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
  generateCalls: number;
}

async function startServer(generateAnswer: (prompt: { system: string; user: string }) => Promise<string | null>): Promise<Harness> {
  const generateCalls = { value: 0 };
  const wrapped = async (prompt: { system: string; user: string }) => {
    generateCalls.value += 1;
    return generateAnswer(prompt);
  };
  const { registerDocIntelligenceRoutes, updateDocIntelligenceSettings } = await import('./doc-intelligence');
  const { updateTaskAgentSettings } = await import('../agent/settings');

  // Enable Doc Intelligence and configure a model key for the default provider
  // without depending on real env secrets.
  updateTaskAgentSettings({ apiKey: 'test-key-for-doc-intelligence' });
  updateDocIntelligenceSettings({ enabled: true });

  const app: Express = express();
  app.use(express.json());
  registerDocIntelligenceRoutes(app, '/api', { generateAnswer: wrapped });

  const server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once('listening', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server failed to bind');

  return {
    baseUrl: `http://127.0.0.1:${(address as { port: number }).port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    get generateCalls() {
      return generateCalls.value;
    },
  };
}

describe('doc-intelligence /ask schema fail-closed (THE-934)', () => {
  let harness: Harness;

  afterAll(async () => {
    if (harness) await harness.close();
    if (originalDbPath !== undefined) process.env.ENTITY_TASK_DB_PATH = originalDbPath;
    else delete process.env.ENTITY_TASK_DB_PATH;
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(tmpDbPath + suffix);
      } catch {}
    }
  });

  it('returns a structured schema_invalid error before invoking the model', async () => {
    harness = await startServer(async () => {
      throw new Error('model must not be called for malformed schema');
    });

    const response = await fetch(`${harness.baseUrl}/api/doc-intelligence/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'q', content: 'doc body', schema: 'Owner' }),
    });

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { code?: string; error?: string };
    expect(payload.code).toBe('schema_invalid');
    expect(harness.generateCalls).toBe(0);
  });

  it('returns schema_incomplete when the model answers Homeowner instead of Owner', async () => {
    harness = await startServer(async () => JSON.stringify({ Homeowner: 'Alice' }));

    const response = await fetch(`${harness.baseUrl}/api/doc-intelligence/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Who owns it?', content: 'doc body', schema: ['Owner'] }),
    });

    expect(response.status).toBe(422);
    const payload = (await response.json()) as { code?: string; missingFields?: string[] };
    expect(payload.code).toBe('schema_incomplete');
    expect(payload.missingFields).toEqual(['Owner']);
    expect(harness.generateCalls).toBe(1);
  });

  it('returns the answer when every required schema field is present', async () => {
    harness = await startServer(async () => JSON.stringify({ Owner: 'Alice', Address: '123 St' }));

    const response = await fetch(`${harness.baseUrl}/api/doc-intelligence/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'q', content: 'doc body', schema: ['Owner', 'Address'] }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { answer?: string };
    expect(payload.answer).toBeTruthy();
  });
});
