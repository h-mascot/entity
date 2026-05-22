import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createClickClackBridge } from './bridge';

function listen(app: express.Express): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('failed to bind test server');
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('ClickClack bridge', () => {
  let server: http.Server;
  let baseUrl = '';
  const messages: Array<{ id: string; author_id: string; body: string; channel_id: string; parent_message_id?: string }> = [];
  let nextMessage = 1;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.get('/api/me', (req, res) => {
      const auth = req.header('authorization');
      res.json({
        user: auth === 'Bearer ccb_geordi'
          ? { id: 'usr_bot_geordi', kind: 'bot', display_name: 'Geordi' }
          : { id: 'usr_human', kind: 'human', display_name: 'Entity Human' },
      });
    });
    app.get('/api/workspaces', (_req, res) => {
      res.json({ workspaces: [{ id: 'wsp_entity', slug: 'entity', name: 'Entity' }] });
    });
    app.get('/api/workspaces/wsp_entity/channels', (_req, res) => {
      res.json({ channels: [{ id: 'chn_entity', workspace_id: 'wsp_entity', name: 'entity-agents', kind: 'public' }] });
    });
    app.post('/api/channels/chn_entity/messages', (req, res) => {
      const auth = req.header('authorization');
      const authorId = auth === 'Bearer ccb_geordi' ? 'usr_bot_geordi' : 'usr_human';
      const message = {
        id: `msg_${nextMessage++}`,
        workspace_id: 'wsp_entity',
        channel_id: 'chn_entity',
        author_id: authorId,
        body: String(req.body?.body ?? ''),
        body_format: 'markdown',
        created_at: new Date().toISOString(),
      };
      messages.push(message);
      res.status(201).json({ message });
    });
    app.post('/api/messages/:messageId/thread/replies', (req, res) => {
      const auth = req.header('authorization');
      const authorId = auth === 'Bearer ccb_geordi' ? 'usr_bot_geordi' : 'usr_human';
      const message = {
        id: `msg_${nextMessage++}`,
        workspace_id: 'wsp_entity',
        channel_id: 'chn_entity',
        author_id: authorId,
        parent_message_id: req.params.messageId,
        thread_root_id: req.params.messageId,
        body: String(req.body?.body ?? ''),
        body_format: 'markdown',
        created_at: new Date().toISOString(),
      };
      messages.push(message);
      res.status(201).json({ message });
    });

    const binding = await listen(app);
    server = binding.server;
    baseUrl = binding.baseUrl;
  });

  afterAll(async () => {
    await close(server);
  });

  it('posts one human message and one selected Entity agent reply through ClickClack', async () => {
    const bridge = createClickClackBridge({
      baseUrl,
      createAgentBot: async (agent, workspaceId) => ({
        agent,
        workspaceId,
        botUserId: 'usr_bot_geordi',
        token: 'ccb_geordi',
        created: true,
      }),
    });

    const result = await bridge.sendCompatibilityMessage({
      channelId: 'command-deck',
      content: 'hello sidecar',
      targets: ['geordi'],
      messageId: 'entity-human-1',
      modelByAgent: new Map([['geordi', { modelId: 'fallback', isLocal: false }]]),
    });

    expect(result.message).toMatchObject({
      id: 'msg_1',
      channelId: 'command-deck',
      sender: 'user',
      content: 'hello sidecar',
    });
    expect(result.messages).toEqual([
      expect.objectContaining({
        id: 'msg_2',
        channelId: 'command-deck',
        sender: 'geordi',
        content: expect.stringContaining('Geordi'),
      }),
    ]);
    expect(result.clickclack).toMatchObject({
      baseUrl,
      workspaceId: 'wsp_entity',
      channelId: 'chn_entity',
      mode: 'dev-sidecar',
    });
    expect(messages.map((message) => [message.author_id, message.body])).toEqual([
      ['usr_human', 'hello sidecar'],
      ['usr_bot_geordi', expect.stringContaining('hello sidecar')],
    ]);
  });

  it('keeps Entity parent ids local while posting bridged replies', async () => {
    const bridge = createClickClackBridge({
      baseUrl,
      createAgentBot: async (agent, workspaceId) => ({
        agent,
        workspaceId,
        botUserId: 'usr_bot_geordi',
        token: 'ccb_geordi',
        created: true,
      }),
    });

    const result = await bridge.sendCompatibilityMessage({
      channelId: 'command-deck',
      content: 'thread follow-up',
      targets: ['geordi'],
      parentMessageId: 'msg_root',
      modelByAgent: new Map([['geordi', { modelId: 'fallback', isLocal: false }]]),
    });

    expect(result.message).toMatchObject({
      id: 'msg_3',
      channelId: 'command-deck',
      sender: 'user',
      content: 'thread follow-up',
    });
    expect(messages.slice(-2).map((message) => [message.author_id, message.parent_message_id, message.body])).toEqual([
      ['usr_human', undefined, 'thread follow-up'],
      ['usr_bot_geordi', 'msg_3', expect.stringContaining('thread follow-up')],
    ]);
  });

  it('does not treat Entity thread IDs as ClickClack parent message IDs', async () => {
    const bridge = createClickClackBridge({
      baseUrl,
      createAgentBot: async (agent, workspaceId) => ({
        agent,
        workspaceId,
        botUserId: 'usr_bot_geordi',
        token: 'ccb_geordi',
        created: true,
      }),
    });

    await bridge.sendCompatibilityMessage({
      channelId: 'command-deck',
      content: 'thread id only',
      targets: ['geordi'],
      threadId: 'thread_entity_1',
      modelByAgent: new Map([['geordi', { modelId: 'fallback', isLocal: false }]]),
    });

    expect(messages.slice(-2).map((message) => [message.body, message.parent_message_id])).toEqual([
      ['thread id only', undefined],
      [expect.stringContaining('thread id only'), 'msg_5'],
    ]);
  });

  it('fails bot creation by default instead of posting agent replies as the human', async () => {
    const manifestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-clickclack-bridge-test-'));
    const bridge = createClickClackBridge({
      baseUrl,
      checkoutPath: '/tmp/no-clickclack-checkout',
      manifestPath: path.join(manifestDir, 'entity-bridge.json'),
    });

    await expect(bridge.sendCompatibilityMessage({
      channelId: 'command-deck',
      content: 'bot failure',
      targets: ['geordi'],
      modelByAgent: new Map([['geordi', { modelId: 'fallback', isLocal: false }]]),
    })).rejects.toThrow();
  });
});
